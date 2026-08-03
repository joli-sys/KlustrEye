use std::path::{Path as StdPath, PathBuf};
use std::time::UNIX_EPOCH;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::{AppError, Result},
    fs::{resolve_in_workspace_async, IGNORED_DIRS},
    AppState,
};

/// Reads above this are refused with 413 — the editor cannot usefully open
/// them and the whole file is buffered in memory to answer the request.
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
/// Search never opens a file bigger than this; minified bundles and lockfiles
/// dominate the walk otherwise.
const MAX_SEARCH_FILE_BYTES: usize = 1024 * 1024;
const DEFAULT_SEARCH_MAX: usize = 200;
const MAX_SEARCH_MAX: usize = 1000;
const PREVIEW_CHARS: usize = 200;

#[derive(Deserialize)]
pub struct PathQuery {
    #[serde(default)]
    pub path: String,
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub max: Option<usize>,
}

#[derive(Deserialize)]
pub struct WriteFileBody {
    pub path: String,
    pub content: String,
    /// The mtime the client last saw. When it no longer matches, another
    /// process changed the file and the write is refused with 409 instead of
    /// silently discarding those changes.
    #[serde(rename = "baseModifiedMs")]
    pub base_modified_ms: Option<i64>,
}

/// The workspace's bound folder, or 400 when it has none.
///
/// A folder-less workspace is a legitimate state (cluster-only workspace), so
/// this is a client-side condition, not a 500 and not an empty listing.
async fn workspace_root(state: &AppState, ws_id: &str) -> Result<PathBuf> {
    let row: Option<Option<String>> =
        sqlx::query_scalar("SELECT folder_path FROM workspaces WHERE id = ?")
            .bind(ws_id)
            .fetch_optional(&state.db)
            .await?;

    let folder = row.ok_or_else(|| AppError::NotFound(format!("workspace {ws_id} not found")))?;
    let folder = folder
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("workspace has no folder bound".into()))?;

    Ok(PathBuf::from(folder))
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Normalize a client path into the form echoed back in responses:
/// forward slashes, no trailing separator.
///
/// Deliberately does NOT strip a LEADING separator. Doing so would silently
/// turn "/etc/passwd" into the workspace-relative "etc/passwd", which is still
/// confined but hides a client bug behind a 404 instead of the 400 that says
/// what is actually wrong.
fn normalize_rel(rel: &str) -> String {
    rel.replace('\\', "/").trim_end_matches('/').to_string()
}

fn join_rel(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

pub async fn list_files(
    Path(ws_id): Path<String>,
    Query(q): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let root = workspace_root(&state, &ws_id).await?;
    let rel = normalize_rel(&q.path);
    let dir = resolve_in_workspace_async(root, rel.clone()).await?;

    let meta = tokio::fs::metadata(&dir)
        .await
        .map_err(|_| AppError::NotFound(format!("path not found: {rel}")))?;
    if !meta.is_dir() {
        return Err(AppError::BadRequest(format!("not a directory: {rel}")));
    }

    let mut read_dir = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("cannot read directory: {e}")))?;

    let mut entries: Vec<(bool, String, Value)> = Vec::new();
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("cannot read directory: {e}")))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        // An unreadable entry (a dangling symlink, a permission hole) must not
        // fail the whole listing.
        let Ok(meta) = entry.metadata().await else { continue };
        let is_dir = meta.is_dir();
        let child_rel = join_rel(&rel, &name);
        entries.push((
            is_dir,
            name.to_lowercase(),
            json!({
                "name": name,
                "path": child_rel,
                "isDir": is_dir,
                "size": meta.len(),
                "modifiedMs": modified_ms(&meta),
            }),
        ));
    }

    // Directories first, then case-insensitive by name.
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

    let items: Vec<Value> = entries.into_iter().map(|(_, _, v)| v).collect();
    Ok(Json(json!({ "path": rel, "entries": items })))
}

pub async fn read_file(
    Path(ws_id): Path<String>,
    Query(q): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let root = workspace_root(&state, &ws_id).await?;
    let rel = normalize_rel(&q.path);
    if rel.is_empty() {
        return Err(AppError::BadRequest("path is required".into()));
    }
    let file = resolve_in_workspace_async(root, rel.clone()).await?;

    let meta = tokio::fs::metadata(&file)
        .await
        .map_err(|_| AppError::NotFound(format!("file not found: {rel}")))?;
    if meta.is_dir() {
        return Err(AppError::BadRequest(format!("not a file: {rel}")));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(AppError::PayloadTooLarge(format!(
            "file is {} bytes, limit is {MAX_READ_BYTES}",
            meta.len()
        )));
    }

    let bytes = tokio::fs::read(&file)
        .await
        .map_err(|e| AppError::Internal(format!("cannot read file: {e}")))?;

    // A binary file is reported, not an error: the editor shows a "binary
    // file" placeholder rather than a failed request. A NUL byte counts as
    // binary even when the bytes happen to be valid UTF-8 — plenty of binary
    // formats are, and this is the same heuristic the search walk uses.
    let (content, encoding) = if bytes.contains(&0) {
        (String::new(), "binary")
    } else {
        match String::from_utf8(bytes) {
            Ok(text) => (text, "utf-8"),
            Err(_) => (String::new(), "binary"),
        }
    };

    Ok(Json(json!({
        "path": rel,
        "content": content,
        "encoding": encoding,
        "size": meta.len(),
        "modifiedMs": modified_ms(&meta),
    })))
}

