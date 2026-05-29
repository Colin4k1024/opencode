//! MsgPack stream event types for LLM data plane

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub stream_id: String,
    pub seq: u64,
    #[serde(flatten)]
    pub event: Event,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum Event {
    #[serde(rename = "token")]
    Token { text: String },

    #[serde(rename = "tool_call_start")]
    ToolCallStart { id: String, name: String },

    #[serde(rename = "tool_call_delta")]
    ToolCallDelta { id: String, args_delta: String },

    #[serde(rename = "tool_call_end")]
    ToolCallEnd { id: String },

    #[serde(rename = "tool_result")]
    ToolResult { id: String, result: serde_json::Value },

    #[serde(rename = "usage")]
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        cache_read: Option<u64>,
        cache_write: Option<u64>,
    },

    #[serde(rename = "error")]
    Error { code: i32, message: String },

    #[serde(rename = "done")]
    Done { finish_reason: String },
}
