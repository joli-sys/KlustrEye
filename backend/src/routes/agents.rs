use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    agents::{Activity, SpawnRequest},
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

/// Parses the wire representation of `promptPatterns` — regexes that mean "the
/// agent is asking the user something".
///
/// Each pattern is compiled here purely to reject a typo at the boundary with a
/// 400 rather than storing something that can never match. The runtime side
/// ([`crate::agents::PromptPatterns`]) still tolerates an invalid pattern by
/// skipping it, because a row can predate this validation.
pub fn validate_prompt_patterns(
    patterns: Option<&Value>,
) -> std::result::Result<Vec<String>, String> {
    let list: Vec<String> = match patterns {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "promptPatterns must be an array of strings".to_string())
            })
            .collect::<std::result::Result<_, _>>()?,
        Some(_) => return Err("promptPatterns must be an array of strings".to_string()),
    };

    for pattern in &list {
        regex::Regex::new(pattern)
            .map_err(|e| format!("invalid prompt pattern '{pattern}': {e}"))?;
    }
    Ok(list)
}

#[derive(Deserialize)]
pub struct AgentDefinitionBody {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Option<Value>,
    #[serde(default)]
    pub env: Option<Value>,
    #[serde(default, rename = "promptPatterns")]
    pub prompt_patterns: Option<Value>,
}

#[derive(sqlx::FromRow)]
struct AgentDefinitionRow {
    id: String,
    name: String,
    command: String,
    args: String,
    env: String,
    prompt_patterns: String,
    sort_order: i64,
    built_in: i64,
    created_at: String,
    updated_at: String,
}

const SELECT_COLS: &str = "id, name, command, args, env, prompt_patterns, sort_order, \
                           built_in, created_at, updated_at";