pub async fn write_file(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<WriteFileBody>,
) -> Result<Json<Value>> {
    let root = workspace_root(&state, &ws_id).await?;
    let rel = normalize_rel(&body.path);
    if rel.is_empty() {
        return Err(AppError::BadRequest("path is required".into()));
    }
    let file = resolve_in_workspace_async(root, rel.clone()).await?;

    let current = tokio::fs::metadata(&file).await.ok();
    if let Some(base) = body.base_modified_ms {
        match &current {
            Some(meta) if meta.is_dir() => {
                return Err(AppError::BadRequest(format!("not a file: {rel}")));
            }
            Some(meta) => {
                let actual = modified_ms(meta);
                if actual != base {
                    return Err(AppError::Conflict(format!(
                        "file changed on disk (expected mtime {base}, found {actual})"
                    )));
                }
            }
            // The client believed it was editing an existing file that is now
            // gone. Recreating it silently would resurrect a deleted file.
            None => {
                return Err(AppError::Conflict(format!(
                    "file no longer exists on disk: {rel}"
                )));
            }
        }
    } else if current.as_ref().is_some_and(|m| m.is_dir()) {
        return Err(AppError::BadRequest(format!("not a file: {rel}")));
    }

    if let Some(parent) = file.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Internal(format!("cannot create directory: {e}")))?;
    }

    tokio::fs::write(&file, body.content.as_bytes())
        .await
        .map_err(|e| AppError::Internal(format!("cannot write file: {e}")))?;

    let meta = tokio::fs::metadata(&file)
        .await
        .map_err(|e| AppError::Internal(format!("cannot stat file: {e}")))?;

    Ok(Json(json!({
        "path": rel,
        "size": meta.len(),
        "modifiedMs": modified_ms(&meta),
    })))
}

#[derive(Deserialize)]
pub struct CreateDirBody {
    pub path: String,
}

/// Creates a directory, and any missing parents, inside the workspace.
///
/// There is no equivalent for files because there does not need to be:
/// `write_file` with no `baseModifiedMs` already creates one (that branch is
/// what the editor's "save a new file" path uses). A directory has no content
/// to write, so it is the one creation the file API could not express.
///
/// An existing path is a 409 rather than a silent success. `create_dir_all` is
/// idempotent and would happily return OK, but the caller here is a user who
/// typed a name — telling them it is already taken is the useful answer, and it
/// keeps "New folder" from looking like it worked when it adopted someone
/// else's directory.
pub async fn create_directory(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<CreateDirBody>,
) -> Result<Json<Value>> {
    let root = workspace_root(&state, &ws_id).await?;
    let rel = normalize_rel(&body.path);
    if rel.is_empty() {
        return Err(AppError::BadRequest("path is required".into()));
    }
    let dir = resolve_in_workspace_async(root, rel.clone()).await?;
    create_dir_checked(&dir, &rel).await?;
    Ok(Json(json!({ "path": rel })))
}

/// The filesystem half of [`create_directory`], split out so the conflict rules
/// are testable without standing up an `AppState`. `rel` is carried only to
/// name the path in error messages — confinement was already decided by
/// `resolve_in_workspace`.
async fn create_dir_checked(dir: &StdPath, rel: &str) -> Result<()> {
    if let Ok(meta) = tokio::fs::metadata(dir).await {
        return Err(AppError::Conflict(if meta.is_dir() {
            format!("directory already exists: {rel}")
        } else {
            format!("a file already exists at: {rel}")
        }));
    }

    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| AppError::Internal(format!("cannot create directory: {e}")))?;

    Ok(())
}

