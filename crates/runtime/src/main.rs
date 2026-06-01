use anyhow::Result;
use clap::Parser;
use opencode_runtime::router;
use std::sync::Arc;
use tracing::info;

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

    // Print socket path to stdout for the TS host to read
    println!("{socket_path}");

    info!(socket = %socket_path, "opencode sidecar started");

    let state = Arc::new(router::AppState::new());

    loop {
        let (stream, _addr) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = opencode_runtime::handle_connection(stream, state).await {
                tracing::error!(error = %e, "connection error");
            }
        });
    }
}
