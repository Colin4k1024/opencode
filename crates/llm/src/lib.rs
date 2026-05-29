//! LLM provider abstraction and streaming layer
//!
//! Built on top of `oris-runtime` for multi-provider support:
//! - Anthropic Claude
//! - OpenAI (GPT-4, o-series)
//! - Google Gemini
//! - Amazon Bedrock
//! - DeepSeek
//! - xAI (OpenAI-compatible)
//! - Azure OpenAI (OpenAI-compatible)
//! - Ollama (local)

pub mod provider;
pub mod stream;
pub mod bridge;
pub mod error;

pub use error::LlmError;
pub use provider::{ProviderConfig, ProviderKind, create_provider};
pub use stream::StreamController;
