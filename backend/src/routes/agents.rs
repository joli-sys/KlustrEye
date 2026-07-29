use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    agents::SpawnRequest,
    error::{AppError, Result},
    AppState,
};

pub fn validate_name(name: &str) -> std::result::Result<(), String> {
    if name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    Ok(())
}

pub fn validate_command(command: &str) -> std::result::Result<(), String> {
    if command.trim().is_empty() {
        return Err("command is required".to_string());
    }
    Ok(())
}

/// Parses the wire representation of `args` into a plain string list. The
/// field is optional / may be `null` — both mean "no args", not an error.
pub fn validate_args(args: Option<&Value>) -> std::result::Result<Vec<String>, String> {
    match args {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "args must be an array of strings".to_string())
            })
            .collect(),
        Some(_) => Err("args must be an array of strings".to_string()),
    }
}

/// Parses the wire representation of `env` into a string map. Absent / `null`
/// means "no env overrides".
pub fn validate_env(env: Option<&Value>) -> std::result::Result<HashMap<String, String>, String> {
    match env {
        None | Some(Value::Null) => Ok(HashMap::new()),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(key, value)| {
                value
                    .as_str()
                    .map(|v| (key.clone(), v.to_string()))
                    .ok_or_else(|| "env must be an object of string values".to_string())
            })
            .collect(),
        Some(_) => Err("env must be an object of string values".to_string()),
    }
}

#[derive(Deserialize)]
pub struct AgentDefinitionBody {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Option<Value>,
    #[serde(default)]
    pub env: Option<Value>,
}

#[derive(sqlx::FromRow)]
struct AgentDefinitionRow {
    id: String,
    name: String,
    command: String,
    args: String,
    env: String,
    sort_order: i64,
    built_in: i64,
    created_at: String,
    updated_at: String,
}

const SELECT_COLS: &str =
    "id, name, command, args, env, sort_order, built_in, created_at, updated_at";

/// `args`/`env` are stored as validated JSON TEXT (see `validate_args` /
/// `validate_env`), so a parse failure here would mean the stored value was
/// corrupted outside this module — fall back to empty rather than 500.
fn row_to_json(row: &AgentDefinitionRow) -> Value {
    let args: Value = serde_json::from_str(&row.args).unwrap_or_else(|_| json!([]));
    let env: Value = serde_json::from_str(&row.env).unwrap_or_else(|_| json!({}));

    json!({
        "id": row.id,
        "name": row.name,
        "command": row.command,
        "args": args,
        "env": env,
        "sortOrder": row.sort_order,
        "builtIn": row.built_in != 0,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

async fn fetch_row(db: &sqlx::SqlitePool, id: &str) -> Result<AgentDefinitionRow> {
    sqlx::query_as(&format!("SELECT {SELECT_COLS} FROM agent_definitions WHERE id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent definition {id} not found")))
}

pub async fn list_agent_definitions(State(state): State<AppState>) -> Result<Json<Value>> {
    let rows: Vec<AgentDefinitionRow> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLS} FROM agent_definitions ORDER BY sort_order ASC, name ASC"
    ))
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!(rows.iter().map(row_to_json).collect::<Vec<_>>())))
}

pub async fn create_agent_definition(
    State(state): State<AppState>,
    Json(body): Json<AgentDefinitionBody>,
) -> Result<Json<Value>> {
    validate_name(&body.name).map_err(AppError::BadRequest)?;
    validate_command(&body.command).map_err(AppError::BadRequest)?;
    let args = validate_args(body.args.as_ref()).map_err(AppError::BadRequest)?;
    let env = validate_env(body.env.as_ref()).map_err(AppError::BadRequest)?;

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO agent_definitions (id, name, command, args, env) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(body.name.trim())
    .bind(body.command.trim())
    .bind(serde_json::to_string(&args)?)
    .bind(serde_json::to_string(&env)?)
    .execute(&state.db)
    .await?;

    let row = fetch_row(&state.db, &id).await?;
    Ok(Json(row_to_json(&row)))
}