/// `args`/`env` are stored as validated JSON TEXT (see `validate_args` /
/// `validate_env`), so a parse failure here would mean the stored value was
/// corrupted outside this module — fall back to empty rather than 500.
fn row_to_json(row: &AgentDefinitionRow) -> Value {
    let args: Value = serde_json::from_str(&row.args).unwrap_or_else(|_| json!([]));
    let env: Value = serde_json::from_str(&row.env).unwrap_or_else(|_| json!({}));
    let prompt_patterns: Value =
        serde_json::from_str(&row.prompt_patterns).unwrap_or_else(|_| json!([]));

    json!({
        "id": row.id,
        "name": row.name,
        "command": row.command,
        "args": args,
        "env": env,
        "promptPatterns": prompt_patterns,
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
    let prompt_patterns =
        validate_prompt_patterns(body.prompt_patterns.as_ref()).map_err(AppError::BadRequest)?;

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO agent_definitions (id, name, command, args, env, prompt_patterns)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(body.name.trim())
    .bind(body.command.trim())
    .bind(serde_json::to_string(&args)?)
    .bind(serde_json::to_string(&env)?)
    .bind(serde_json::to_string(&prompt_patterns)?)
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
    let prompt_patterns =
        validate_prompt_patterns(body.prompt_patterns.as_ref()).map_err(AppError::BadRequest)?;

    let res = sqlx::query(
        "UPDATE agent_definitions
         SET name = ?, command = ?, args = ?, env = ?, prompt_patterns = ?,
             updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(body.name.trim())
    .bind(body.command.trim())
    .bind(serde_json::to_string(&args)?)
    .bind(serde_json::to_string(&env)?)
    .bind(serde_json::to_string(&prompt_patterns)?)
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
    /// Where to run. Optional — absent means the workspace's bound folder.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Initial PTY geometry. Optional — the client resizes on attach anyway,
    /// but starting at the right size stops the first frame being reflowed.
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub cols: Option<u16>,
}

#[derive(Deserialize)]
pub struct AgentSessionRenameBody {
    pub title: String,
}

/// A session title the user typed. Whitespace-only is a slip, not a name.
pub fn validate_session_title(title: &str) -> std::result::Result<String, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("title is required".to_string());
    }
    Ok(trimmed.to_string())
}

#[derive(sqlx::FromRow)]
struct AgentSessionRow {
    id: String,
    workspace_id: String,
    definition_id: Option<String>,
    title: String,
    /// NULL for rows written before per-session working directories existed;
    /// those ran in their workspace's folder, which we cannot reconstruct.
    cwd: Option<String>,
    exit_code: Option<i64>,
    created_at: String,
    last_activity_at: Option<String>,
    exited_at: Option<String>,
}

/// No `status`: the stored column is never the answer the API gives (see
/// `session_to_json`), so selecting it would only invite someone to trust it.
/// The recent-sessions query still reads it in SQL — as an ordering proxy,
/// which is the one thing it is good for.
const SESSION_COLS: &str = "id, workspace_id, definition_id, title, cwd, exit_code, \
                            created_at, last_activity_at, exited_at";

/// The table is the durable record, but a session that has just exited may not
/// have had its row updated yet — the registry writes it from a task. When the
/// registry still holds the session, its in-memory status is the fresher truth.
///
/// `activity` can only be answered by the registry, because it is derived from
/// an in-memory monotonic timestamp. A row with no live session therefore
/// reports `exited` — after a server restart the PTY is gone for good, and
/// reporting a dead session as `waiting` forever would be a lie the UI would
/// draw an icon for.
///
/// `status` is overridden the same way, and for the same reason. A stored
/// `running` with nothing in the registry is a row the exit task never got to
/// finish writing (or one left by a process that died with the server); the
/// PTY behind it is gone either way. Trusting the column would advertise a
/// session the user can click into and find empty — and it is the clickable
/// half of the homepage history list that decides on exactly this field.
///
/// `hasTranscript` is what lets the UI tell "archived, readable" from "gone":
/// an exited session with a transcript still opens and shows what it did, one
/// without it can only say so. It is passed in rather than looked up here so a
/// list of sessions costs one directory read instead of one stat per row.
fn session_to_json(row: &AgentSessionRow, state: &AppState, has_transcript: bool) -> Value {
    let (status, exit_code, activity, waiting_confidence) = match state.agents.get(&row.id) {
        Some(session) => {
            let info = session.info();
            (
                info.status,
                info.exit_code.map(i64::from),
                info.activity,
                info.waiting_confidence,
            )
        }
        None => (
            "exited".to_string(),
            row.exit_code,
            Activity::Exited.as_str().to_string(),
            None,
        ),
    };

    json!({
        "id": row.id,
        "workspaceId": row.workspace_id,
        "definitionId": row.definition_id,
        "title": row.title,
        "cwd": row.cwd,
        "status": status,
        "exitCode": exit_code,
        "activity": activity,
        "waitingConfidence": waiting_confidence,
        "hasTranscript": has_transcript,
        "createdAt": row.created_at,
        "lastActivityAt": row.last_activity_at,
        "exitedAt": row.exited_at,
    })
}

/// Whether one session has a stored transcript — a single stat, for the
/// endpoints that answer with a single session.
async fn has_transcript(state: &AppState, id: &str) -> bool {
    match state.agents.transcripts() {
        Some(store) => store.has(id).await,
        None => false,
    }
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

    // One directory read for the whole page, not one stat per row.
    let transcripts = match state.agents.transcripts() {
        Some(store) => store.list_ids().await,
        None => std::collections::HashSet::new(),
    };

    Ok(Json(json!(rows
        .iter()
        .map(|row| session_to_json(row, &state, transcripts.contains(&row.id)))
        .collect::<Vec<_>>())))
}

// ---------------------------------------------------------------------------
// Recent sessions, across every workspace
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RecentSessionsQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

pub const RECENT_SESSIONS_DEFAULT_LIMIT: i64 = 20;
/// A hard cap, so a client cannot ask for the entire history in one request.
pub const RECENT_SESSIONS_MAX_LIMIT: i64 = 100;

/// Clamps a client-supplied `limit` into a usable page size.
///
/// Absent means "the default". Zero or negative is not a smaller page, it is a
/// slip that would return an empty list forever, so it falls back to the
/// default rather than being honoured. Anything above the cap is clamped
/// instead of rejected — an over-eager client should still get a usable page,
/// not a 400 it cannot act on.
pub fn clamp_recent_limit(limit: Option<i64>) -> i64 {
    match limit {
        Some(n) if n > 0 => n.min(RECENT_SESSIONS_MAX_LIMIT),
        _ => RECENT_SESSIONS_DEFAULT_LIMIT,
    }
}

/// `SESSION_COLS` qualified with a table alias, so the join below does not
/// carry a second copy of the column list that could drift from the one the
/// per-workspace handler selects.
fn qualified_session_cols(alias: &str) -> String {
    SESSION_COLS
        .split(',')
        .map(|col| format!("{alias}.{}", col.trim()))
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(sqlx::FromRow)]
struct RecentAgentSessionRow {
    #[sqlx(flatten)]
    session: AgentSessionRow,
    workspace_name: String,
}

/// Exactly what the per-workspace list reports, plus the workspace's name —
/// from the homepage a session is meaningless without knowing where it ran.
/// Built on top of `session_to_json` rather than beside it so status, activity
/// and `hasTranscript` can only ever be derived one way.
fn recent_session_to_json(
    row: &RecentAgentSessionRow,
    state: &AppState,
    has_transcript: bool,
) -> Value {
    let mut value = session_to_json(&row.session, state, has_transcript);
    if let Some(map) = value.as_object_mut() {
        map.insert("workspaceName".to_string(), json!(row.workspace_name));
    }
    value
}

/// Every workspace's agent sessions, most interesting first.
///
/// An INNER JOIN on `workspaces` is deliberate: a session whose workspace has
/// been deleted cannot be opened — `/w/:wsId/...` redirects home — so listing
/// it would only offer a dead link.
///
/// Live rows sort ahead of the rest, then by recency. Recency alone would be
/// the obvious ordering, but `last_activity_at` is only touched while output
/// flows (see `agents::start_pty`), so an agent that has sat waiting on the
/// user for an hour looks stale and would be the first thing `LIMIT` drops —
/// exactly the row this list exists to surface. The ordering uses the stored
/// status, which is only a proxy; the reported `status`/`activity` still come
/// from the registry via `session_to_json`.
pub async fn list_recent_agent_sessions(
    Query(params): Query<RecentSessionsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let cols = qualified_session_cols("s");
    let rows: Vec<RecentAgentSessionRow> = sqlx::query_as(&format!(
        "SELECT {cols}, w.name AS workspace_name
         FROM agent_sessions s
         JOIN workspaces w ON w.id = s.workspace_id
         ORDER BY (s.status = 'running') DESC,
                  COALESCE(s.last_activity_at, s.created_at) DESC,
                  s.rowid DESC
         LIMIT ?"
    ))
    .bind(clamp_recent_limit(params.limit))
    .fetch_all(&state.db)
    .await?;

    // One directory read for the whole page, not one stat per row.
    let transcripts = match state.agents.transcripts() {
        Some(store) => store.list_ids().await,
        None => std::collections::HashSet::new(),
    };

    Ok(Json(json!(rows
        .iter()
        .map(|row| recent_session_to_json(row, &state, transcripts.contains(&row.session.id)))
        .collect::<Vec<_>>())))
}

/// Starts an agent in an explicit `cwd`, or in the workspace's bound folder
/// when none is given.
///
/// Every check — workspace exists, somewhere to run, that somewhere is a
/// directory — lives in `agents::resolve_session_cwd` and runs inside
/// `spawn_session`, so there is exactly one place that can decide where an agent
/// runs. `AgentError`'s `From` impl maps them to 404/400, and the live-session
/// cap to 429.
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

    // Stored patterns are validated on write, but a row could predate that or
    // have been edited outside the API — an unparseable list means "no
    // patterns", i.e. lower confidence, never a failed spawn.
    let prompt_patterns: Vec<String> =
        serde_json::from_str(&definition.prompt_patterns).unwrap_or_default();

    // A title supplied here is the user's own words, so it counts as custom and
    // suppresses auto-titling from the start. Falling back to the definition's
    // name is the default that auto-titling is allowed to improve on.
    let requested_title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let title_is_custom = requested_title.is_some();
    let title = requested_title
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
                title_is_custom,
                cwd: body.cwd,
                program: definition.command,
                args,
                env,
                prompt_patterns,
                rows: body.rows.unwrap_or(24),
                cols: body.cols.unwrap_or(80),
            },
        )
        .await?;

    let row = fetch_session_row(&state.db, &info.id).await?;
    let transcript = has_transcript(&state, &info.id).await;
    Ok(Json(session_to_json(&row, &state, transcript)))
}

