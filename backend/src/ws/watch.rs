use std::borrow::Cow;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures::{SinkExt, StreamExt};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde_json::json;
use sqlx::SqlitePool;
use tokio::sync::mpsc;

/// Close code for a socket that can never work for this workspace (no folder
/// bound, folder unreadable, watcher unavailable). The client must NOT retry
/// these — a reconnect loop would just re-fail forever. Anything below 4000 is
/// a transport-level close and IS worth retrying.
const CLOSE_UNSUPPORTED: u16 = 4001;

/// A save from an editor is several syscalls, and `git checkout` is thousands.
/// Coalescing the burst keeps the client from re-listing the same directory
/// once per syscall.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// How recently a file must have been created to be reported as "created"
/// rather than "modified". Three times DEBOUNCE: wide enough that a file
/// created at the start of a window is still "new" when that window flushes,
/// narrow enough that editing a file a second later reads as a modification.
const CREATED_WINDOW: Duration = Duration::from_secs(1);

/// Directory names never reported. A single `npm install` or `cargo build`
/// would otherwise push tens of thousands of frames through the socket for
/// paths no file tree ever shows.
const IGNORED_DIRS: [&str; 3] = [".git", "node_modules", "target"];

pub async fn handle_watch(socket: WebSocket, db: SqlitePool, ws_id: String) {
    if let Err(e) = run_watch(socket, db, &ws_id).await {
        tracing::error!("Watch error for workspace {ws_id}: {e}");
    }
}

async fn run_watch(socket: WebSocket, db: SqlitePool, ws_id: &str) -> anyhow::Result<()> {
    let root = match workspace_root(&db, ws_id).await {
        Ok(root) => root,
        Err(reason) => {
            close_unsupported(socket, &reason).await;
            return Ok(());
        }
    };

    // `notify` calls back on its own OS thread. An unbounded channel is what
    // lets that thread hand work to the runtime without ever blocking on a
    // full queue — the filtering below runs inside the callback precisely so
    // that a `node_modules` flood never reaches the channel in the first place.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let cb_root = root.clone();
    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        // Reading a file is not a change the tree needs to hear about. Every
        // other kind is resolved against the filesystem at flush time, so it
        // does not matter here which one it was.
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in &event.paths {
            let Some(rel) = relative_path(&cb_root, path) else { continue };
            // The root itself is not an entry in any listing.
            if rel.is_empty() || is_ignored(&rel) {
                continue;
            }
            if tx.send(rel).is_err() {
                return;
            }
        }
    }) {
        Ok(w) => w,
        Err(e) => {
            close_unsupported(socket, &format!("cannot create a filesystem watcher: {e}")).await;
            return Ok(());
        }
    };

    if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
        close_unsupported(socket, &format!("cannot watch the workspace folder: {e}")).await;
        return Ok(());
    }

    let (mut ws_sink, mut ws_stream) = socket.split();

    // The client never sends anything; this task exists only to notice that
    // the socket went away so the watcher thread can be torn down.
    let mut client_gone = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
        }
    });

    // A set, not a list: a burst that touches one file twenty times is one
    // change as far as any directory listing is concerned.
    let mut pending: BTreeSet<String> = BTreeSet::new();

    'session: loop {
        tokio::select! {
            _ = &mut client_gone => break 'session,
            first = rx.recv() => {
                let Some(rel) = first else { break 'session };
                pending.insert(rel);

                // Collect everything that lands within the window opened by
                // the first event, then flush once.
                let deadline = tokio::time::sleep(DEBOUNCE);
                tokio::pin!(deadline);
                loop {
                    tokio::select! {
                        _ = &mut deadline => break,
                        more = rx.recv() => match more {
                            Some(rel) => { pending.insert(rel); }
                            None => break,
                        },
                    }
                }

                let now = SystemTime::now();
                for rel in std::mem::take(&mut pending) {
                    let kind = resolve_kind(&root, &rel, now);
                    let frame = json!({ "kind": kind, "path": rel }).to_string();
                    if ws_sink.send(Message::Text(frame)).await.is_err() {
                        break 'session;
                    }
                }
            }
        }
    }

    client_gone.abort();
    // Dropping the watcher here stops its OS thread; leaving it to a detached
    // task would leak one thread per closed tab.
    drop(watcher);
    Ok(())
}

/// What actually happened to `rel`, decided by looking at the filesystem
/// rather than at the event that woke us.
///
/// macOS FSEvents flags are CUMULATIVE per path: once a file has been created,
/// every later event for it still carries ITEM_CREATED, and deleting it
/// delivers create, remove and modify together. Observed directly against
/// notify 6.1 — one `write` followed by one `remove_file` on a single path
/// yields `Create(File)`, `Remove(File)`, `Modify(Metadata)`, `Modify(Data)`.
/// So the event kind cannot tell a create from a delete there, and only a stat
/// at flush time can.
///
/// Two cases resolve to "modified" that a reader might expect to be "created":
/// a rename (which preserves the file's creation time, so the path it moved TO
/// looks old) and a filesystem with no creation time at all — `created()` is
/// not available everywhere. Neither matters downstream: the client invalidates
/// the containing directory on any kind, so the listing is correct regardless.
/// What has to be right is "removed", and that comes from the stat failing.
fn resolve_kind(root: &Path, rel: &str, now: SystemTime) -> &'static str {
    // symlink_metadata, not metadata: a dangling symlink is still an entry in
    // its directory, and reporting it removed would be wrong.
    let Ok(meta) = root.join(rel).symlink_metadata() else {
        return "removed";
    };
    match meta.created() {
        Ok(created) if now.duration_since(created).is_ok_and(|age| age < CREATED_WINDOW) => {
            "created"
        }
        _ => "modified",
    }
}

