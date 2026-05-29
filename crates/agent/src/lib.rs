//! Agent configuration, prompt assembly, and tool execution loop
//!
//! Phase 4: Agent info, permission system, prompt builder

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("agent not found: {0}")]
    NotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error in {file}: {msg}")]
    Parse { file: String, msg: String },
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/// How this agent participates in a multi-agent setup.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    Primary,
    Subagent,
}

impl Default for AgentMode {
    fn default() -> Self {
        AgentMode::Primary
    }
}

/// Model configuration for an agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelConfig {
    /// Model identifier, e.g. "claude-3-5-sonnet-20241022"
    pub model: String,
    /// Optional override for the provider
    pub provider: Option<String>,
    /// Max tokens to generate
    pub max_tokens: Option<u32>,
}

impl Default for ModelConfig {
    fn default() -> Self {
        ModelConfig {
            model: "claude-3-5-sonnet-20241022".into(),
            provider: None,
            max_tokens: Some(8192),
        }
    }
}

/// A single permission rule: allow or deny a (tool, action) pair.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PermissionRule {
    /// Tool name glob, e.g. "bash", "*"
    pub tool: String,
    /// Action glob, e.g. "read", "write", "*"
    pub action: String,
    /// Whether this rule allows (true) or denies (false)
    pub allow: bool,
}

/// Permission ruleset evaluated top-to-bottom; first match wins.
/// Denies by default when no rule matches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Permission {
    pub rules: Vec<PermissionRule>,
}

impl Permission {
    /// Returns `true` if the given (tool, action) pair is allowed.
    /// Matching is exact or wildcard (`*`) on either field.
    pub fn allows(&self, tool: &str, action: &str) -> bool {
        for rule in &self.rules {
            let tool_match = rule.tool == "*" || rule.tool == tool;
            let action_match = rule.action == "*" || rule.action == action;
            if tool_match && action_match {
                return rule.allow;
            }
        }
        // default deny
        false
    }
}

/// Full agent configuration loaded from a TOML or JSON file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentInfo {
    /// Unique name for the agent, e.g. "coder"
    pub name: String,
    /// Human-readable description
    pub description: String,
    #[serde(default)]
    pub mode: AgentMode,
    #[serde(default)]
    pub model: ModelConfig,
    /// Sampling temperature (0.0 – 1.0)
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    /// Nucleus sampling top_p
    #[serde(default = "default_top_p")]
    pub top_p: f32,
    #[serde(default)]
    pub permissions: Permission,
    /// System prompt or Jinja2-style template string
    #[serde(default)]
    pub prompt_template: String,
}

fn default_temperature() -> f32 {
    0.7
}
fn default_top_p() -> f32 {
    0.9
}

// ──────────────────────────────────────────────
// AgentRegistry
// ──────────────────────────────────────────────

