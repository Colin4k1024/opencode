//! Integration tests for the OpenCode runtime sidecar.
//!
//! Each test spins up an in-process Unix socket server backed by a real
//! `AppState` and drives it through the full IPC framing stack.

use opencode_protocol::frame::{FrameReader, FrameWriter};
use opencode_protocol::jsonrpc::Response;
use opencode_protocol::{FRAME_JSONRPC, FRAME_SHUTDOWN};
use opencode_runtime::router::AppState;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::net::{UnixListener, UnixStream};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Monotonically increasing counter so each test gets its own socket path.
static SOCKET_COUNTER: AtomicU32 = AtomicU32::new(0);

fn unique_socket_path() -> String {
    let n = SOCKET_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("/tmp/opencode-itest-{}-{}.sock", std::process::id(), n)
}

/// Bind a temp Unix socket, spawn a server task, and return a connected client
/// frame-pair that has already completed the `initialize` handshake.
async fn connect() -> (FrameWriter, FrameReader) {
    let socket_path = unique_socket_path();
    let _ = std::fs::remove_file(&socket_path);

    let listener = UnixListener::bind(&socket_path).expect("bind");
    let socket_path_clone = socket_path.clone();

    let state = Arc::new(AppState::new());

    // Server task — handles exactly one connection then cleans up
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept");
        opencode_runtime::handle_connection(stream, state)
            .await
            .ok();
        let _ = std::fs::remove_file(&socket_path_clone);
    });

    // Give the server task a moment to bind before we connect
    tokio::task::yield_now().await;

    let client_stream = UnixStream::connect(&socket_path)
        .await
        .expect("connect");
    let (reader, writer) = client_stream.into_split();
    let mut frame_reader = FrameReader::new(reader);
    let frame_writer = FrameWriter::new(writer);

    // Send initialize
    send_request(&frame_writer, 1, "initialize", serde_json::Value::Null).await;

    // Read and validate initialize response
    let frame = frame_reader.read_frame().await.expect("read init frame");
    let resp: Response = serde_json::from_slice(&frame.payload).expect("parse init resp");
    let result = resp.result.expect("init result");
    assert_eq!(result["version"], "0.1.0");
    assert!(result["capabilities"].as_array().is_some());

    (frame_writer, frame_reader)
}

/// Write a JSON-RPC request frame.
async fn send_request(writer: &FrameWriter, id: i64, method: &str, params: serde_json::Value) {
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });
    let payload = serde_json::to_vec(&req).expect("serialize request");
    writer
        .write_frame(FRAME_JSONRPC, &payload)
        .await
        .expect("write frame");
}

/// Read one JSON-RPC response frame.
async fn read_response(reader: &mut FrameReader) -> Response {
    let frame = reader.read_frame().await.expect("read frame");
    assert_eq!(frame.frame_type, FRAME_JSONRPC);
    serde_json::from_slice(&frame.payload).expect("parse response")
}

// ── IPC tests ─────────────────────────────────────────────────────────────────

/// The initialize handshake completes successfully and reports capabilities.
#[tokio::test]
async fn test_ipc_initialize_handshake() {
    // connect() already asserts the handshake; passing here is sufficient.
    let _ = connect().await;
}

/// `system.ping` returns `{"pong": true}`.
#[tokio::test]
async fn test_ipc_system_ping() {
    let (writer, mut reader) = connect().await;

    send_request(&writer, 2, "system.ping", serde_json::Value::Null).await;
    let resp = read_response(&mut reader).await;

    assert!(resp.error.is_none(), "unexpected error: {:?}", resp.error);
    assert_eq!(resp.result.expect("result")["pong"], true);
}

/// An unknown method returns a `Method not found` error (code -32601).
#[tokio::test]
async fn test_ipc_unknown_method_returns_error() {
    let (writer, mut reader) = connect().await;

    send_request(&writer, 3, "no.such.method", serde_json::Value::Null).await;
    let resp = read_response(&mut reader).await;

    let err = resp.error.expect("expected JSON-RPC error");
    assert_eq!(err.code, -32601, "expected Method not found");
}

/// `tools.shell.exec` runs `echo` via `sh -c` and returns stdout.
///
/// Note: `ExecParams.command` is a shell string — `sh -c "<command>"`.
#[tokio::test]
async fn test_ipc_tools_shell_exec_echo() {
    let (writer, mut reader) = connect().await;

    let params = serde_json::json!({
        "command": "echo 'hello integration'",
        "cwd": "/tmp",
        "timeout_ms": 5000
    });
    send_request(&writer, 4, "tools.shell.exec", params).await;
    let resp = read_response(&mut reader).await;

    assert!(resp.error.is_none(), "unexpected error: {:?}", resp.error);
    let result = resp.result.expect("result");
    assert_eq!(result["exitCode"], 0);
    let stdout = result["stdout"].as_str().expect("stdout");
    assert!(stdout.contains("hello integration"), "stdout={stdout:?}");
}

/// `tools.shell.exec` reports a non-zero exit code for a failing shell command.
#[tokio::test]
async fn test_ipc_tools_shell_exec_nonzero_exit() {
    let (writer, mut reader) = connect().await;

    let params = serde_json::json!({
        "command": "exit 42",
        "cwd": "/tmp",
        "timeout_ms": 5000
    });
    send_request(&writer, 5, "tools.shell.exec", params).await;
    let resp = read_response(&mut reader).await;

    assert!(resp.error.is_none(), "unexpected error: {:?}", resp.error);
    assert_eq!(resp.result.expect("result")["exitCode"], 42);
}

