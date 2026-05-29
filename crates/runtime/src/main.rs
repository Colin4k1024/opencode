use anyhow::Result;
use clap::Parser;
use std::sync::Arc;
use tracing::info;

mod router;

#[derive(Parser)]
#[command(name = "opencode-sidecar", about = "OpenCode Rust Runtime Sidecar")]
struct Cli {
    /// Socket path (auto-generated if not specified)
    #[arg(long)]
    socket: Option<String>,

    /// Log level
    #[arg(long, default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    tracing_subscriber::fmt()
        .with_env_filter(&cli.log_level)
        .json()
        .init();

    let socket_path = cli.socket.unwrap_or_else(|| {
        let pid = std::process::id();
        format!("/tmp/opencode-{pid}.sock")
    });

    // Remove stale socket
    let _ = std::fs::remove_file(&socket_path);

    let listener = tokio::net::UnixListener::bind(&socket_path)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;
    }

    // Print socket path to stdout for TS host to read
    println!("{socket_path}");

    info!(socket = %socket_path, "opencode sidecar started");

    let state = Arc::new(router::AppState::new());

    loop {
        let (stream, _addr) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, state).await {
                tracing::error!(error = %e, "connection error");
            }
        });
    }
}

async fn handle_connection(
    stream: tokio::net::UnixStream,
    state: Arc<router::AppState>,
) -> Result<()> {
    use opencode_protocol::frame::{FrameReader, FrameWriter};
    use opencode_protocol::jsonrpc::{Request, Response};
    use opencode_protocol::{FRAME_JSONRPC, FRAME_SHUTDOWN};

    let (reader, writer) = stream.into_split();
    let mut frame_reader = FrameReader::new(reader);
    let frame_writer = FrameWriter::new(writer);

    // Handshake
    let init_frame = frame_reader.read_frame().await?;
    if init_frame.frame_type != FRAME_JSONRPC {
        anyhow::bail!("expected JSON-RPC frame, got {}", init_frame.frame_type);
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
