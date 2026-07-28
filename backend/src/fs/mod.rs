use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, Result};

/// Resolve a client-supplied RELATIVE path against a workspace root.
///
/// Canonicalizes BOTH sides before comparing, because a symlink inside the
/// workspace can point outside it and a naive `starts_with` on the unresolved
/// path would accept it.
pub fn resolve_in_workspace(root: &Path, rel: &str) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .map_err(|_| AppError::BadRequest("workspace folder is not accessible".into()))?;

    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(AppError::BadRequest("path must be relative".into()));
    }
    if rel_path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(AppError::BadRequest("path must not contain ..".into()));
    }

    let joined = root.join(rel_path);

    // The target may not exist yet (new file). Canonicalize the deepest
    // existing ancestor and re-append the remainder.
    let (existing, remainder) = deepest_existing(&joined);
    let canonical_existing = existing
        .canonicalize()
        .map_err(|_| AppError::NotFound(format!("path not found: {rel}")))?;
    if !canonical_existing.starts_with(&root) {
        return Err(AppError::Forbidden("path escapes the workspace".into()));
    }
    // `join("")` appends a trailing separator, and "some/file/" is ENOTDIR for
    // a regular file. PathBuf equality is component-based and hides this, so
    // it only shows up against the real filesystem.
    if remainder.as_os_str().is_empty() {
        return Ok(canonical_existing);
    }
    Ok(canonical_existing.join(remainder))
}

/// Split `p` into (deepest ancestor that exists, remaining components).
///
/// Existence is tested with `symlink_metadata`, NOT `exists()`: `exists()`
/// follows symlinks and so reports `false` for a DANGLING symlink. A dangling
/// symlink inside the workspace pointing outside it would then be stripped as
/// a "not yet created" component, the confinement check would pass against the
/// parent, and a subsequent write would follow the link and land outside the
/// workspace. Treating it as existing makes `canonicalize()` fail on it, so
/// the request fails closed.
fn deepest_existing(p: &Path) -> (PathBuf, PathBuf) {
    let mut base = p.to_path_buf();
    let mut rest = PathBuf::new();
    while base.symlink_metadata().is_err() {
        let Some(name) = base.file_name().map(|s| s.to_owned()) else { break };
        let Some(parent) = base.parent().map(|s| s.to_path_buf()) else { break };
        rest = if rest.as_os_str().is_empty() {
            PathBuf::from(&name)
        } else {
            PathBuf::from(&name).join(&rest)
        };
        base = parent;
    }
    (base, rest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_root() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("sub")).unwrap();
        fs::write(d.path().join("sub/a.txt"), "hi").unwrap();
        d
    }

    #[test]
    fn resolves_paths_inside_the_root() {
        let d = tmp_root();
        let p = resolve_in_workspace(d.path(), "sub/a.txt").unwrap();
        assert!(p.ends_with("sub/a.txt"));
    }

    /// Guards the `join("")` trailing-separator trap: `PathBuf` compares by
    /// component and treats "…/a.txt/" as equal to "…/a.txt", so only an
    /// actual syscall catches it — the kernel returns ENOTDIR.
    #[test]
    fn resolved_existing_file_is_readable() {
        let d = tmp_root();
        let p = resolve_in_workspace(d.path(), "sub/a.txt").unwrap();
        assert!(!p.as_os_str().to_string_lossy().ends_with('/'));
        assert_eq!(fs::read_to_string(&p).unwrap(), "hi");
    }

    #[test]
    fn rejects_parent_traversal() {
        let d = tmp_root();
        assert!(resolve_in_workspace(d.path(), "../etc/passwd").is_err());
        assert!(resolve_in_workspace(d.path(), "sub/../../escape").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        let d = tmp_root();
        assert!(resolve_in_workspace(d.path(), "/etc/passwd").is_err());
    }

    #[test]
    fn rejects_symlink_escaping_the_root() {
        let d = tmp_root();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), "s").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path().join("secret"), d.path().join("link")).unwrap();
        #[cfg(unix)]
        assert!(resolve_in_workspace(d.path(), "link").is_err());
    }

    #[test]
    fn empty_path_resolves_to_the_root() {
        let d = tmp_root();
        assert_eq!(
            resolve_in_workspace(d.path(), "").unwrap(),
            d.path().canonicalize().unwrap()
        );
    }

    /// A DANGLING symlink pointing outside the workspace is the write-side
    /// version of `rejects_symlink_escaping_the_root`: the target does not
    /// exist, so an `exists()`-based split would treat "link" as a file to be
    /// created and let the write follow the link out of the workspace.
    #[cfg(unix)]
    #[test]
    fn rejects_dangling_symlink_pointing_outside_the_root() {
        let d = tmp_root();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("does-not-exist-yet"),
            d.path().join("dangling"),
        )
        .unwrap();
        assert!(resolve_in_workspace(d.path(), "dangling").is_err());
    }

    /// A symlinked DIRECTORY pointing outside the workspace must not become a
    /// write path either, even when the final component is new.
    #[cfg(unix)]
    #[test]
    fn rejects_new_file_under_a_symlinked_directory() {
        let d = tmp_root();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("escape-dir")).unwrap();
        assert!(resolve_in_workspace(d.path(), "escape-dir/new.txt").is_err());
    }

    /// Writes target files that do not exist yet — the split must keep the
    /// new components instead of rejecting the path outright.
    #[test]
    fn resolves_paths_that_do_not_exist_yet() {
        let d = tmp_root();
        let p = resolve_in_workspace(d.path(), "sub/nested/new.txt").unwrap();
        assert!(p.ends_with("sub/nested/new.txt"));
        assert!(p.starts_with(d.path().canonicalize().unwrap()));
    }
}
