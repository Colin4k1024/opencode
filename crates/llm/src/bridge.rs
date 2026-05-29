//! Bridge between JSON-RPC requests and the LLM streaming layer
//!
//! Handles `llm.stream` and `llm.cancel` RPC methods.

use crate::provider::{ProviderConfig, ProviderKind};
use crate::stream::{LlmMessage, StreamController};
use opencode_protocol::stream_event::StreamEvent;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::info;

/// Manages active LLM streams
pub struct LlmBridge {
    streams: Arc<RwLock<HashMap<String, StreamController>>>,
}

impl LlmBridge {
    pub fn new() -> Self {
        Self {
            streams: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Start a new LLM stream
    pub async fn start_stream(
        &self,
        params: StreamParams,
    ) -> Result<(String, mpsc::UnboundedReceiver<StreamEvent>), crate::LlmError> {
        let stream_id = format!("stream-{}", ulid_lite::ulid());

        let config = ProviderConfig {
            kind: params.provider,
            model: params.model,
            api_key: params.api_key,
            base_url: params.base_url,
            max_tokens: params.max_tokens,
            temperature: params.temperature,
            top_p: params.top_p,
        };

        let (controller, rx) =
            StreamController::start(stream_id.clone(), config, params.messages, params.system)?;

        self.streams.write().await.insert(stream_id.clone(), controller);

        info!(stream_id = %stream_id, "stream started");
        Ok((stream_id, rx))
    }

    /// Cancel an active stream
    pub async fn cancel_stream(&self, stream_id: &str) -> bool {
        if let Some(controller) = self.streams.write().await.remove(stream_id) {
            controller.cancel();
            true
        } else {
            false
        }
    }

    /// Remove a completed stream
    pub async fn remove_stream(&self, stream_id: &str) {
        self.streams.write().await.remove(stream_id);
    }
}

impl Default for LlmBridge {
    fn default() -> Self {
        Self::new()
    }
}

/// Parameters for starting an LLM stream
#[derive(Debug, Deserialize)]
pub struct StreamParams {
    pub provider: ProviderKind,
    pub model: String,
    pub messages: Vec<LlmMessage>,
    pub system: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

/// Minimal ULID-like ID generator (no external dep needed)
mod ulid_lite {
    use std::time::{SystemTime, UNIX_EPOCH};

    pub fn ulid() -> String {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let rand: u64 = rand_u64();
        format!("{ts:012x}-{rand:016x}")
    }

    fn rand_u64() -> u64 {
        // Simple random using thread_rng equivalent
        let mut buf = [0u8; 8];
        getrandom::fill(&mut buf).unwrap_or_default();
        u64::from_le_bytes(buf)
    }
}
