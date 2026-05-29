//! MCP (Model Context Protocol) client
//!
//! Implements JSON-RPC 2.0 over stdio or SSE transport.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tracing::{debug, warn};

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum McpError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    #[error("protocol error: {0}")]
    ProtocolError(String),

    #[error("tool not found: {0}")]
    ToolNotFound(String),

    #[error("timeout waiting for response")]
    Timeout,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Stdio,
    Sse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub transport: Transport,
    /// Executable path (stdio transport)
    pub command: Option<String>,
    /// Arguments for the executable (stdio transport)
    #[serde(default)]
    pub args: Vec<String>,
    /// SSE endpoint URL
    pub url: Option<String>,
    /// Extra environment variables
    #[serde(default)]
    pub env: HashMap<String, String>,
}

// ── Result types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

// ── JSON-RPC primitives ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<u64>,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

// ── Internal transport state ──────────────────────────────────────────────────

#[allow(dead_code)]
enum TransportState {
    Stdio {
        _child: Child,
        stdin: ChildStdin,
        stdout: BufReader<ChildStdout>,
    },
    Sse,
}

// ── McpClient ────────────────────────────────────────────────────────────────

pub struct McpClient {
    state: Arc<Mutex<Option<TransportState>>>,
    id_counter: Arc<AtomicU64>,
}

impl std::fmt::Debug for McpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpClient").finish_non_exhaustive()
    }
}