/// Renames a session — permanently.
///
/// Setting `title_is_custom` is the point of the write, not a detail of it: the
/// auto-titler in `agents::start_pty` keys off that column and gives this
/// session up for good. A name the user chose drifting back to whatever the
/// agent last printed would be the same class of bug as refetching a file over
/// unsaved edits.
pub async fn rename_agent_session(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<AgentSessionRenameBody>,
) -> Result<Json<Value>> {
    let title = validate_session_title(&body.title).map_err(AppError::BadRequest)?;

    let res = sqlx::query("UPDATE agent_sessions SET title = ?, title_is_custom = 1 WHERE id = ?")
        .bind(&title)
        .bind(&id)
        .execute(&state.db)
        .await?;

    // `rows_affected` answers "does this id exist" without a second query, and
    // an unknown id is a 404 rather than a 500.
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("agent session {id} not found")));
    }

    // Renaming an old session is legitimate: it has a row but no PTY, and the
    // row is what the API reports. A live session gets its in-memory copy
    // updated too, which also latches its auto-titler off immediately.
    if let Some(session) = state.agents.get(&id) {
        session.set_custom_title(&title);
    }

    let row = fetch_session_row(&state.db, &id).await?;
    let transcript = has_transcript(&state, &id).await;
    Ok(Json(session_to_json(&row, &state, transcript)))
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
    fn prompt_patterns_absent_or_null_means_empty() {
        assert_eq!(validate_prompt_patterns(None), Ok(Vec::new()));
        assert_eq!(validate_prompt_patterns(Some(&Value::Null)), Ok(Vec::new()));
    }

    #[test]
    fn prompt_patterns_must_be_an_array_of_strings() {
        assert_eq!(
            validate_prompt_patterns(Some(&json!([r"\(y/n\)"]))),
            Ok(vec![r"\(y/n\)".to_string()])
        );
        assert!(validate_prompt_patterns(Some(&json!([1]))).is_err());
        assert!(validate_prompt_patterns(Some(&json!("(y/n)"))).is_err());
    }

    #[test]
    fn an_uncompilable_prompt_pattern_is_rejected_at_the_boundary() {
        let err = validate_prompt_patterns(Some(&json!(["(unclosed"]))).unwrap_err();
        assert!(err.contains("invalid prompt pattern"));
    }

    #[test]
    fn rejects_a_blank_session_title() {
        assert!(validate_session_title("").is_err());
        assert!(validate_session_title("   ").is_err());
        assert!(validate_session_title("\t\n").is_err());
    }

    #[test]
    fn a_session_title_is_stored_trimmed() {
        assert_eq!(
            validate_session_title("  Refactor the parser  "),
            Ok("Refactor the parser".to_string())
        );
    }

    #[test]
    fn an_absent_or_nonsensical_limit_falls_back_to_the_default() {
        assert_eq!(clamp_recent_limit(None), RECENT_SESSIONS_DEFAULT_LIMIT);
        assert_eq!(clamp_recent_limit(Some(0)), RECENT_SESSIONS_DEFAULT_LIMIT);
        assert_eq!(clamp_recent_limit(Some(-5)), RECENT_SESSIONS_DEFAULT_LIMIT);
    }

    #[test]
    fn an_oversized_limit_is_clamped_rather_than_rejected() {
        assert_eq!(clamp_recent_limit(Some(5)), 5);
        assert_eq!(clamp_recent_limit(Some(RECENT_SESSIONS_MAX_LIMIT)), RECENT_SESSIONS_MAX_LIMIT);
        assert_eq!(clamp_recent_limit(Some(10_000)), RECENT_SESSIONS_MAX_LIMIT);
    }

    /// The recent-sessions join must select the same columns the per-workspace
    /// list does, or `AgentSessionRow` would fail to build from the row.
    #[test]
    fn qualifying_the_column_list_prefixes_every_column_exactly_once() {
        let qualified = qualified_session_cols("s");
        assert_eq!(
            qualified.split(", ").count(),
            SESSION_COLS.split(',').count(),
            "qualifying must not add or drop a column"
        );
        assert!(qualified.split(", ").all(|col| col.starts_with("s.")));
        assert!(qualified.starts_with("s.id, s.workspace_id, "));
        assert!(qualified.ends_with(", s.exited_at"));
    }

    #[tokio::test]
    async fn recent_sessions_span_workspaces_and_carry_the_workspace_name() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::run_migrations(&db).await.unwrap();

        for (id, name) in [("w1", "Alpha"), ("w2", "Beta")] {
            sqlx::query("INSERT INTO workspaces (id, name) VALUES (?, ?)")
                .bind(id)
                .bind(name)
                .execute(&db)
                .await
                .unwrap();
        }
        // A workspace that no longer exists — its session must not be listed.
        for (id, ws, title, status, activity) in [
            ("s-old", "w1", "Old run", "exited", "2026-07-01 10:00:00"),
            ("s-new", "w2", "New run", "exited", "2026-07-28 10:00:00"),
            ("s-idle", "w1", "Still going", "running", "2026-06-01 10:00:00"),
            ("s-orphan", "gone", "Orphan", "exited", "2026-07-29 10:00:00"),
        ] {
            sqlx::query(
                "INSERT INTO agent_sessions
                 (id, workspace_id, title, status, created_at, last_activity_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(ws)
            .bind(title)
            .bind(status)
            .bind(activity)
            .bind(activity)
            .execute(&db)
            .await
            .unwrap();
        }

        let cols = qualified_session_cols("s");
        let rows: Vec<RecentAgentSessionRow> = sqlx::query_as(&format!(
            "SELECT {cols}, w.name AS workspace_name
             FROM agent_sessions s
             JOIN workspaces w ON w.id = s.workspace_id
             ORDER BY (s.status = 'running') DESC,
                      COALESCE(s.last_activity_at, s.created_at) DESC,
                      s.rowid DESC
             LIMIT ?"
        ))
        .bind(clamp_recent_limit(None))
        .fetch_all(&db)
        .await
        .unwrap();

        // The stored status is an ordering proxy only; it must not reach the
        // struct the JSON is built from, or a stale `running` row would be
        // advertised as a session the user can attach to.
        assert!(
            !SESSION_COLS.split(',').any(|col| col.trim() == "status"),
            "the reported status comes from the registry, never the column"
        );

        let listed: Vec<(&str, &str)> = rows
            .iter()
            .map(|r| (r.session.id.as_str(), r.workspace_name.as_str()))
            .collect();
        assert_eq!(
            listed,
            vec![
                // Live first even though it is the least recently active…
                ("s-idle", "Alpha"),
                // …then by recency, across workspaces.
                ("s-new", "Beta"),
                ("s-old", "Alpha"),
            ],
            "a session whose workspace is gone must not be listed"
        );
    }

    #[test]
    fn valid_input_round_trips() {
        assert!(validate_name("Claude Code").is_ok());
        assert!(validate_command("claude").is_ok());
        assert!(validate_args(Some(&json!(["--yolo"]))).is_ok());
        assert!(validate_env(Some(&json!({"ANTHROPIC_API_KEY": "x"}))).is_ok());
    }
}