pub async fn update_agent_definition(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<AgentDefinitionBody>,
) -> Result<Json<Value>> {
    validate_name(&body.name).map_err(AppError::BadRequest)?;
    validate_command(&body.command).map_err(AppError::BadRequest)?;
    let args = validate_args(body.args.as_ref()).map_err(AppError::BadRequest)?;
    let env = validate_env(body.env.as_ref()).map_err(AppError::BadRequest)?;

    let res = sqlx::query(
        "UPDATE agent_definitions
         SET name = ?, command = ?, args = ?, env = ?, updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(body.name.trim())
    .bind(body.command.trim())
    .bind(serde_json::to_string(&args)?)
    .bind(serde_json::to_string(&env)?)
    .bind(&id)
    .execute(&state.db)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("agent definition {id} not found")));
    }

    let row = fetch_row(&state.db, &id).await?;
    Ok(Json(row_to_json(&row)))
}

/// Deleting a `built_in` row is allowed — a user may not want Claude/Codex/
/// Aider listed. It is not resurrected on the next restart because the
/// startup seed in `db.rs` runs at most once, guarded by the
/// `agent_seed_done` marker in `user_preferences`, not by re-checking which
/// ids currently exist.
pub async fn delete_agent_definition(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let res = sqlx::query("DELETE FROM agent_definitions WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("agent definition {id} not found")));
    }

    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AgentSessionBody {
    #[serde(rename = "definitionId")]
    pub definition_id: String,
    #[serde(default)]
    pub title: Option<String>,
    /// Initial PTY geometry. Optional — the client resizes on attach anyway,
    /// but starting at the right size stops the first frame being reflowed.
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub cols: Option<u16>,
}

#[derive(sqlx::FromRow)]
struct AgentSessionRow {
    id: String,
    workspace_id: String,
    definition_id: Option<String>,
    title: String,
    status: String,
    exit_code: Option<i64>,
    created_at: String,
    last_activity_at: Option<String>,
    exited_at: Option<String>,
}

const SESSION_COLS: &str = "id, workspace_id, definition_id, title, status, exit_code, \
                            created_at, last_activity_at, exited_at";

/// The table is the durable record, but a session that has just exited may not
/// have had its row updated yet — the registry writes it from a task. When the
/// registry still holds the session, its in-memory status is the fresher truth.
fn session_to_json(row: &AgentSessionRow, state: &AppState) -> Value {
    let (status, exit_code) = match state.agents.get(&row.id) {
        Some(session) => {
            let info = session.info();
            (info.status, info.exit_code.map(i64::from))
        }
        None => (row.status.clone(), row.exit_code),
    };

    json!({
        "id": row.id,
        "workspaceId": row.workspace_id,
        "definitionId": row.definition_id,
        "title": row.title,
        "status": status,
        "exitCode": exit_code,
        "createdAt": row.created_at,
        "lastActivityAt": row.last_activity_at,
        "exitedAt": row.exited_at,
    })
}

async fn fetch_session_row(db: &sqlx::SqlitePool, id: &str) -> Result<AgentSessionRow> {
    sqlx::query_as(&format!(
        "SELECT {SESSION_COLS} FROM agent_sessions WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent session {id} not found")))
}

pub async fn list_agent_sessions(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let rows: Vec<AgentSessionRow> = sqlx::query_as(&format!(
        "SELECT {SESSION_COLS} FROM agent_sessions
         WHERE workspace_id = ?
         ORDER BY created_at DESC, rowid DESC"
    ))
    .bind(&ws_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!(rows
        .iter()
        .map(|row| session_to_json(row, &state))
        .collect::<Vec<_>>())))
}