/// The workspace's bound folder, canonicalized, or a human-readable reason.
///
/// Canonicalizing matters beyond confinement: the OS reports event paths
/// already resolved (`/var` is `/private/var` on macOS), so an unresolved root
/// would fail every `strip_prefix` and the socket would silently report
/// nothing at all.
async fn workspace_root(db: &SqlitePool, ws_id: &str) -> std::result::Result<PathBuf, String> {
    let row: Option<Option<String>> =
        sqlx::query_scalar("SELECT folder_path FROM workspaces WHERE id = ?")
            .bind(ws_id)
            .fetch_optional(db)
            .await
            .map_err(|e| format!("cannot load workspace: {e}"))?;

    let folder = row.ok_or_else(|| format!("workspace {ws_id} not found"))?;
    let folder = folder
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "workspace has no folder bound".to_string())?;

    PathBuf::from(&folder)
        .canonicalize()
        .map_err(|e| format!("workspace folder is not accessible: {e}"))
}

/// Explain the problem in a data frame, then close.
///
/// The detail goes in the text frame rather than the close frame because a
/// close reason is capped at 123 bytes and a folder path alone can exceed it.
async fn close_unsupported(mut socket: WebSocket, reason: &str) {
    let _ = socket
        .send(Message::Text(
            json!({ "kind": "error", "message": reason }).to_string(),
        ))
        .await;
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: CLOSE_UNSUPPORTED,
            reason: Cow::Borrowed("workspace is not watchable"),
        })))
        .await;
}

/// Workspace-relative, forward-slashed. `None` for anything outside the root —
/// an absolute host path must never reach the client.
fn relative_path(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

fn is_ignored(rel: &str) -> bool {
    rel.split('/').any(|c| IGNORED_DIRS.contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_build_and_vcs_directories_at_any_depth() {
        assert!(is_ignored("node_modules/react/index.js"));
        assert!(is_ignored(".git/HEAD"));
        assert!(is_ignored("target/debug/backend"));
        assert!(is_ignored("packages/api/node_modules/x.js"));
    }

    /// Prefix matching would swallow real source files; only a whole path
    /// component counts.
    #[test]
    fn does_not_ignore_files_that_merely_start_with_an_ignored_name() {
        assert!(!is_ignored("src/target.rs"));
        assert!(!is_ignored("targets/list.json"));
        assert!(!is_ignored(".gitignore"));
        assert!(!is_ignored("src/main.rs"));
    }

    #[test]
    fn relative_path_is_workspace_relative_and_forward_slashed() {
        let root = Path::new("/ws/root");
        assert_eq!(
            relative_path(root, Path::new("/ws/root/src/main.rs")).as_deref(),
            Some("src/main.rs")
        );
        // The root itself relativizes to "", which the caller drops.
        assert_eq!(relative_path(root, Path::new("/ws/root")).as_deref(), Some(""));
    }

    /// The whole point of relativizing: a path outside the workspace is
    /// dropped rather than sent to the client as an absolute host path.
    #[test]
    fn relative_path_rejects_paths_outside_the_root() {
        assert_eq!(
            relative_path(Path::new("/ws/root"), Path::new("/etc/passwd")),
            None
        );
        // A sibling directory sharing the root's name as a prefix is still
        // outside it.
        assert_eq!(
            relative_path(Path::new("/ws/root"), Path::new("/ws/root-other/a.txt")),
            None
        );
    }

    #[test]
    fn resolve_kind_reports_a_missing_path_as_removed() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        assert_eq!(resolve_kind(&root, "gone.txt", SystemTime::now()), "removed");
    }

    #[test]
    fn resolve_kind_reports_a_just_written_file_as_created() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::fs::write(root.join("new.txt"), "hi").unwrap();
        assert_eq!(resolve_kind(&root, "new.txt", SystemTime::now()), "created");
    }

    /// The same file seen again later is a modification, not a second
    /// creation — this is what keeps every save from reporting "created" on
    /// macOS, where the event itself always still carries ITEM_CREATED.
    #[test]
    fn resolve_kind_reports_an_older_file_as_modified() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::fs::write(root.join("old.txt"), "hi").unwrap();
        let later = SystemTime::now() + CREATED_WINDOW + Duration::from_secs(1);
        assert_eq!(resolve_kind(&root, "old.txt", later), "modified");
    }

    /// A dangling symlink is an entry in its directory; `metadata()` would
    /// follow it, fail, and report a file that is plainly there as removed.
    #[cfg(unix)]
    #[test]
    fn resolve_kind_does_not_report_a_dangling_symlink_as_removed() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::os::unix::fs::symlink(root.join("nope"), root.join("link")).unwrap();
        assert_ne!(resolve_kind(&root, "link", SystemTime::now()), "removed");
    }
}
