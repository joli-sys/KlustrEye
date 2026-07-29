use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
use std::str::FromStr;
use uuid::Uuid;

pub async fn init_pool(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePool::connect_with(options).await?;
    run_migrations(&pool).await?;
    Ok(pool)
}

/// Decides whether a guarded `ALTER TABLE ... ADD COLUMN` still needs to run,
/// given the names reported by `PRAGMA table_info`.
///
/// Comparison is case-insensitive because SQLite treats identifiers that way:
/// a table declared with `PromptPatterns` already has the column, and adding it
/// again would fail with "duplicate column name".
pub(crate) fn column_missing(existing: &[String], column: &str) -> bool {
    !existing.iter().any(|c| c.eq_ignore_ascii_case(column))
}

pub(crate) async fn run_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS organizations (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS cluster_contexts (
            id TEXT PRIMARY KEY,
            context_name TEXT UNIQUE NOT NULL,
            display_name TEXT,
            last_namespace TEXT NOT NULL DEFAULT 'default',
            pinned INTEGER NOT NULL DEFAULT 0,
            organization_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS cluster_settings (
            id TEXT PRIMARY KEY,
            cluster_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(cluster_id, key),
            FOREIGN KEY (cluster_id) REFERENCES cluster_contexts(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS user_preferences (
            id TEXT PRIMARY KEY,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS saved_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            kind TEXT NOT NULL,
            yaml TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS terminal_sessions (
            id TEXT PRIMARY KEY,
            context_name TEXT NOT NULL,
            namespace TEXT NOT NULL,
            pod_name TEXT NOT NULL,
            container_name TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS port_forward_sessions (
            id TEXT PRIMARY KEY,
            context_name TEXT NOT NULL,
            namespace TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_name TEXT NOT NULL,
            local_port INTEGER NOT NULL,
            remote_port INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'starting',
            error_message TEXT,
            pid INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            stopped_at TEXT
        )",
    )
    .execute(pool)
    .await?;

    // Mark any stale sessions from previous runs as stopped
    sqlx::query(
        "UPDATE port_forward_sessions SET status = 'stopped', stopped_at = datetime('now')
         WHERE status IN ('active', 'starting')",
    )
    .execute(pool)
    .await?;

    // `context_name` is LEGACY. The authoritative cluster bindings live in
    // `workspace_clusters` (many per workspace); this column is kept only so an
    // older build pointed at the same database still finds one sane cluster. It
    // is written as the first bound cluster (or NULL when none) and never read
    // as the source of truth. It cannot be dropped: this file is a flat list of
    // `CREATE TABLE IF NOT EXISTS` with no column-migration support.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            folder_path TEXT,
            context_name TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            last_opened_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // A workspace binds MANY clusters, and the same cluster may belong to
    // several workspaces — hence a join table with a composite primary key and
    // no UNIQUE on context_name.
    //
    // `PRAGMA foreign_keys` is never turned ON for this pool, so the ON DELETE
    // CASCADE below is documentation, not behaviour: `delete_workspace` deletes
    // the join rows explicitly.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS workspace_clusters (
            workspace_id TEXT NOT NULL,
            context_name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (workspace_id, context_name),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    // Backfill the legacy one-cluster-per-workspace bindings. Idempotent: the
    // composite primary key plus INSERT OR IGNORE makes repeated startups a
    // no-op, and a workspace whose binding was later removed via the API is not
    // resurrected because `workspaces.context_name` is cleared alongside it.
    sqlx::query(
        "INSERT OR IGNORE INTO workspace_clusters (workspace_id, context_name, sort_order)
         SELECT id, context_name, 0 FROM workspaces
         WHERE context_name IS NOT NULL AND trim(context_name) <> ''",
    )
    .execute(pool)
    .await?;

    // Registry of external CLI coding agents a supervised session can launch
    // (Claude Code, Codex, Aider, or a user-defined command). `args`/`env` are
    // JSON (array of strings / string map) stored as TEXT — see
    // `routes/agents.rs` for the shapes and validation.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            command TEXT NOT NULL,
            args TEXT NOT NULL DEFAULT '[]',
            env TEXT NOT NULL DEFAULT '{}',
            prompt_patterns TEXT NOT NULL DEFAULT '[]',
            sort_order INTEGER NOT NULL DEFAULT 0,
            built_in INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // `prompt_patterns` was added after `agent_definitions` shipped, and the
    // `CREATE TABLE IF NOT EXISTS` above is a no-op on a database that already
    // has the table — it will NOT add the column. Hence a hand-written
    // `ALTER TABLE`, guarded by the table's actual column list so a second
    // startup does not fail with "duplicate column name".
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('agent_definitions')")
            .fetch_all(pool)
            .await?;

    if column_missing(&columns, "prompt_patterns") {
        sqlx::query(
            "ALTER TABLE agent_definitions
             ADD COLUMN prompt_patterns TEXT NOT NULL DEFAULT '[]'",
        )
        .execute(pool)
        .await?;
    }

    // Seed the three built-in agent definitions exactly once, on FIXED ids, so
    // `routes/agents.rs` can key deletes/updates on them predictably. Gated by
    // a `user_preferences` marker rather than relying on `INSERT OR IGNORE`
    // alone: a plain conditional insert would resurrect a built-in row a user
    // deliberately deleted on the very next startup, since its id would look
    // "missing" again only until this block re-inserts it.
    let seeded: Option<String> = sqlx::query_scalar(
        "SELECT value FROM user_preferences WHERE key = 'agent_seed_done'",
    )
    .fetch_optional(pool)
    .await?;

    if seeded.is_none() {
        for (id, name, command) in [
            ("claude", "Claude Code", "claude"),
            ("codex", "Codex", "codex"),
            ("aider", "Aider", "aider"),
        ] {
            sqlx::query(
                "INSERT OR IGNORE INTO agent_definitions (id, name, command, built_in)
                 VALUES (?, ?, ?, 1)",
            )
            .bind(id)
            .bind(name)
            .bind(command)
            .execute(pool)
            .await?;
        }

        sqlx::query(
            "INSERT OR IGNORE INTO user_preferences (id, key, value) VALUES (?, 'agent_seed_done', '1')",
        )
        .bind(Uuid::new_v4().to_string())
        .execute(pool)
        .await?;
    }

    // Agent supervisor sessions. The live PTY lives in the in-memory registry
    // (`agents::AgentRegistry`); this table is the durable record of what ran.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_sessions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            definition_id TEXT,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            exit_code INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_activity_at TEXT,
            exited_at TEXT
        )",
    )
    .execute(pool)
    .await?;

    // An agent process cannot outlive the server that spawned it — the registry
    // holding its PTY is in-memory. Leaving these rows 'running' would make the
    // UI advertise sessions that can never be attached to.
    sqlx::query(
        "UPDATE agent_sessions SET status = 'exited', exited_at = datetime('now')
         WHERE status = 'running'",
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::column_missing;

    /// The shape a database created before `prompt_patterns` existed reports.
    fn legacy_columns() -> Vec<String> {
        ["id", "name", "command", "args", "env", "sort_order", "built_in"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn alter_runs_on_a_table_that_predates_the_column() {
        assert!(column_missing(&legacy_columns(), "prompt_patterns"));
    }

    #[test]
    fn alter_is_skipped_once_the_column_exists() {
        let mut cols = legacy_columns();
        cols.push("prompt_patterns".to_string());
        assert!(!column_missing(&cols, "prompt_patterns"));
    }

    #[test]
    fn column_match_is_case_insensitive_like_sqlite() {
        let cols = vec!["PROMPT_PATTERNS".to_string()];
        assert!(!column_missing(&cols, "prompt_patterns"));
    }

    #[test]
    fn a_prefix_of_the_column_name_does_not_count_as_present() {
        let cols = vec!["prompt".to_string(), "patterns".to_string()];
        assert!(column_missing(&cols, "prompt_patterns"));
    }
}
