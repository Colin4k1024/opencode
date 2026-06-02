//! RPC method router — dispatches JSON-RPC requests to handlers

use opencode_protocol::frame::FrameWriter;
use opencode_protocol::jsonrpc::{self, Response};
use opencode_pty::{PtyManager, SpawnParams};
use opencode_tools::{file, glob, grep, git, shell};
use opencode_session as session;
use opencode_agent::AgentRegistry;
use opencode_mcp::{McpClient, McpServerConfig};
use opencode_llm::bridge::{LlmBridge, StreamParams};
use opencode_plugin::PluginRegistry;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;
use rusqlite::Connection;
use tracing::info;

/// Application state shared across all connections
pub struct AppState {
    pub pty_manager: PtyManager,
    pub db: Mutex<Connection>,
    pub agents: AgentRegistry,
    pub mcp_clients: Mutex<std::collections::HashMap<String, McpClient>>,
    pub llm_bridge: LlmBridge,
    pub plugins: PluginRegistry,
}

impl AppState {
    pub fn new() -> Self {
        let db_path = std::env::var("OPENCODE_DB_PATH")
            .unwrap_or_else(|_| ":memory:".to_string());
        let db = session::init_db(&db_path).expect("failed to init session db");

        // Load plugins from OPENCODE_PLUGINS_DIR if set
        let plugins = std::env::var("OPENCODE_PLUGINS_DIR")
            .ok()
            .and_then(|dir| PluginRegistry::load_from_dir(&dir).ok())
            .unwrap_or_default();

        Self {
            pty_manager: PtyManager::new(),
            db: Mutex::new(db),
            agents: AgentRegistry::new(),
            mcp_clients: Mutex::new(std::collections::HashMap::new()),
            llm_bridge: LlmBridge::new(),
            plugins,
        }
    }
}

