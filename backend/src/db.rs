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

/// Adds a column to a table that already exists in a user's database.
///
/// `CREATE TABLE IF NOT EXISTS` is a no-op once the table is there — it will
/// NOT add a column — so every column introduced after its table shipped needs
/// a hand-written `ALTER TABLE`, guarded by the table's actual column list so a
/// second startup does not fail with "duplicate column name".
///
/// This is the ONLY place that guard is written; callers pass literals.
async fn add_column_if_missing(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    definition: &str,
) -> anyhow::Result<()> {
    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(pool)
        .await?;

    if column_missing(&columns, column) {
        // DDL cannot take bind parameters. Every argument reaching here is a
        // compile-time literal from this file, never user input.
        sqlx::query(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// One batch of built-in agent definitions plus the marker that records it as
/// already seeded.
pub(crate) struct SeedGeneration {
    pub marker: &'static str,
    /// `(id, name, command)` — ids are fixed so `routes/agents.rs` can key
    /// updates and deletes on them.
    pub presets: &'static [(&'static str, &'static str, &'static str)],
}

/// Built-in agent presets, in the order they were introduced.
///
/// Each generation carries its OWN marker instead of sharing one. A single
/// `agent_seed_done` flag cannot express "seed the new preset but not the ones
/// this user deleted": existing installs already have that marker set, so
/// appending to its list would hide the new preset forever, and clearing the
/// marker would resurrect every deleted built-in. With one marker per
/// generation, an existing install runs only the generations it has never seen
/// — Hermes appears exactly once — while `agent_seed_done` stays set and the
/// original three are never re-inserted.
pub(crate) const SEED_GENERATIONS: &[SeedGeneration] = &[
    SeedGeneration {
        marker: "agent_seed_done",
        presets: &[
            ("claude", "Claude Code", "claude"),
            ("codex", "Codex", "codex"),
            ("aider", "Aider", "aider"),
        ],
    },
    SeedGeneration {
        marker: "agent_seed_v2",
        presets: &[("hermes", "Hermes", "hermes")],
    },
];

/// The generations still to run, given the markers already in
/// `user_preferences`. A fresh database has none of them and gets every preset;
/// a database seeded before Hermes existed gets only the Hermes generation.
pub(crate) fn pending_seed_generations(present_markers: &[String]) -> Vec<&'static SeedGeneration> {
    SEED_GENERATIONS
        .iter()
        .filter(|generation| !present_markers.iter().any(|m| m == generation.marker))
        .collect()
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

    // `prompt_patterns` was added after `agent_definitions` shipped.
    add_column_if_missing(
        pool,
        "agent_definitions",
        "prompt_patterns",
        "TEXT NOT NULL DEFAULT '[]'",
    )
    .await?;

    // Seed the built-in agent definitions exactly once each, on FIXED ids, so
    // `routes/agents.rs` can key deletes/updates on them predictably. Gated by
    // per-generation `user_preferences` markers rather than by `INSERT OR
    // IGNORE` alone: a plain conditional insert would resurrect a built-in row
    // a user deliberately deleted on the very next startup, since its id would
    // look "missing" again only until this block re-inserts it. See
    // [`SEED_GENERATIONS`] for why each batch carries its own marker.
    let markers: Vec<String> =
        sqlx::query_scalar("SELECT key FROM user_preferences WHERE key LIKE 'agent_seed%'")
            .fetch_all(pool)
            .await?;

    for generation in pending_seed_generations(&markers) {
        for (id, name, command) in generation.presets {
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

        // Written even when the inserts were all ignored: the marker records
        // that this generation has been offered, not that its rows survive.
        sqlx::query("INSERT OR IGNORE INTO user_preferences (id, key, value) VALUES (?, ?, '1')")
            .bind(Uuid::new_v4().to_string())
            .bind(generation.marker)
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
            title_is_custom INTEGER NOT NULL DEFAULT 0,
            cwd TEXT,
            status TEXT NOT NULL DEFAULT 'running',
            exit_code INTEGER,
            seed_status TEXT NOT NULL DEFAULT 'none',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_activity_at TEXT,
            exited_at TEXT
        )",
    )
    .execute(pool)
    .await?;

    // All three columns postdate `agent_sessions`, so the statement above adds
    // them only on a fresh database; an existing one needs the guarded ALTER.
    //
    // `cwd` is nullable on purpose: rows written before per-session working
    // directories existed ran in their workspace's folder, and inventing a path
    // for them would be a claim we cannot support.
    add_column_if_missing(pool, "agent_sessions", "cwd", "TEXT").await?;
    add_column_if_missing(
        pool,
        "agent_sessions",
        "title_is_custom",
        "INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    // `'none'` is the honest value for every existing row: nothing was ever
    // seeded before this column existed. See `agents::SeedStatus` for the rest
    // of the vocabulary.
    add_column_if_missing(
        pool,
        "agent_sessions",
        "seed_status",
        "TEXT NOT NULL DEFAULT 'none'",
    )
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

    // A seed left 'pending' was waiting on a process this server no longer has,
    // so it can never be delivered. Leaving it pending would show a spinner
    // forever; 'failed' is what actually happened.
    sqlx::query("UPDATE agent_sessions SET seed_status = 'failed' WHERE seed_status = 'pending'")
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{column_missing, pending_seed_generations, SEED_GENERATIONS};

    fn markers(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn seeded_ids(present: &[&str]) -> Vec<&'static str> {
        pending_seed_generations(&markers(present))
            .iter()
            .flat_map(|g| g.presets.iter().map(|(id, _, _)| *id))
            .collect()
    }

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

    // -- built-in agent seeding -------------------------------------------

    #[test]
    fn a_fresh_database_is_offered_every_preset() {
        assert_eq!(seeded_ids(&[]), vec!["claude", "codex", "aider", "hermes"]);
    }

    #[test]
    fn an_existing_install_gets_only_the_new_preset() {
        // The whole point of versioning the marker: `agent_seed_done` is
        // already set for every user who ran an earlier build, so a naive
        // addition to that generation would never reach them.
        assert_eq!(seeded_ids(&["agent_seed_done"]), vec!["hermes"]);
    }

    #[test]
    fn a_deleted_built_in_is_not_resurrected_by_a_later_generation() {
        // A user who deleted Claude keeps it deleted: the Hermes generation
        // carries only Hermes, and `agent_seed_done` stays set.
        let ids = seeded_ids(&["agent_seed_done"]);
        assert!(!ids.contains(&"claude"));
        assert!(!ids.contains(&"codex"));
        assert!(!ids.contains(&"aider"));
    }

    #[test]
    fn seeding_is_a_no_op_once_every_marker_is_present() {
        assert!(seeded_ids(&["agent_seed_done", "agent_seed_v2"]).is_empty());
    }

    #[test]
    fn unrelated_preferences_do_not_satisfy_a_marker() {
        // The startup query is a `LIKE 'agent_seed%'` prefix scan, so the
        // match here must be on the whole key, not a prefix of it.
        assert_eq!(seeded_ids(&["agent_seed_done_v2", "agent_seed"]).len(), 4);
    }

    #[test]
    fn every_generation_has_a_distinct_marker() {
        // Two generations sharing a marker would silently skip one of them.
        let mut seen: Vec<&str> = SEED_GENERATIONS.iter().map(|g| g.marker).collect();
        let total = seen.len();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), total);
    }

    #[test]
    fn preset_ids_are_unique_across_generations() {
        // Ids are fixed and used as primary keys; a repeat would make the
        // second generation's `INSERT OR IGNORE` a silent no-op.
        let mut ids = seeded_ids(&[]);
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total);
    }
}
