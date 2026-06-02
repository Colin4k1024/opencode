//! Provider configuration and factory
//!
//! Maps OpenCode provider identifiers to oris-runtime LLM implementations.

use oris_runtime::language_models::llm::LLM;
use oris_runtime::language_models::options::CallOptions;
use oris_runtime::llm as oris_llm;
use serde::{Deserialize, Serialize};

use crate::LlmError;

/// Supported provider kinds
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    Anthropic,
    OpenAi,
    Google,
    AmazonBedrock,
    Azure,
    DeepSeek,
    XAi,
    Ollama,
    OpenAiCompatible,
}

/// Configuration for creating an LLM provider instance
#[derive(Debug, Clone, Deserialize)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub model: String,
    pub api_key: Option<String>,
    /// Base URL override (for Azure, xAI, OpenAI-compatible)
    pub base_url: Option<String>,
    /// Max output tokens
    pub max_tokens: Option<u32>,
    /// Temperature
    pub temperature: Option<f32>,
    /// Top-p
    pub top_p: Option<f32>,
}

/// Create a boxed LLM provider from config
pub fn create_provider(config: &ProviderConfig) -> Result<Box<dyn LLM>, LlmError> {
    let api_key = config
        .api_key
        .clone()
        .or_else(|| env_key_for_provider(&config.kind))
        .unwrap_or_default();

    let options = build_options(config);

    match config.kind {
        ProviderKind::Anthropic => {
            let client = oris_llm::Claude::new()
                .with_model(&config.model)
                .with_api_key(&api_key)
                .with_options(options);
            Ok(Box::new(client))
        }
        ProviderKind::OpenAi | ProviderKind::XAi | ProviderKind::Azure | ProviderKind::OpenAiCompatible => {
            // OpenAI and compatible providers all use the OpenAI client
            // with_model accepts any string via Into<String>
            let client = oris_llm::OpenAI::default()
                .with_model(config.model.clone())
                .with_options(options);
            Ok(Box::new(client))
        }
        ProviderKind::Google => {
            let client = oris_llm::Gemini::new()
                .with_model(&config.model)
                .with_api_key(&api_key)
                .with_options(options);
            Ok(Box::new(client))
        }
        ProviderKind::AmazonBedrock => {
            Err(LlmError::ProviderNotConfigured(
                "bedrock requires async initialization — use create_provider_async".into(),
            ))
        }
        ProviderKind::DeepSeek => {
            let client = oris_llm::Deepseek::new()
                .with_model(&config.model)
                .with_api_key(&api_key)
                .with_options(options);
            Ok(Box::new(client))
        }
        ProviderKind::Ollama => {
            let client = oris_llm::Ollama::default()
                .with_model(&config.model);
            Ok(Box::new(client))
        }
    }
}

fn env_key_for_provider(kind: &ProviderKind) -> Option<String> {
    let var = match kind {
        ProviderKind::Anthropic => "ANTHROPIC_API_KEY",
        ProviderKind::OpenAi => "OPENAI_API_KEY",
        ProviderKind::Google => "GOOGLE_API_KEY",
        ProviderKind::DeepSeek => "DEEPSEEK_API_KEY",
        ProviderKind::XAi => "XAI_API_KEY",
        ProviderKind::Azure => "AZURE_OPENAI_API_KEY",
        _ => return None,
    };
    std::env::var(var).ok()
}

fn build_options(config: &ProviderConfig) -> CallOptions {
    let mut opts = CallOptions::default();
    if let Some(max) = config.max_tokens {
        opts = opts.with_max_tokens(max);
    }
    if let Some(temp) = config.temperature {
        opts = opts.with_temperature(temp);
    }
    if let Some(top_p) = config.top_p {
        opts = opts.with_top_p(top_p);
    }
    opts
}
