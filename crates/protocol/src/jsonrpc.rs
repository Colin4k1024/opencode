//! JSON-RPC 2.0 types

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: i64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Notification (server → client, no id)
#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    pub params: serde_json::Value,
}

impl Response {
    pub fn success(id: i64, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: i64, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(RpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }

    pub fn method_not_found(id: i64) -> Self {
        Self::error(id, -32601, "Method not found")
    }

    pub fn invalid_params(id: i64, msg: impl Into<String>) -> Self {
        Self::error(id, -32602, msg)
    }

    pub fn internal_error(id: i64, msg: impl Into<String>) -> Self {
        Self::error(id, -32603, msg)
    }
}

impl Notification {
    pub fn new(method: impl Into<String>, params: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params,
        }
    }
}

// Error codes
pub const ERR_TOOL_FAILED: i32 = -32000;
pub const ERR_PTY_NOT_FOUND: i32 = -32001;
pub const ERR_SESSION_NOT_FOUND: i32 = -32002;
pub const ERR_PROVIDER_ERROR: i32 = -32003;
pub const ERR_PERMISSION_DENIED: i32 = -32004;
pub const ERR_TIMEOUT: i32 = -32005;