/// Starts an agent in the workspace's bound folder.
///
/// The workspace checks — bound folder present, folder still on disk — live in
/// `agents::resolve_workspace_cwd` and run inside `spawn_session`, so there is
/// exactly one place that can decide where an agent runs. `AgentError`'s
/// `From` impl maps them to 404/400, and the live-session cap to 429.
pub async fn create_agent_session(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<AgentSessionBody>,
) -> Result<Json<Value>> {
    let definition = fetch_row(&state.db, &body.definition_id).await?;

    let args: Vec<String> = serde_json::from_str(&definition.args).unwrap_or_default();
    let env_map: HashMap<String, String> =
        serde_json::from_str(&definition.env).unwrap_or_default();
    // Sorted so a given definition always produces the same spawn plan; a map's
    // iteration order is otherwise arbitrary.
    let mut env: Vec<(String, String)> = env_map.into_iter().collect();
    env.sort();

    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(definition.name.as_str())
        .to_string();

    // `spawn_session` records the row only once the PTY is up, so a failed
    // spawn leaves no row at all — there is never a `running` row the user
    // cannot attach to.
    let info = state
        .agents
        .spawn_session(
            &state.db,
            SpawnRequest {
                workspace_id: ws_id,
                definition_id: Some(definition.id),
                title,
                program: definition.command,
                args,
                env,
                rows: body.rows.unwrap_or(24),
                cols: body.cols.unwrap_or(80),
            },
        )
        .await?;

    let row = fetch_session_row(&state.db, &info.id).await?;
    Ok(Json(session_to_json(&row, &state)))
}

/// Kills the session's process group and marks the row exited.
///
/// Killing an already-exited session is a no-op that still returns 200: the
/// caller cannot tell the two apart, and an error would be pure noise.
pub async fn delete_agent_session(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    // 404 comes from the table, not the registry — an old session has a row but
    // no PTY, and deleting it must not look like a missing id.
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM agent_sessions WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("agent session {id} not found")));
    }

    state.agents.remove(&id);

    // The registry's exit task will also write this row when the child is
    // reaped, filling in the signal's exit code; `COALESCE` keeps whichever
    // timestamp landed first.
    sqlx::query(
        "UPDATE agent_sessions
         SET status = 'exited',
             exited_at = COALESCE(exited_at, datetime('now')),
             last_activity_at = datetime('now')
         WHERE id = ?",
    )
    .bind(&id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_name() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
        assert!(validate_name("\t\n").is_err());
    }

    #[test]
    fn accepts_name_with_surrounding_whitespace() {
        assert!(validate_name("  Claude Code  ").is_ok());
    }

    #[test]
    fn rejects_blank_command() {
        assert!(validate_command("").is_err());
        assert!(validate_command("   ").is_err());
    }

    #[test]
    fn accepts_nonblank_command() {
        assert!(validate_command("claude").is_ok());
    }

    #[test]
    fn args_absent_or_null_means_empty() {
        assert_eq!(validate_args(None), Ok(Vec::new()));
        assert_eq!(validate_args(Some(&Value::Null)), Ok(Vec::new()));
    }

    #[test]
    fn args_must_be_an_array_of_strings() {
        assert_eq!(
            validate_args(Some(&json!(["--flag", "value"]))),
            Ok(vec!["--flag".to_string(), "value".to_string()])
        );
        assert!(validate_args(Some(&json!(["--flag", 1]))).is_err());
        assert!(validate_args(Some(&json!({"flag": true}))).is_err());
        assert!(validate_args(Some(&json!("--flag"))).is_err());
    }

    #[test]
    fn env_absent_or_null_means_empty() {
        assert_eq!(validate_env(None), Ok(HashMap::new()));
        assert_eq!(validate_env(Some(&Value::Null)), Ok(HashMap::new()));
    }

    #[test]
    fn env_must_be_a_string_map() {
        let mut expected = HashMap::new();
        expected.insert("FOO".to_string(), "bar".to_string());
        assert_eq!(validate_env(Some(&json!({"FOO": "bar"}))), Ok(expected));
        assert!(validate_env(Some(&json!({"FOO": 1}))).is_err());
        assert!(validate_env(Some(&json!(["FOO=bar"]))).is_err());
    }

    #[test]
    fn valid_input_round_trips() {
        assert!(validate_name("Claude Code").is_ok());
        assert!(validate_command("claude").is_ok());
        assert!(validate_args(Some(&json!(["--yolo"]))).is_ok());
        assert!(validate_env(Some(&json!({"ANTHROPIC_API_KEY": "x"}))).is_ok());
    }
}