impl McpClient {
    /// Connect to an MCP server according to `config`.
    pub async fn connect(config: McpServerConfig) -> Result<Self, McpError> {
        let state = match config.transport {
            Transport::Stdio => {
                let cmd = config.command.as_deref().ok_or_else(|| {
                    McpError::ConnectionFailed("stdio transport requires `command`".into())
                })?;

                let mut command = tokio::process::Command::new(cmd);
                command.args(&config.args);
                command.envs(&config.env);
                command.stdin(std::process::Stdio::piped());
                command.stdout(std::process::Stdio::piped());
                command.stderr(std::process::Stdio::null());

                let mut child = command.spawn().map_err(|e| {
                    McpError::ConnectionFailed(format!("failed to spawn `{}`: {}", cmd, e))
                })?;

                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| McpError::ConnectionFailed("no stdin pipe".into()))?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| McpError::ConnectionFailed("no stdout pipe".into()))?;

                debug!("MCP stdio process spawned for `{}`", config.name);
                TransportState::Stdio {
                    _child: child,
                    stdin,
                    stdout: BufReader::new(stdout),
                }
            }
            Transport::Sse => {
                return Err(McpError::ConnectionFailed(
                    "SSE not yet implemented".into(),
                ));
            }
        };

        Ok(Self {
            state: Arc::new(Mutex::new(Some(state))),
            id_counter: Arc::new(AtomicU64::new(1)),
        })
    }

    /// Send the `initialize` request and return server info.
    pub async fn initialize(&self) -> Result<ServerInfo, McpError> {
        let params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "opencode",
                "version": "0.1.0"
            }
        });

        let result = self.send_request("initialize", params).await?;

        let name = result
            .get("serverInfo")
            .and_then(|si| si.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let version = result
            .get("serverInfo")
            .and_then(|si| si.get("version"))
            .and_then(|v| v.as_str())
            .unwrap_or("0.0.0")
            .to_string();

        let capabilities: Vec<String> = result
            .get("capabilities")
            .and_then(|c| c.as_object())
            .map(|obj| obj.keys().cloned().collect())
            .unwrap_or_default();

        Ok(ServerInfo {
            name,
            version,
            capabilities,
        })
    }

    /// List available tools provided by the server.
    pub async fn list_tools(&self) -> Result<Vec<ToolInfo>, McpError> {
        let result = self
            .send_request("tools/list", serde_json::Value::Null)
            .await?;

        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .ok_or_else(|| McpError::ProtocolError("missing `tools` array in response".into()))?;

        tools
            .iter()
            .map(|t| {
                let name = t
                    .get("name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| McpError::ProtocolError("tool missing `name`".into()))?
                    .to_string();

                let description = t
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let input_schema = t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(serde_json::Value::Object(Default::default()));

                Ok(ToolInfo {
                    name,
                    description,
                    input_schema,
                })
            })
            .collect()
    }

    /// Call a tool by name with the given JSON arguments.
    pub async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        let params = serde_json::json!({
            "name": name,
            "arguments": args
        });

        let result = self.send_request("tools/call", params).await?;

        // The MCP spec wraps results in a `content` array; return the whole result
        // and let the caller interpret it.
        Ok(result)
    }

    /// Gracefully disconnect from the server.
    pub async fn disconnect(&self) {
        let mut guard = self.state.lock().await;
        if let Some(state) = guard.take() {
            match state {
                TransportState::Stdio { mut _child, .. } => {
                    let _ = _child.kill().await;
                    debug!("MCP stdio process terminated");
                }
                TransportState::Sse => {}
            }
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    async fn send_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        let id = self.id_counter.fetch_add(1, Ordering::SeqCst);

        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let mut line = serde_json::to_string(&request)?;
        line.push('\n');

        let mut guard = self.state.lock().await;
        let state = guard
            .as_mut()
            .ok_or_else(|| McpError::ConnectionFailed("client is disconnected".into()))?;

        match state {
            TransportState::Stdio { stdin, stdout, .. } => {
                stdin.write_all(line.as_bytes()).await?;
                stdin.flush().await?;

                // Read responses until we find the one matching our id
                loop {
                    let mut response_line = String::new();
                    let n = stdout.read_line(&mut response_line).await?;
                    if n == 0 {
                        return Err(McpError::ProtocolError("server closed connection".into()));
                    }

                    let trimmed = response_line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    let response: JsonRpcResponse = match serde_json::from_str(trimmed) {
                        Ok(r) => r,
                        Err(e) => {
                            warn!("failed to parse MCP response: {}: {}", e, trimmed);
                            continue;
                        }
                    };

                    if response.id != Some(id) {
                        debug!("skipping response with id {:?}, waiting for {}", response.id, id);
                        continue;
                    }

                    if let Some(err) = response.error {
                        return Err(McpError::ProtocolError(format!(
                            "server error {}: {}",
                            err.code, err.message
                        )));
                    }

                    return response
                        .result
                        .ok_or_else(|| McpError::ProtocolError("response has no result".into()));
                }
            }
            TransportState::Sse => {
                Err(McpError::ConnectionFailed("SSE not yet implemented".into()))
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── JSON-RPC message formatting ───────────────────────────────────────────

    #[test]
    fn test_jsonrpc_request_serialization() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 42,
            method: "tools/list".to_string(),
            params: serde_json::Value::Null,
        };
        let json = serde_json::to_string(&req).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["jsonrpc"], "2.0");
        assert_eq!(v["id"], 42);
        assert_eq!(v["method"], "tools/list");
    }

    #[test]
    fn test_jsonrpc_response_deserialization_ok() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#;
        let resp: JsonRpcResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(resp.id, Some(1));
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_jsonrpc_response_deserialization_error() {
        let raw = r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}"#;
        let resp: JsonRpcResponse = serde_json::from_str(raw).unwrap();
        assert!(resp.result.is_none());
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    // ── Tool list parsing ─────────────────────────────────────────────────────

    #[test]
    fn test_tool_info_parsing() {
        let payload = serde_json::json!({
            "tools": [
                {
                    "name": "read_file",
                    "description": "Reads a file from disk",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"}
                        },
                        "required": ["path"]
                    }
                },
                {
                    "name": "write_file",
                    "description": "Writes content to a file",
                    "inputSchema": {}
                }
            ]
        });

        let tools = payload["tools"].as_array().unwrap();
        let parsed: Vec<ToolInfo> = tools
            .iter()
            .map(|t| ToolInfo {
                name: t["name"].as_str().unwrap().to_string(),
                description: t["description"].as_str().unwrap_or("").to_string(),
                input_schema: t.get("inputSchema").cloned().unwrap_or_default(),
            })
            .collect();

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "read_file");
        assert_eq!(parsed[0].description, "Reads a file from disk");
        assert_eq!(parsed[0].input_schema["type"], "object");
        assert_eq!(parsed[1].name, "write_file");
    }

    // ── ServerInfo capability extraction ──────────────────────────────────────

    #[test]
    fn test_server_info_capability_parsing() {
        let result = serde_json::json!({
            "serverInfo": {"name": "test-server", "version": "1.2.3"},
            "capabilities": {
                "tools": {},
                "prompts": {},
                "resources": {}
            }
        });

        let name = result["serverInfo"]["name"].as_str().unwrap().to_string();
        let version = result["serverInfo"]["version"].as_str().unwrap().to_string();
        let mut caps: Vec<String> = result["capabilities"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        caps.sort();

        let info = ServerInfo {
            name,
            version,
            capabilities: caps,
        };

        assert_eq!(info.name, "test-server");
        assert_eq!(info.version, "1.2.3");
        assert!(info.capabilities.contains(&"tools".to_string()));
        assert!(info.capabilities.contains(&"prompts".to_string()));
        assert!(info.capabilities.contains(&"resources".to_string()));
    }

    // ── SSE stub returns correct error ────────────────────────────────────────

    #[tokio::test]
    async fn test_sse_connect_returns_not_implemented() {
        let config = McpServerConfig {
            name: "test".to_string(),
            transport: Transport::Sse,
            command: None,
            args: vec![],
            url: Some("http://localhost:8080/sse".to_string()),
            env: HashMap::new(),
        };

        let result = McpClient::connect(config).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            McpError::ConnectionFailed(msg) => assert!(msg.contains("SSE not yet implemented")),
            other => panic!("unexpected error: {}", other),
        }
    }

    // ── McpServerConfig serialization ─────────────────────────────────────────

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = McpServerConfig {
            name: "my-mcp".to_string(),
            transport: Transport::Stdio,
            command: Some("/usr/bin/mcp-server".to_string()),
            args: vec!["--verbose".to_string()],
            url: None,
            env: {
                let mut m = HashMap::new();
                m.insert("DEBUG".to_string(), "1".to_string());
                m
            },
        };

        let json = serde_json::to_string(&config).unwrap();
        let decoded: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.name, "my-mcp");
        assert_eq!(decoded.args, vec!["--verbose"]);
        assert_eq!(decoded.env.get("DEBUG"), Some(&"1".to_string()));
    }
}
