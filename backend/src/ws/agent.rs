//! WebSocket attach for agent sessions.
//!
//! Unlike `ws/shell.rs`, this handler does **not** own a PTY. It borrows one
//! from [`AgentRegistry`], streams it, and leaves. Closing the socket drops a
//! broadcast subscriber and nothing else — the agent keeps working, which is
//! the entire point of the supervisor.
//!
//! ## Replay ordering
//!
//! On attach the client must first see the scrollback and then the live stream,
//! with no chunk lost between the two and none shown twice.
//! [`AgentSession::attach`] guarantees that by taking the scrollback mutex,
//! subscribing, and snapshotting under one lock, while the registry's pump
//! holds the same mutex across push+broadcast. So for any output chunk exactly
//! one of two things is true: the pump finished push+send before we took the
//! lock, so the chunk is in the snapshot and the broadcast (which only delivers
//! sends made after `subscribe`) skips it; or the pump takes the lock after we
//! released it, so the chunk is not in the snapshot and reaches us live.
//!
//! What is left to *this* file is the other half: the replay must be written to
//! the socket before the first live chunk. It is — one task owns the sink and
//! sends the replay before its first `recv()`.

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use tokio::sync::broadcast::error::RecvError;

use crate::agents::{AgentRegistry, SessionStatus};
use crate::error::{AppError, Result};
use crate::AppState;

/// Shown when a row survives in `agent_sessions` but its PTY does not — the
/// server restarted, or the session was deleted. There is nothing to replay, so
/// say why instead of leaving a blank terminal.
const GONE_NOTICE: &str =
    "\r\n\x1b[33m[this agent session is no longer running and its output is gone]\x1b[0m\r\n";

/// Rejects an unknown session id *before* the upgrade.
///
/// After upgrading, the only way to report "no such session" is a close frame,
/// which the browser surfaces as a generic connection failure. A live session
/// is in the registry; an old one is only in the table.
pub async fn ensure_session_exists(state: &AppState, session_id: &str) -> Result<()> {
    if state.agents.get(session_id).is_some() {
        return Ok(());
    }

    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM agent_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_optional(&state.db)
        .await?;

    exists
        .map(|_| ())
        .ok_or_else(|| AppError::NotFound(format!("agent session {session_id} not found")))
}

pub async fn handle_agent(socket: WebSocket, registry: AgentRegistry, session_id: String) {
    let mut socket = socket;

    let Some(session) = registry.get(&session_id) else {
        let _ = socket.send(Message::Text(GONE_NOTICE.to_string())).await;
        let _ = socket.send(Message::Close(None)).await;
        return;
    };

    // Snapshot + subscribe under one lock — see the module docs.
    let (replay, mut output_rx) = session.attach();
    // Attaching to an exited session is deliberately allowed: the scrollback
    // outlives the process so the user can read how it ended.
    let epilogue = match session.status() {
        SessionStatus::Running => None,
        SessionStatus::Exited { code } => Some(exit_notice(code)),
    };

    let (mut sink, mut stream) = socket.split();

    // Task: registry → socket. Owns the sink, so the replay provably precedes
    // every live chunk.
    let mut forward = tokio::spawn(async move {
        let mut carry: Vec<u8> = Vec::new();
        if !replay.is_empty() {
            let (text, rest) = decode_carrying_partial(&replay);
            carry = rest;
            if sink.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
        if let Some(notice) = epilogue {
            if sink.send(Message::Text(notice)).await.is_err() {
                return;
            }
        }

        loop {
            match output_rx.recv().await {
                Ok(chunk) => {
                    // A chunk boundary can fall mid-codepoint, and so can the
                    // scrollback's byte-oriented truncation. Carrying the
                    // trailing partial sequence into the next chunk keeps a
                    // box-drawing character or emoji from arriving as garbage.
                    carry.extend_from_slice(&chunk);
                    let (text, rest) = decode_carrying_partial(&carry);
                    carry = rest;
                    if text.is_empty() {
                        continue;
                    }
                    if sink.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    // This socket fell behind. The registry's broadcast means
                    // the PTY reader and the other subscribers never noticed.
                    // A gap is better reported than silently stitched over.
                    carry.clear();
                    let notice = format!(
                        "\r\n\x1b[33m[{n} chunk(s) of output dropped — this view fell behind]\x1b[0m\r\n"
                    );
                    if sink.send(Message::Text(notice)).await.is_err() {
                        break;
                    }
                }
                // The session holds a sender clone for as long as it is
                // registered, so this only fires once the session is gone.
                Err(RecvError::Closed) => break,
            }
        }
    });

    // Task: socket → PTY. Input and resize, same wire shape as `ws/shell.rs`.
    let input_session = session.clone();
    let mut input = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            let data = match msg {
                Message::Text(t) => t.into_bytes(),
                Message::Binary(b) => b,
                Message::Close(_) => break,
                _ => continue,
            };

            if let Some((rows, cols)) = parse_resize(&data) {
                let _ = input_session.resize(rows, cols);
                continue;
            }

            if input_session.write_input(data).await.is_err() {
                break;
            }
        }
    });

    // Whichever side ends first, stop the other and return. Nothing here owns
    // the child, the reader thread or the writer, so detaching cannot kill the
    // agent — dropping `output_rx` is the whole of the cleanup.
    tokio::select! {
        _ = &mut forward => input.abort(),
        _ = &mut input => forward.abort(),
    }
}

