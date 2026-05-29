//! RPC method router — dispatches JSON-RPC requests to handlers

use opencode_protocol::jsonrpc::{self, Response};
use opencode_pty::{PtyManager, SpawnParams};
use opencode_tools::shell;
use serde_json::Value;
use std::sync::Arc;
use tracing::info;

/// Application state shared across all connections
pub struct AppState {
    pub pty_manager: PtyManager,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pty_manager: PtyManager::new(),
        }
    }
}

/// Dispatch a JSON-RPC request to the appropriate handler
pub async fn dispatch(state: &Arc<AppState>, method: &str, id: i64, params: Value) -> Response {
    match method {
        // System
        "system.ping" => Response::success(id, serde_json::json!({"pong": true})),
        "system.shutdown" => {
            info!("shutdown requested");
            Response::success(id, serde_json::json!({}))
        }

        // PTY
        "pty.spawn" => handle_pty_spawn(state, id, params).await,
        "pty.write" => handle_pty_write(state, id, params).await,
        "pty.resize" => handle_pty_resize(state, id, params).await,
        "pty.kill" => handle_pty_kill(state, id, params).await,
        "pty.list" => handle_pty_list(state, id).await,

        // Tools: Shell
        "tools.shell.exec" => handle_shell_exec(id, params).await,

        _ => Response::method_not_found(id),
    }
}

// --- PTY Handlers ---

async fn handle_pty_spawn(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let spawn_params: SpawnParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };

    match state.pty_manager.spawn(spawn_params) {
        Ok(pty_id) => Response::success(id, serde_json::json!({"id": pty_id})),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_pty_write(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let pty_id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let data = params.get("data").and_then(|v| v.as_str()).unwrap_or("");

    match state.pty_manager.write(pty_id, data.as_bytes()).await {
        Ok(()) => Response::success(id, serde_json::json!({})),
        Err(e) => Response::error(id, jsonrpc::ERR_PTY_NOT_FOUND, e.to_string()),
    }
}

async fn handle_pty_resize(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let pty_id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let cols = params.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
    let rows = params.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;

    match state.pty_manager.resize(pty_id, cols, rows).await {
        Ok(()) => Response::success(id, serde_json::json!({})),
        Err(e) => Response::error(id, jsonrpc::ERR_PTY_NOT_FOUND, e.to_string()),
    }
}

async fn handle_pty_kill(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let pty_id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");

    match state.pty_manager.kill(pty_id).await {
        Ok(()) => Response::success(id, serde_json::json!({})),
        Err(e) => Response::error(id, jsonrpc::ERR_PTY_NOT_FOUND, e.to_string()),
    }
}

async fn handle_pty_list(state: &Arc<AppState>, id: i64) -> Response {
    let ids = state.pty_manager.list().await;
    Response::success(id, serde_json::json!({"sessions": ids}))
}

// --- Shell Handlers ---

async fn handle_shell_exec(id: i64, params: Value) -> Response {
    let exec_params: shell::ExecParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };

    match shell::exec(exec_params).await {
        Ok(result) => Response::success(
            id,
            serde_json::json!({
                "exitCode": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }),
        ),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}