/// `tools.shell.exec` captures stderr separately.
#[tokio::test]
async fn test_ipc_tools_shell_exec_stderr() {
    let (writer, mut reader) = connect().await;

    let params = serde_json::json!({
        "command": "echo 'error output' >&2",
        "cwd": "/tmp",
        "timeout_ms": 5000
    });
    send_request(&writer, 6, "tools.shell.exec", params).await;
    let resp = read_response(&mut reader).await;

    assert!(resp.error.is_none(), "unexpected error: {:?}", resp.error);
    let result = resp.result.expect("result");
    let stderr = result["stderr"].as_str().expect("stderr");
    assert!(stderr.contains("error output"), "stderr={stderr:?}");
}

/// PTY: spawn → list → kill lifecycle.
#[tokio::test]
async fn test_ipc_pty_lifecycle() {
    let (writer, mut reader) = connect().await;

    // Spawn — env is Vec<[String, String]> (array of two-element arrays)
    let spawn_params = serde_json::json!({
        "command": "/bin/sh",
        "args": [],
        "cwd": "/tmp",
        "cols": 80,
        "rows": 24,
        "env": null
    });
    send_request(&writer, 10, "pty.spawn", spawn_params).await;
    let resp = read_response(&mut reader).await;
    assert!(resp.error.is_none(), "pty.spawn error: {:?}", resp.error);
    let pty_id = resp.result.expect("spawn result")["id"]
        .as_str()
        .expect("id")
        .to_string();

    // List — the PTY must appear
    send_request(&writer, 11, "pty.list", serde_json::Value::Null).await;
    let list_resp = read_response(&mut reader).await;
    let sessions: Vec<String> = list_resp.result.expect("list result")["sessions"]
        .as_array()
        .expect("sessions array")
        .iter()
        .map(|v| v.as_str().unwrap_or("").to_string())
        .collect();
    assert!(sessions.contains(&pty_id), "PTY not in list: {sessions:?}");

    // Kill
    send_request(&writer, 12, "pty.kill", serde_json::json!({"id": &pty_id})).await;
    let kill_resp = read_response(&mut reader).await;
    assert!(kill_resp.error.is_none(), "pty.kill error: {:?}", kill_resp.error);

    // List — the PTY must be gone
    send_request(&writer, 13, "pty.list", serde_json::Value::Null).await;
    let list_after = read_response(&mut reader).await;
    let sessions_after: Vec<String> = list_after.result.expect("list result")["sessions"]
        .as_array()
        .expect("sessions array")
        .iter()
        .map(|v| v.as_str().unwrap_or("").to_string())
        .collect();
    assert!(
        !sessions_after.contains(&pty_id),
        "killed PTY still in list: {sessions_after:?}"
    );
}

/// A FRAME_SHUTDOWN terminates the server connection; the next read yields EOF.
#[tokio::test]
async fn test_ipc_shutdown_frame_terminates_connection() {
    let (writer, mut reader) = connect().await;

    writer
        .write_frame(FRAME_SHUTDOWN, &[])
        .await
        .expect("write shutdown");

    // The server closes its end; the next read should hit EOF
    let result = reader.read_frame().await;
    assert!(result.is_err(), "expected EOF after shutdown, got Ok frame");
}

/// Multiple sequential requests on the same connection have matching ids.
#[tokio::test]
async fn test_ipc_sequential_requests_match_ids() {
    let (writer, mut reader) = connect().await;

    for id in [20i64, 21, 22] {
        send_request(&writer, id, "system.ping", serde_json::Value::Null).await;
        let resp = read_response(&mut reader).await;
        assert_eq!(resp.id, id, "response id mismatch at id={id}");
    }
}

// ── Router unit tests (no socket) ─────────────────────────────────────────────

/// `dispatch()` returns `{"pong": true}` for `system.ping`.
#[tokio::test]
async fn test_router_dispatch_system_ping() {
    let state = Arc::new(AppState::new());
    let resp =
        opencode_runtime::router::dispatch(&state, "system.ping", 99, serde_json::Value::Null)
            .await;
    assert!(resp.error.is_none());
    assert_eq!(resp.result.unwrap()["pong"], true);
}

/// `dispatch()` returns Method Not Found (-32601) for unknown methods.
#[tokio::test]
async fn test_router_dispatch_unknown_method() {
    let state = Arc::new(AppState::new());
    let resp = opencode_runtime::router::dispatch(
        &state,
        "unknown.method",
        100,
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(resp.error.expect("expected error").code, -32601);
}

/// `dispatch()` handles `tools.shell.exec` end-to-end via the router.
#[tokio::test]
async fn test_router_dispatch_shell_exec() {
    let state = Arc::new(AppState::new());
    // ExecParams uses `command` as a shell string — no separate `args`
    let params = serde_json::json!({
        "command": "echo 'router-direct'",
        "cwd": "/tmp",
        "timeout_ms": 5000
    });
    let resp =
        opencode_runtime::router::dispatch(&state, "tools.shell.exec", 101, params).await;
    assert!(resp.error.is_none(), "{:?}", resp.error);
    let r = resp.result.unwrap();
    assert_eq!(r["exitCode"], 0);
    let stdout = r["stdout"].as_str().unwrap();
    assert!(stdout.contains("router-direct"), "stdout={stdout:?}");
}
