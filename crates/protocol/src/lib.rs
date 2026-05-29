//! OpenCode IPC Protocol
//!
//! Implements the control plane (JSON-RPC 2.0) and data plane (MsgPack frames)
//! for communication between the TS host and Rust sidecar.

pub mod frame;
pub mod jsonrpc;
pub mod stream_event;

use tokio::net::UnixListener;
use anyhow::Result;

/// Frame type identifiers
pub const FRAME_JSONRPC: u8 = 0x01;
pub const FRAME_MSGPACK: u8 = 0x02;
pub const FRAME_HEARTBEAT: u8 = 0x03;
pub const FRAME_SHUTDOWN: u8 = 0xFF;

/// Create and bind a Unix socket listener
pub async fn listen(path: &str) -> Result<UnixListener> {
    // Remove stale socket file if exists
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;

    // Set socket permissions to 600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(listener)
}

/// Main serve loop — accepts connections and dispatches frames
pub async fn serve(listener: UnixListener) -> Result<()> {
    loop {
        let (stream, _addr) = listener.accept().await?;
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream).await {
                tracing::error!(error = %e, "connection handler failed");
            }
        });
    }
}

async fn handle_connection(stream: tokio::net::UnixStream) -> Result<()> {
    let (reader, writer) = stream.into_split();
    let mut frame_reader = frame::FrameReader::new(reader);
    let frame_writer = frame::FrameWriter::new(writer);

    // Handshake
    let init_frame = frame_reader.read_frame().await?;
    if init_frame.frame_type != FRAME_JSONRPC {
        anyhow::bail!("expected JSON-RPC initialize, got frame type {}", init_frame.frame_type);
    }

    let request: jsonrpc::Request = serde_json::from_slice(&init_frame.payload)?;
    if request.method != "initialize" {
        anyhow::bail!("expected initialize method, got {}", request.method);
    }

    // Send initialize response
    let response = jsonrpc::Response::success(
        request.id,
        serde_json::json!({
            "version": "0.1.0",
            "capabilities": ["tools", "pty", "llm", "session", "mcp"]
        }),
    );
    frame_writer.write_jsonrpc(&response).await?;

    tracing::info!("connection initialized");

    // Main dispatch loop
    loop {
        let frame = match frame_reader.read_frame().await {
            Ok(f) => f,
            Err(_) => break, // Connection closed
        };

        match frame.frame_type {
            FRAME_JSONRPC => {
                let request: jsonrpc::Request = serde_json::from_slice(&frame.payload)?;
                let response = dispatch_request(&request).await;
                frame_writer.write_jsonrpc(&response).await?;
            }
            FRAME_SHUTDOWN => {
                tracing::info!("shutdown frame received");
                break;
            }
            _ => {
                tracing::warn!(frame_type = frame.frame_type, "unexpected frame type");
            }
        }
    }

    Ok(())
}

async fn dispatch_request(request: &jsonrpc::Request) -> jsonrpc::Response {
    match request.method.split('.').next() {
        Some("system") => match request.method.as_str() {
            "system.ping" => jsonrpc::Response::success(request.id, serde_json::json!({"pong": true})),
            "system.shutdown" => jsonrpc::Response::success(request.id, serde_json::json!({})),
            _ => jsonrpc::Response::method_not_found(request.id),
        },
        Some("tools") => {
            // TODO: Phase 1-2 implementation
            jsonrpc::Response::method_not_found(request.id)
        }
        Some("pty") => {
            // TODO: Phase 1 implementation
            jsonrpc::Response::method_not_found(request.id)
        }
        Some("llm") => {
            // TODO: Phase 3 implementation
            jsonrpc::Response::method_not_found(request.id)
        }
        Some("session") | Some("agent") => {
            // TODO: Phase 4 implementation
            jsonrpc::Response::method_not_found(request.id)
        }
        Some("mcp") | Some("plugin") => {
            // TODO: Phase 5 implementation
            jsonrpc::Response::method_not_found(request.id)
        }
        _ => jsonrpc::Response::method_not_found(request.id),
    }
}
