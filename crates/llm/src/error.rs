//! LLM error types

use thiserror::Error;

#[derive(Error, Debug)]
pub enum LlmError {
    #[error("provider not configured: {0}")]
    ProviderNotConfigured(String),

    #[error("invalid model: {0}")]
    InvalidModel(String),

    #[error("api error: {provider} — {message}")]
    ApiError { provider: String, message: String },

    #[error("rate limited: retry after {retry_after_ms}ms")]
    RateLimited { retry_after_ms: u64 },

    #[error("authentication failed: {0}")]
    AuthFailed(String),

    #[error("stream cancelled")]
    Cancelled,

    #[error("timeout after {0}ms")]
    Timeout(u64),

    #[error("oris error: {0}")]
    Oris(String),
}

impl From<oris_runtime::language_models::LLMError> for LlmError {
    fn from(e: oris_runtime::language_models::LLMError) -> Self {
        let msg = e.to_string();
        if msg.contains("401") || msg.contains("Authentication") {
            LlmError::AuthFailed(msg)
        } else if msg.contains("429") || msg.contains("Rate Limit") {
            LlmError::RateLimited { retry_after_ms: 1000 }
        } else {
            LlmError::Oris(msg)
        }
    }
}