fn exit_notice(code: Option<i32>) -> String {
    match code {
        Some(c) => format!("\r\n\x1b[33m[agent exited with code {c}]\x1b[0m\r\n"),
        None => "\r\n\x1b[33m[agent exited]\x1b[0m\r\n".to_string(),
    }
}

/// Recognises the `{"type":"resize","rows":R,"cols":C}` control message.
///
/// Returns `None` for anything else, including plain JSON the user happened to
/// type, which is then forwarded to the PTY as ordinary input.
fn parse_resize(data: &[u8]) -> Option<(u16, u16)> {
    let json: serde_json::Value = serde_json::from_slice(data).ok()?;
    if json.get("type")?.as_str()? != "resize" {
        return None;
    }
    let rows = json.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
    let cols = json.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
    Some((rows.max(1), cols.max(1)))
}

/// Decodes as much of `bytes` as forms complete UTF-8, returning the text plus
/// the trailing bytes of any incomplete sequence for the caller to prepend to
/// the next chunk.
///
/// The carry is at most three bytes: a byte that cannot start or continue a
/// sequence is reported by `from_utf8` as an error with a length, not as a
/// truncation, and is replaced here rather than carried forever.
fn decode_carrying_partial(bytes: &[u8]) -> (String, Vec<u8>) {
    let mut out = String::with_capacity(bytes.len());
    let mut rest = bytes;

    loop {
        match std::str::from_utf8(rest) {
            Ok(s) => {
                out.push_str(s);
                return (out, Vec::new());
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(std::str::from_utf8(&rest[..valid]).unwrap_or_default());
                match e.error_len() {
                    // Truncated at the end of the chunk — carry it forward.
                    None => return (out, rest[valid..].to_vec()),
                    // Genuinely invalid bytes; one bad byte must not poison the
                    // rest of the stream.
                    Some(n) => {
                        out.push(char::REPLACEMENT_CHARACTER);
                        rest = &rest[valid + n..];
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plain_ascii_without_carry() {
        let (text, carry) = decode_carrying_partial(b"tick 1\r\n");
        assert_eq!(text, "tick 1\r\n");
        assert!(carry.is_empty());
    }

    #[test]
    fn carries_a_codepoint_split_across_chunks() {
        // "└─" — the second character's three bytes are split 1/2 by the chunk
        // boundary, which is exactly what an 8 KiB PTY read does to a TUI.
        let full = "└─".as_bytes();
        let (a, b) = full.split_at(4);

        let (text_a, carry_a) = decode_carrying_partial(a);
        assert_eq!(text_a, "└");
        assert_eq!(carry_a.len(), 1);

        let mut next = carry_a;
        next.extend_from_slice(b);
        let (text_b, carry_b) = decode_carrying_partial(&next);
        assert_eq!(text_b, "─");
        assert!(carry_b.is_empty());
        assert!(!text_a.contains(char::REPLACEMENT_CHARACTER));
        assert!(!text_b.contains(char::REPLACEMENT_CHARACTER));
    }

    #[test]
    fn carry_never_exceeds_three_bytes() {
        // A 4-byte emoji truncated after its first byte is the longest possible
        // carry; nothing may accumulate beyond a single sequence.
        for cut in 1..4 {
            let bytes = "🎉".as_bytes();
            let (text, carry) = decode_carrying_partial(&bytes[..cut]);
            assert!(text.is_empty(), "cut {cut} produced {text:?}");
            assert!(carry.len() <= 3);
        }
    }

    #[test]
    fn invalid_bytes_are_replaced_not_carried() {
        // A lone continuation byte can never become valid, so carrying it would
        // stall the stream forever.
        let (text, carry) = decode_carrying_partial(&[0x41, 0x80, 0x42]);
        assert_eq!(text, "A\u{fffd}B");
        assert!(carry.is_empty());
    }

    #[test]
    fn scrollback_truncated_mid_codepoint_still_decodes_its_tail() {
        // The ring buffer truncates by byte, so a replay can begin mid-sequence.
        let bytes = "é done".as_bytes();
        let (text, carry) = decode_carrying_partial(&bytes[1..]);
        assert!(text.ends_with(" done"));
        assert!(carry.is_empty());
    }

    #[test]
    fn parses_a_resize_control_message() {
        assert_eq!(
            parse_resize(br#"{"type":"resize","rows":40,"cols":120}"#),
            Some((40, 120))
        );
    }

    #[test]
    fn resize_clamps_zero_dimensions() {
        // A zero-sized PTY is meaningless and some platforms reject it.
        assert_eq!(
            parse_resize(br#"{"type":"resize","rows":0,"cols":0}"#),
            Some((1, 1))
        );
    }

    #[test]
    fn non_resize_input_is_not_treated_as_control() {
        assert_eq!(parse_resize(b"ls -la\r"), None);
        assert_eq!(parse_resize(br#"{"type":"data"}"#), None);
        assert_eq!(parse_resize(br#"{"rows":40}"#), None);
        // Valid JSON the user typed is input, not a control frame.
        assert_eq!(parse_resize(br#"{"a":1}"#), None);
    }

    #[test]
    fn exit_notice_names_the_code_when_known() {
        assert!(exit_notice(Some(137)).contains("code 137"));
        assert!(exit_notice(None).contains("exited"));
    }
}