pub async fn search_files(
    Path(ws_id): Path<String>,
    Query(q): Query<SearchQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let root = workspace_root(&state, &ws_id).await?;
    let needle = q.q.trim().to_string();
    if needle.is_empty() {
        return Err(AppError::BadRequest("q is required".into()));
    }
    let max = q.max.unwrap_or(DEFAULT_SEARCH_MAX).clamp(1, MAX_SEARCH_MAX);
    // Confinement also applies to the search root, and this canonicalizes it.
    let root = resolve_in_workspace_async(root, String::new()).await?;

    // The `ignore` walk is synchronous and reads every candidate file, so it
    // must not run on a runtime worker thread.
    let (matches, truncated) =
        tokio::task::spawn_blocking(move || search_blocking(&root, &needle, max))
            .await
            .map_err(|e| AppError::Internal(format!("search failed: {e}")))?;

    Ok(Json(json!({ "matches": matches, "truncated": truncated })))
}

fn search_blocking(root: &StdPath, needle: &str, max: usize) -> (Vec<Value>, bool) {
    let needle_lower = needle.to_ascii_lowercase();
    let mut out: Vec<Value> = Vec::new();
    let mut truncated = false;

    let walker = ignore::WalkBuilder::new(root)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .hidden(true)
        .follow_links(false)
        // Without this the crate only applies .gitignore inside a git repo,
        // and a workspace folder is very often not one.
        .require_git(false)
        // `ignore` only skips node_modules/target when a .gitignore actually
        // lists them, so a bound folder without one gets its whole
        // node_modules read on every search. Excluding the same directories
        // the watcher hides keeps the two consistent and bounds the walk.
        .filter_entry(|entry| {
            // Depth 0 is the search root itself — a workspace that happens to
            // be named `target` must still be searchable.
            if entry.depth() == 0 || !entry.file_type().is_some_and(|t| t.is_dir()) {
                return true;
            }
            !entry
                .file_name()
                .to_str()
                .is_some_and(|name| IGNORED_DIRS.contains(&name))
        })
        .build();

    'walk: for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() as usize > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else { continue };
        // A NUL byte is the same binary heuristic git uses.
        if bytes.contains(&0) {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&bytes) else { continue };

        let rel = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");

        for (idx, line) in text.lines().enumerate() {
            let Some(column) = find_case_insensitive(line, &needle_lower) else {
                continue;
            };
            if out.len() >= max {
                truncated = true;
                break 'walk;
            }
            out.push(json!({
                "path": rel,
                "line": idx + 1,
                "column": column,
                "preview": preview(line),
            }));
        }
    }

    (out, truncated)
}

/// Byte offset of the first ASCII-case-insensitive match of
/// `needle_lower_ascii`, which the caller has already lowercased.
///
/// `to_ascii_lowercase` maps only `A-Z`, so unlike full `to_lowercase` it is
/// byte-length preserving for ALL input including UTF-8 — byte `i` of the
/// lowercased line is byte `i` of the original. That is what makes the
/// returned offset valid against the original line, and it is why there is no
/// case-sensitive fallback: the old one silently made `todo` miss
/// `TODO: café`, and made every line case-sensitive for a non-ASCII needle.
fn find_case_insensitive(line: &str, needle_lower_ascii: &str) -> Option<usize> {
    line.to_ascii_lowercase().find(needle_lower_ascii)
}