/// Dispatch a JSON-RPC request to the appropriate handler.
///
/// `writer` is used only by streaming methods (`llm.stream`) to push
/// `FRAME_MSGPACK` events back asynchronously after the initial response.
pub async fn dispatch(
    state: &Arc<AppState>,
    writer: &FrameWriter,
    method: &str,
    id: i64,
    params: Value,
) -> Response {
    match method {
        // ── System ────────────────────────────────────────────────────────────
        "system.ping" => Response::success(id, serde_json::json!({"pong": true})),
        "system.shutdown" => {
            info!("shutdown requested");
            Response::success(id, serde_json::json!({}))
        }

        // ── PTY ───────────────────────────────────────────────────────────────
        "pty.spawn"  => handle_pty_spawn(state, id, params).await,
        "pty.write"  => handle_pty_write(state, id, params).await,
        "pty.resize" => handle_pty_resize(state, id, params).await,
        "pty.kill"   => handle_pty_kill(state, id, params).await,
        "pty.list"   => handle_pty_list(state, id).await,

        // ── Tools: Shell ──────────────────────────────────────────────────────
        "tools.shell.exec" => handle_shell_exec(id, params).await,

        // ── Process (direct execution, no shell wrapper) ─────────────────────
        "process.run" => handle_process_run(id, params).await,

        // ── Tools: File ───────────────────────────────────────────────────────
        "tools.file.read"  => handle_file_read(id, params).await,
        "tools.file.write" => handle_file_write(id, params).await,
        "tools.file.edit"  => handle_file_edit(id, params).await,

        // ── Tools: Search ─────────────────────────────────────────────────────
        "tools.glob" => handle_glob(id, params).await,
        "tools.grep" => handle_grep(id, params).await,

        // ── Tools: Git ────────────────────────────────────────────────────────
        "tools.git.status" => handle_git_status(id, params).await,
        "tools.git.log"    => handle_git_log(id, params).await,
        "tools.git.diff"   => handle_git_diff(id, params).await,

        // ── Session ───────────────────────────────────────────────────────────
        "session.create"         => handle_session_create(state, id, params).await,
        "session.get"            => handle_session_get(state, id, params).await,
        "session.list"           => handle_session_list(state, id).await,
        "session.update_title"   => handle_session_update_title(state, id, params).await,
        "session.delete"         => handle_session_delete(state, id, params).await,
        "session.append_message" => handle_session_append_message(state, id, params).await,
        "session.get_messages"   => handle_session_get_messages(state, id, params).await,

        // ── Agent ─────────────────────────────────────────────────────────────
        "agent.list" => handle_agent_list(state, id).await,
        "agent.get"  => handle_agent_get(state, id, params).await,

        // ── MCP ───────────────────────────────────────────────────────────────
        "mcp.connect"    => handle_mcp_connect(state, id, params).await,
        "mcp.list_tools" => handle_mcp_list_tools(state, id, params).await,
        "mcp.call_tool"  => handle_mcp_call_tool(state, id, params).await,
        "mcp.disconnect" => handle_mcp_disconnect(state, id, params).await,
        "mcp.list"       => handle_mcp_list(state, id).await,

        // ── LLM streaming ─────────────────────────────────────────────────────
        "llm.stream" => handle_llm_stream(state, writer, id, params).await,
        "llm.cancel" => handle_llm_cancel(state, id, params).await,

        // ── Plugin ────────────────────────────────────────────────────────────
        "plugin.list" => handle_plugin_list(state, id).await,
        "plugin.get"  => handle_plugin_get(state, id, params).await,

        _ => Response::method_not_found(id),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PTY handlers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Shell handler
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_shell_exec(id: i64, params: Value) -> Response {
    let exec_params: shell::ExecParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match shell::exec(exec_params).await {
        Ok(r) => Response::success(id, serde_json::json!({
            "exitCode": r.exit_code,
            "stdout":   r.stdout,
            "stderr":   r.stderr,
        })),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process handler (direct execution)
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_process_run(id: i64, params: Value) -> Response {
    let run_params: shell::ProcessRunParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match shell::process_run(run_params).await {
        Ok(r) => Response::success(id, serde_json::json!({
            "exitCode": r.exit_code,
            "stdout":   r.stdout,
            "stderr":   r.stderr,
        })),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// File handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_file_read(id: i64, params: Value) -> Response {
    let p: file::ReadParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match file::read(p).await {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_file_write(id: i64, params: Value) -> Response {
    let p: file::WriteParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match file::write(p).await {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_file_edit(id: i64, params: Value) -> Response {
    let p: file::EditParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match file::edit(p).await {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_glob(id: i64, params: Value) -> Response {
    let p: glob::GlobParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match glob::glob(p).await {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_grep(id: i64, params: Value) -> Response {
    let p: grep::GrepParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match grep::grep(p).await {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Git handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_git_status(id: i64, params: Value) -> Response {
    let p: git::StatusParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match git::status(p) {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_git_log(id: i64, params: Value) -> Response {
    let p: git::LogParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match git::log(p) {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_git_diff(id: i64, params: Value) -> Response {
    let p: git::DiffParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    match git::diff(p) {
        Ok(r) => Response::success(id, serde_json::to_value(r).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_session_create(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let create_params = session::CreateSessionParams {
        slug: params.get("slug").and_then(|v| v.as_str()).unwrap_or("session").to_string(),
        project_id: params.get("project_id").and_then(|v| v.as_str()).unwrap_or("default").to_string(),
        directory: params.get("directory").and_then(|v| v.as_str()).unwrap_or(".").to_string(),
        title: params.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        parent_id: params.get("parent_id").and_then(|v| v.as_str()).map(str::to_string),
    };
    let db = state.db.lock().await;
    match session::create_session(&db, create_params) {
        Ok(s) => Response::success(id, serde_json::to_value(s).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_session_get(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let session_id = match params.get("id").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing id".to_string()),
    };
    let db = state.db.lock().await;
    match session::get_session(&db, &session_id) {
        Ok(Some(s)) => Response::success(id, serde_json::to_value(s).unwrap_or_default()),
        Ok(None) => Response::error(id, jsonrpc::ERR_SESSION_NOT_FOUND, format!("session {session_id} not found")),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_session_list(state: &Arc<AppState>, id: i64) -> Response {
    let project_id = "default"; // list all sessions under default project
    let db = state.db.lock().await;
    match session::list_sessions(&db, project_id) {
        Ok(sessions) => Response::success(id, serde_json::json!({"sessions": sessions})),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_session_update_title(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let session_id = match params.get("id").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing id".to_string()),
    };
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let db = state.db.lock().await;
    match session::update_title(&db, &session_id, title) {
        Ok(()) => Response::success(id, serde_json::json!({})),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_session_delete(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let session_id = match params.get("id").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing id".to_string()),
    };
    let db = state.db.lock().await;
    match session::delete_session(&db, &session_id) {
        Ok(()) => Response::success(id, serde_json::json!({})),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_session_append_message(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let session_id = match params.get("session_id").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing session_id".to_string()),
    };
    let role = params.get("role").and_then(|v| v.as_str()).unwrap_or("user");
    let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
    // metadata is an optional JSON string
    let metadata_str: Option<String> = params.get("metadata")
        .map(|v| if v.is_string() { v.as_str().unwrap_or("").to_string() } else { v.to_string() });

    let db = state.db.lock().await;
    match session::append_message(&db, &session_id, role, content, metadata_str.as_deref()) {
        Ok(part) => Response::success(id, serde_json::to_value(part).unwrap_or_default()),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_session_get_messages(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let session_id = match params.get("session_id").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing session_id".to_string()),
    };
    let db = state.db.lock().await;
    match session::get_messages(&db, &session_id) {
        Ok(parts) => Response::success(id, serde_json::json!({"messages": parts})),
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_agent_list(state: &Arc<AppState>, id: i64) -> Response {
    let agents = state.agents.list();
    Response::success(id, serde_json::json!({"agents": agents}))
}

async fn handle_agent_get(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let name = match params.get("name").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return Response::invalid_params(id, "missing name".to_string()),
    };
    match state.agents.get(name) {
        Some(agent) => Response::success(id, serde_json::to_value(agent).unwrap_or_default()),
        None => Response::error(id, jsonrpc::ERR_SESSION_NOT_FOUND, format!("agent '{name}' not found")),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_mcp_connect(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let config: McpServerConfig = match serde_json::from_value(params) {
        Ok(c) => c,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };
    let server_name = config.name.clone();

    let client = match McpClient::connect(config).await {
        Ok(c) => c,
        Err(e) => return Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    };
    match client.initialize().await {
        Ok(info) => {
            let mut clients = state.mcp_clients.lock().await;
            clients.insert(server_name.clone(), client);
            Response::success(id, serde_json::json!({
                "name": server_name,
                "server_info": info,
            }))
        }
        Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    }
}

async fn handle_mcp_list_tools(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let server_name = match params.get("name").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing name".to_string()),
    };
    let mut clients = state.mcp_clients.lock().await;
    match clients.get_mut(&server_name) {
        Some(client) => match client.list_tools().await {
            Ok(tools) => Response::success(id, serde_json::json!({"tools": tools})),
            Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
        },
        None => Response::error(id, jsonrpc::ERR_SESSION_NOT_FOUND, format!("MCP server '{server_name}' not connected")),
    }
}

async fn handle_mcp_call_tool(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let server_name = match params.get("name").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing name".to_string()),
    };
    let tool_name = match params.get("tool").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing tool".to_string()),
    };
    let tool_params = params.get("params").cloned().unwrap_or(Value::Object(Default::default()));

    let mut clients = state.mcp_clients.lock().await;
    match clients.get_mut(&server_name) {
        Some(client) => match client.call_tool(&tool_name, tool_params).await {
            Ok(result) => Response::success(id, result),
            Err(e) => Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
        },
        None => Response::error(id, jsonrpc::ERR_SESSION_NOT_FOUND, format!("MCP server '{server_name}' not connected")),
    }
}

async fn handle_mcp_disconnect(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let server_name = match params.get("name").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing name".to_string()),
    };
    let mut clients = state.mcp_clients.lock().await;
    match clients.remove(&server_name) {
        Some(client) => {
            client.disconnect().await;
            Response::success(id, serde_json::json!({}))
        }
        None => Response::error(id, jsonrpc::ERR_SESSION_NOT_FOUND, format!("MCP server '{server_name}' not connected")),
    }
}

async fn handle_mcp_list(state: &Arc<AppState>, id: i64) -> Response {
    let clients = state.mcp_clients.lock().await;
    let names: Vec<&str> = clients.keys().map(|s| s.as_str()).collect();
    Response::success(id, serde_json::json!({"servers": names}))
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM streaming handlers
// ─────────────────────────────────────────────────────────────────────────────

/// `llm.stream` — start an LLM generation stream.
///
/// Returns `{stream_id}` immediately. Events are pushed as `FRAME_MSGPACK`
/// frames on the same connection until the stream completes or is cancelled.
async fn handle_llm_stream(
    state: &Arc<AppState>,
    writer: &FrameWriter,
    id: i64,
    params: Value,
) -> Response {
    let stream_params: StreamParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return Response::invalid_params(id, e.to_string()),
    };

    let (stream_id, mut rx) = match state.llm_bridge.start_stream(stream_params).await {
        Ok(pair) => pair,
        Err(e) => return Response::error(id, jsonrpc::ERR_TOOL_FAILED, e.to_string()),
    };

    // Spawn a forwarder task that pushes FRAME_MSGPACK events back to the client
    let writer_clone = writer.clone();
    let sid_clone = stream_id.clone();
    let bridge = state.llm_bridge.clone_arc();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(e) = writer_clone.write_msgpack_event(&event).await {
                tracing::warn!(stream_id = %sid_clone, error = %e, "stream write failed");
                break;
            }
        }
        bridge.remove_stream(&sid_clone).await;
    });

    Response::success(id, serde_json::json!({"stream_id": stream_id}))
}

/// `llm.cancel` — cancel a running stream by ID.
async fn handle_llm_cancel(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let stream_id = match params.get("stream_id").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return Response::invalid_params(id, "missing stream_id".to_string()),
    };
    let cancelled = state.llm_bridge.cancel_stream(&stream_id).await;
    Response::success(id, serde_json::json!({"cancelled": cancelled}))
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin handlers
// ─────────────────────────────────────────────────────────────────────────────

async fn handle_plugin_list(state: &Arc<AppState>, id: i64) -> Response {
    let plugins = state.plugins.list();
    Response::success(id, serde_json::json!({"plugins": plugins}))
}

async fn handle_plugin_get(state: &Arc<AppState>, id: i64, params: Value) -> Response {
    let name = match params.get("name").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return Response::invalid_params(id, "missing name".to_string()),
    };
    match state.plugins.get(name) {
        Some(plugin) => Response::success(id, serde_json::to_value(plugin).unwrap_or_default()),
        None => Response::error(
            id,
            jsonrpc::ERR_SESSION_NOT_FOUND,
            format!("plugin '{name}' not found"),
        ),
    }
}
