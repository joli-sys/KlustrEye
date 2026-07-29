use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
use std::str::FromStr;

pub async fn init_pool(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePool::connect_with(options).await?;
    run_migrations(&pool).await?;
    Ok(pool)
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

    Ok(())
}