fn preview(line: &str) -> String {
    let trimmed = line.trim_end();
    if trimmed.chars().count() <= PREVIEW_CHARS {
        return trimmed.to_string();
    }
    trimmed.chars().take(PREVIEW_CHARS).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn normalize_rel_strips_trailing_separators_and_backslashes() {
        assert_eq!(normalize_rel(""), "");
        assert_eq!(normalize_rel("src/main.rs/"), "src/main.rs");
        assert_eq!(normalize_rel("src\\main.rs"), "src/main.rs");
    }

    /// An absolute path must stay absolute so resolve_in_workspace can reject
    /// it with "path must be relative" rather than quietly reinterpreting it.
    #[test]
    fn normalize_rel_keeps_absolute_paths_absolute() {
        assert_eq!(normalize_rel("/etc/passwd"), "/etc/passwd");
        // A bare "/" collapses to the root, which is the workspace itself.
        assert_eq!(normalize_rel("/"), "");
    }

    #[test]
    fn join_rel_omits_the_separator_at_the_root() {
        assert_eq!(join_rel("", "a.txt"), "a.txt");
        assert_eq!(join_rel("src", "a.txt"), "src/a.txt");
    }

    #[test]
    fn find_case_insensitive_matches_regardless_of_case() {
        assert_eq!(find_case_insensitive("Hello World", "world"), Some(6));
        assert_eq!(find_case_insensitive("HELLO WORLD", "world"), Some(6));
        assert_eq!(find_case_insensitive("Hello World", "nope"), None);
    }

    /// The old implementation fell back to a CASE-SENSITIVE search on any
    /// non-ASCII line, so `todo` did not find `TODO` here.
    #[test]
    fn find_case_insensitive_still_folds_case_on_non_ascii_lines() {
        assert_eq!(find_case_insensitive("// TODO: café", "todo"), Some(3));
    }

    /// `to_ascii_lowercase` is byte-length preserving for all input, so the
    /// offset it produces addresses the ORIGINAL line — including past a
    /// multi-byte character, where a full `to_lowercase` would have drifted.
    #[test]
    fn find_case_insensitive_offsets_address_the_original_line() {
        // "İ" is two bytes and lowercases to two CHARS under to_lowercase.
        let line = "İstanbul LET x";
        let col = find_case_insensitive(line, "let").unwrap();
        assert_eq!(&line[col..col + 3], "LET");
    }

    #[test]
    fn preview_truncates_long_lines_on_a_char_boundary() {
        let long = "é".repeat(PREVIEW_CHARS + 50);
        let p = preview(&long);
        assert_eq!(p.chars().count(), PREVIEW_CHARS + 1);
        assert!(p.ends_with('…'));
        assert_eq!(preview("  short  "), "  short");
    }

    #[test]
    fn search_respects_gitignore_and_skips_binaries() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(d.path().join("hit.txt"), "alpha NEEDLE omega\n").unwrap();
        fs::write(d.path().join("ignored.txt"), "NEEDLE\n").unwrap();
        fs::write(d.path().join("bin.dat"), b"NEEDLE\x00\x01").unwrap();

        let root = d.path().canonicalize().unwrap();
        let (matches, truncated) = search_blocking(&root, "needle", 200);

        assert!(!truncated);
        assert_eq!(matches.len(), 1, "got {matches:?}");
        assert_eq!(matches[0]["path"], "hit.txt");
        assert_eq!(matches[0]["line"], 1);
        assert_eq!(matches[0]["column"], 6);
    }

    /// No `.gitignore` at all, so `ignore` alone would happily read every file
    /// under node_modules. The explicit filter is what bounds the walk.
    #[test]
    fn search_skips_ignored_directories_without_a_gitignore() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("node_modules")).unwrap();
        fs::write(d.path().join("node_modules/dep.js"), "NEEDLE\n").unwrap();
        fs::create_dir(d.path().join("target")).unwrap();
        fs::write(d.path().join("target/build.log"), "NEEDLE\n").unwrap();
        fs::write(d.path().join("src.js"), "NEEDLE\n").unwrap();

        let root = d.path().canonicalize().unwrap();
        let (matches, _) = search_blocking(&root, "needle", 200);

        assert_eq!(matches.len(), 1, "got {matches:?}");
        assert_eq!(matches[0]["path"], "src.js");
    }

    /// Only whole directory names are hidden — a source file named `target.rs`
    /// and a directory named `targets` are ordinary content.
    #[test]
    fn search_does_not_skip_names_that_merely_resemble_ignored_dirs() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("target.rs"), "NEEDLE\n").unwrap();
        fs::create_dir(d.path().join("targets")).unwrap();
        fs::write(d.path().join("targets/list.json"), "NEEDLE\n").unwrap();

        let root = d.path().canonicalize().unwrap();
        let (matches, _) = search_blocking(&root, "needle", 200);

        assert_eq!(matches.len(), 2, "got {matches:?}");
    }

    #[test]
    fn search_caps_results_and_reports_truncation() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("many.txt"), "needle\n".repeat(50)).unwrap();

        let root = d.path().canonicalize().unwrap();
        let (matches, truncated) = search_blocking(&root, "needle", 10);

        assert_eq!(matches.len(), 10);
        assert!(truncated);
    }

    #[tokio::test]
    async fn create_dir_makes_missing_parents() {
        let d = tempfile::tempdir().unwrap();
        let nested = d.path().join("a/b/c");

        create_dir_checked(&nested, "a/b/c").await.unwrap();

        assert!(nested.is_dir());
        assert!(d.path().join("a").is_dir(), "parents are created too");
    }

    /// `create_dir_all` is idempotent and would return OK here. That is the
    /// wrong answer for a user who just typed a name: "New folder" would look
    /// like it created something when it silently adopted an existing tree.
    #[tokio::test]
    async fn create_dir_refuses_an_existing_directory() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("src")).unwrap();

        let err = create_dir_checked(&d.path().join("src"), "src")
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::Conflict(ref m) if m.contains("directory already exists")),
            "got {err:?}"
        );
    }

    /// A file sitting where the directory should go is a different mistake and
    /// gets its own wording — `create_dir_all` would fail here with a raw
    /// `File exists` I/O error and a 500.
    #[tokio::test]
    async fn create_dir_refuses_a_path_occupied_by_a_file() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("notes.txt"), "hi").unwrap();

        let err = create_dir_checked(&d.path().join("notes.txt"), "notes.txt")
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::Conflict(ref m) if m.contains("a file already exists")),
            "got {err:?}"
        );
    }
}