/// Holds all loaded agent configurations indexed by name.
#[derive(Debug, Default)]
pub struct AgentRegistry {
    agents: HashMap<String, AgentInfo>,
    order: Vec<String>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Load agent configs from every `.toml` and `.json` file in `path`.
    /// Files that fail to parse are skipped with a tracing warning.
    pub fn load_from_dir(path: &str) -> Result<Self, AgentError> {
        let mut registry = Self::new();
        let dir = std::fs::read_dir(path)?;
        for entry in dir.flatten() {
            let fpath = entry.path();
            let ext = fpath
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext != "toml" && ext != "json" {
                continue;
            }
            let raw = match std::fs::read_to_string(&fpath) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("skipping {:?}: {}", fpath, e);
                    continue;
                }
            };
            let agent: AgentInfo = if ext == "toml" {
                toml::from_str(&raw).map_err(|e| AgentError::Parse {
                    file: fpath.display().to_string(),
                    msg: e.to_string(),
                })?
            } else {
                serde_json::from_str(&raw).map_err(|e| AgentError::Parse {
                    file: fpath.display().to_string(),
                    msg: e.to_string(),
                })?
            };
            registry.insert(agent);
        }
        Ok(registry)
    }

    /// Insert an agent, replacing any existing entry with the same name.
    pub fn insert(&mut self, agent: AgentInfo) {
        if !self.agents.contains_key(&agent.name) {
            self.order.push(agent.name.clone());
        }
        self.agents.insert(agent.name.clone(), agent);
    }

    pub fn get(&self, name: &str) -> Option<&AgentInfo> {
        self.agents.get(name)
    }

    pub fn list(&self) -> Vec<&AgentInfo> {
        self.order
            .iter()
            .filter_map(|n| self.agents.get(n))
            .collect()
    }

    /// Returns the first primary-mode agent, or the very first agent, or panics if empty.
    pub fn default_agent(&self) -> &AgentInfo {
        self.order
            .iter()
            .filter_map(|n| self.agents.get(n))
            .find(|a| a.mode == AgentMode::Primary)
            .or_else(|| self.order.first().and_then(|n| self.agents.get(n)))
            .expect("AgentRegistry is empty")
    }
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn sample_agent(name: &str, mode: AgentMode) -> AgentInfo {
        AgentInfo {
            name: name.into(),
            description: format!("{name} agent"),
            mode,
            model: ModelConfig::default(),
            temperature: 0.7,
            top_p: 0.9,
            permissions: Permission {
                rules: vec![
                    PermissionRule {
                        tool: "bash".into(),
                        action: "read".into(),
                        allow: true,
                    },
                    PermissionRule {
                        tool: "*".into(),
                        action: "*".into(),
                        allow: false,
                    },
                ],
            },
            prompt_template: "You are {{name}}.".into(),
        }
    }

    #[test]
    fn test_permission_allows() {
        let agent = sample_agent("coder", AgentMode::Primary);
        assert!(agent.permissions.allows("bash", "read"));
        assert!(!agent.permissions.allows("bash", "write"));
        assert!(!agent.permissions.allows("fs", "read"));
    }

    #[test]
    fn test_registry_insert_and_get() {
        let mut reg = AgentRegistry::new();
        let a = sample_agent("alpha", AgentMode::Primary);
        reg.insert(a.clone());
        assert_eq!(reg.get("alpha"), Some(&a));
        assert_eq!(reg.get("missing"), None);
    }

    #[test]
    fn test_default_agent_primary() {
        let mut reg = AgentRegistry::new();
        reg.insert(sample_agent("sub1", AgentMode::Subagent));
        reg.insert(sample_agent("main", AgentMode::Primary));
        assert_eq!(reg.default_agent().name, "main");
    }

    #[test]
    fn test_load_from_dir_toml() {
        let dir = TempDir::new().unwrap();
        let toml_path = dir.path().join("coder.toml");
        let mut f = std::fs::File::create(&toml_path).unwrap();
        writeln!(
            f,
            r#"
name = "coder"
description = "A coding agent"
mode = "primary"
prompt_template = "You are a coder."

[model]
model = "claude-3-5-sonnet-20241022"
max_tokens = 4096

[permissions]
rules = []
"#
        )
        .unwrap();

        let reg = AgentRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
        let agent = reg.get("coder").unwrap();
        assert_eq!(agent.name, "coder");
        assert_eq!(agent.mode, AgentMode::Primary);
    }

    #[test]
    fn test_load_from_dir_json() {
        let dir = TempDir::new().unwrap();
        let json_path = dir.path().join("reviewer.json");
        let mut f = std::fs::File::create(&json_path).unwrap();
        writeln!(
            f,
            r#"{{
  "name": "reviewer",
  "description": "A review agent",
  "mode": "subagent",
  "model": {{"model": "claude-3-haiku-20240307"}},
  "permissions": {{"rules": []}},
  "prompt_template": "Review the code."
}}"#
        )
        .unwrap();

        let reg = AgentRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
        let agent = reg.get("reviewer").unwrap();
        assert_eq!(agent.mode, AgentMode::Subagent);
    }

    #[test]
    fn test_list_preserves_insertion_order() {
        let mut reg = AgentRegistry::new();
        reg.insert(sample_agent("z_agent", AgentMode::Subagent));
        reg.insert(sample_agent("a_agent", AgentMode::Primary));
        let names: Vec<&str> = reg.list().iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["z_agent", "a_agent"]);
    }
}
