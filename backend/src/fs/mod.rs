use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, Result};

/// Directory names no filesystem feature ever descends into.
///
/// Shared by the file watcher (`ws::watch`, which would otherwise push tens of
/// thousands of frames through the socket for one `npm install`) and by search
/// (`routes::files`, which would otherwise read every file in `node_modules`
/// when the bound folder has no `.gitignore` listing it). One constant so the
/// two can never disagree about what is invisible.
pub const IGNORED_DIRS: [&str; 3] = [".git", "node_modules", "target"];

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

    // One rule instead of separate `is_absolute` and `..` checks, because
    // `is_absolute()` is not the question. On Windows a DRIVE-RELATIVE path
    // like `C:foo` has a Prefix but no RootDir, so it is not "absolute" — yet
    // `PathBuf::push` documents that a path with a prefix and no root REPLACES
    // the receiver, so `root.join("C:foo")` discards the workspace root
    // entirely and resolves against the process CWD on drive C.
    //
    // Requiring every component to be `Normal` rejects Prefix, RootDir,
    // ParentDir and CurDir in a single pass, on both platforms. An empty path
    // has no components and still resolves to the root itself.
    if !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(AppError::BadRequest(
            "path must be a plain relative path".into(),
        ));
    }

    // Windows resolves reserved device names inside ANY directory, so
    // `workspace/COM1` is the serial port, not a file. `tokio::fs::read` on
    // `CON` or `COM1` blocks with no timeout and holds a runtime worker
    // forever; `NUL` silently swallows writes.
    #[cfg(windows)]
    if rel_path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .any(is_reserved_device_name)
    {
        return Err(AppError::BadRequest(
            "path contains a reserved device name".into(),
        ));
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
    // KNOWN TOCTOU, accepted deliberately: the `remainder` components did not
    // exist at check time and are not re-validated, so a local process that
    // replaces one with a symlink between this call and the caller's I/O could
    // steer a write outside the workspace. The backend has no auth and already
    // runs with the user's full privileges — anyone able to win this race can
    // simply write the file themselves — so the guard buys nothing against a
    // realistic attacker. If it is ever hardened, the shape is `O_NOFOLLOW` on
    // the final open plus re-canonicalizing the parent after `create_dir_all`.
    Ok(canonical_existing.join(remainder))
}

/// `resolve_in_workspace` off the async executor.
///
/// It does 1..N synchronous `canonicalize`/`symlink_metadata` syscalls, and
/// every filesystem request goes through it. On a local SSD that is
/// microseconds and invisible; on an SMB/NFS/sshfs mount or a stalled external
/// volume a single stat blocks for SECONDS, and doing it on a runtime worker
/// stalls every unrelated request the server is serving alongside it.
///
/// Takes owned arguments because `spawn_blocking` needs a `'static` closure.
pub async fn resolve_in_workspace_async(root: PathBuf, rel: String) -> Result<PathBuf> {
    tokio::task::spawn_blocking(move || resolve_in_workspace(&root, &rel))
        .await
        .map_err(|e| AppError::Internal(format!("path resolution failed: {e}")))?
}

/// Windows device names that are magic in every directory.
const RESERVED_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Whether `name` is a Windows reserved device name.
///
/// An extension does not help: `COM1.txt` is still the serial port. Matching
/// is case-insensitive, and trailing spaces and dots are stripped because
/// Win32 strips them before resolving the name.
///
/// Compiled on every platform — only the enforcement in
/// `resolve_in_workspace` is `#[cfg(windows)]` — so this stays unit-testable
/// from a Unix CI host.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let stem = stem.trim_end_matches([' ', '.']);
    RESERVED_DEVICE_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
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

    /// The all-`Component::Normal` rule is stricter than the `is_absolute` +
    /// `..` pair it replaced: `CurDir` is rejected too, so there is exactly
    /// one spelling of any given path and no component reaches `join` that
    /// could re-anchor it.
    #[test]
    fn rejects_paths_with_non_normal_components() {
        let d = tmp_root();
        assert!(resolve_in_workspace(d.path(), "./sub/a.txt").is_err());
        assert!(resolve_in_workspace(d.path(), "..").is_err());
    }

    /// `COM1.txt` is still the serial port on Windows, and so is `com1 `.
    /// A name that merely CONTAINS a device name is an ordinary file.
    #[test]
    fn recognises_windows_reserved_device_names() {
        for name in ["CON", "com1", "NUL", "LPT9", "COM1.txt", "aux.log", "COM1 "] {
            assert!(is_reserved_device_name(name), "{name} should be reserved");
        }
        for name in ["CONFIG", "COM", "COM10", "console.log", "a.CON", "nulled"] {
            assert!(!is_reserved_device_name(name), "{name} should be allowed");
        }
    }

    /// Drive-relative `C:foo` has a Prefix but no RootDir, so `is_absolute()`
    /// reported `false` and let it through — and `join` then discarded the
    /// workspace root entirely.
    #[cfg(windows)]
    #[test]
    fn rejects_windows_drive_relative_paths() {
        let d = tmp_root();
        assert!(resolve_in_workspace(d.path(), "C:foo").is_err());
        assert!(resolve_in_workspace(d.path(), r"C:\Windows\win.ini").is_err());
    }

    /// A read of `COM1` blocks forever and pins a runtime worker, so it must
    /// never reach the filesystem layer.
    #[cfg(windows)]
    #[test]
    fn rejects_windows_reserved_device_paths() {
        let d = tmp_root();
        assert!(resolve_in_workspace(d.path(), "COM1").is_err());
        assert!(resolve_in_workspace(d.path(), "sub/con.txt").is_err());
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
