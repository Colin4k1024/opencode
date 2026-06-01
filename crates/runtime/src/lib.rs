//! OpenCode Runtime sidecar — library interface.
//!
//! Exposes `router` and `handle_connection` so integration tests can drive the
//! server in-process without spawning a subprocess.

pub mod router;

use anyhow::Result;
use opencode_protocol::frame::{FrameReader, FrameWriter};
use opencode_protocol::jsonrpc::{Request, Response};
use opencode_protocol::{FRAME_JSONRPC, FRAME_SHUTDOWN};
use std::sync::Arc;
use tracing::info;

/// Run the JSON-RPC dispatch loop for a single Unix socket connection.
pub async fn handle_connection(
    stream: tokio::net::UnixStream,
    state: Arc<router::AppState>,
) -> Result<()> {
    let (reader, writer) = stream.into_split();
    let mut frame_reader = FrameReader::new(reader);
    let frame_writer = FrameWriter::new(writer);

    // Handshake — first frame must be an `initialize` request
    let init_frame = frame_reader.read_frame().await?;
    if init_frame.frame_type != FRAME_JSONRPC {
        anyhow::bail!(
            "expected JSON-RPC frame, got type {}",
            init_frame.frame_type
        );
    }

    let request: Request = serde_json::from_slice(&init_frame.payload)?;
    if request.method != "initialize" {
        anyhow::bail!("expected initialize, got {}", request.method);
    }

    let response = Response::success(
        request.id,
        serde_json::json!({
            "version": "0.1.0",
            "capabilities": ["tools", "pty", "llm", "session", "mcp"]
        }),
    );
    frame_writer.write_jsonrpc(&response).await?;
    info!("client connected and initialized");

    // Main dispatch loop
    loop {
        let frame = match frame_reader.read_frame().await {
            Ok(f) => f,
            Err(_) => break,
        };

        match frame.frame_type {
            FRAME_JSONRPC => {
                let request: Request = serde_json::from_slice(&frame.payload)?;
                let response =
                    router::dispatch(&state, &request.method, request.id, request.params).await;
                frame_writer.write_jsonrpc(&response).await?;
            }
            FRAME_SHUTDOWN => {
                info!("shutdown received");
                break;
            }
            _ => {}
        }
    }

    Ok(())
}
