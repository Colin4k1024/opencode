//! Plugin system — loads plugin manifests from a directory.
//!
//! Plugins declare their metadata in a `plugin.toml` file. The registry
//! scans a directory, parses every manifest it finds, and exposes the
//! collection for lookup.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, warn};

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("TOML parse error in `{path}`: {source}")]
    TomlParse {
        path: String,
        source: toml::de::Error,
    },

    #[error("plugin not found: `{0}`")]
    NotFound(String),

    #[error("directory not found: `{0}`")]
    DirectoryNotFound(String),
}

// ── PluginInfo ────────────────────────────────────────────────────────────────

/// Metadata describing a single plugin, parsed from `plugin.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginInfo {
    /// Unique plugin identifier (e.g. `my-plugin`).
    pub name: String,
    /// Semver version string (e.g. `1.0.0`).
    pub version: String,
    /// Human-readable description.
    pub description: String,
    /// Path or name of the plugin's entry-point binary / module.
    pub entry_point: String,
    /// Permissions the plugin requests (e.g. `["fs:read", "net:outbound"]`).
    #[serde(default)]
    pub permissions: Vec<String>,
}

// ── Internal manifest wrapper ─────────────────────────────────────────────────

/// Top-level structure of `plugin.toml`.
/// The `[plugin]` table is unwrapped into `PluginInfo` via this wrapper.
#[derive(Debug, Deserialize)]
struct PluginManifest {
    plugin: PluginInfo,
}

// ── PluginRegistry ────────────────────────────────────────────────────────────

/// In-memory registry of loaded plugins, keyed by name.
#[derive(Debug, Default)]
pub struct PluginRegistry {
    plugins: HashMap<String, PluginInfo>,
}

impl PluginRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Scan `path` for `plugin.toml` files and load them.
    ///
    /// Sub-directories are searched one level deep: both
    /// `<path>/plugin.toml` and `<path>/<subdir>/plugin.toml` are
    /// considered. Manifests that fail to parse are skipped with a warning.
    pub fn load_from_dir(path: &str) -> Result<Self, PluginError> {
        let base = Path::new(path);
        if !base.exists() {
            return Err(PluginError::DirectoryNotFound(path.to_string()));
        }

        let mut registry = Self::new();

        for entry in std::fs::read_dir(base)? {
            let entry = entry?;
            let entry_path = entry.path();

            if entry_path.is_dir() {
                // Check <subdir>/plugin.toml
                let manifest_path = entry_path.join("plugin.toml");
                if manifest_path.exists() {
                    registry.try_load_manifest(&manifest_path);
                }
            } else if entry_path.file_name().map(|n| n == "plugin.toml").unwrap_or(false) {
                // <path>/plugin.toml at the root level
                registry.try_load_manifest(&entry_path);
            }
        }

        debug!("loaded {} plugin(s) from `{}`", registry.plugins.len(), path);
        Ok(registry)
    }

    /// Look up a plugin by name.
    pub fn get(&self, name: &str) -> Option<&PluginInfo> {
        self.plugins.get(name)
    }

    /// Return all loaded plugins as a sorted list.
    pub fn list(&self) -> Vec<&PluginInfo> {
        let mut plugins: Vec<&PluginInfo> = self.plugins.values().collect();
        plugins.sort_by(|a, b| a.name.cmp(&b.name));
        plugins
    }

    /// Number of loaded plugins.
    pub fn len(&self) -> usize {
        self.plugins.len()
    }

    /// Returns `true` if no plugins are loaded.
    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    fn try_load_manifest(&mut self, path: &Path) {
        match self.load_manifest(path) {
            Ok(info) => {
                debug!("loaded plugin `{}` from `{}`", info.name, path.display());
                self.plugins.insert(info.name.clone(), info);
            }
            Err(e) => {
                warn!("skipping invalid manifest `{}`: {}", path.display(), e);
            }
        }
    }

    fn load_manifest(&self, path: &Path) -> Result<PluginInfo, PluginError> {
        let contents = std::fs::read_to_string(path)?;
        let manifest: PluginManifest = toml::from_str(&contents).map_err(|e| {
            PluginError::TomlParse {
                path: path.display().to_string(),
                source: e,
            }
        })?;
        Ok(manifest.plugin)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn make_temp_plugin(dir: &TempDir, subdir: &str, toml_content: &str) {
        let plugin_dir = dir.path().join(subdir);
        std::fs::create_dir_all(&plugin_dir).unwrap();
        let mut f = std::fs::File::create(plugin_dir.join("plugin.toml")).unwrap();
        f.write_all(toml_content.as_bytes()).unwrap();
    }

    // ── load_from_dir with multiple plugins ───────────────────────────────────

    #[test]
    fn test_load_multiple_plugins_from_subdirs() {
        let dir = TempDir::new().unwrap();

        make_temp_plugin(
            &dir,
            "plugin-a",
            r#"
[plugin]
name = "plugin-a"
version = "1.0.0"
description = "Alpha plugin"
entry_point = "plugin_a.wasm"
permissions = ["fs:read"]
"#,
        );

        make_temp_plugin(
            &dir,
            "plugin-b",
            r#"
[plugin]
name = "plugin-b"
version = "2.1.0"
description = "Beta plugin"
entry_point = "plugin_b.wasm"
"#,
        );

        let registry = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(registry.len(), 2);

        let a = registry.get("plugin-a").unwrap();
        assert_eq!(a.version, "1.0.0");
        assert_eq!(a.permissions, vec!["fs:read"]);

        let b = registry.get("plugin-b").unwrap();
        assert_eq!(b.version, "2.1.0");
        assert!(b.permissions.is_empty());
    }

    // ── get returns None for unknown plugins ──────────────────────────────────

    #[test]
    fn test_get_unknown_plugin_returns_none() {
        let dir = TempDir::new().unwrap();
        let registry = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
        assert!(registry.get("nonexistent").is_none());
    }

    // ── list returns sorted results ───────────────────────────────────────────

    #[test]
    fn test_list_returns_sorted_by_name() {
        let dir = TempDir::new().unwrap();

        for name in ["zebra-plugin", "alpha-plugin", "middle-plugin"] {
            make_temp_plugin(
                &dir,
                name,
                &format!(
                    r#"
[plugin]
name = "{name}"
version = "0.1.0"
description = "test"
entry_point = "{name}.wasm"
"#
                ),
            );
        }

        let registry = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
        let names: Vec<&str> = registry.list().iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["alpha-plugin", "middle-plugin", "zebra-plugin"]);
    }

    // ── malformed manifest is skipped gracefully ──────────────────────────────

    #[test]
    fn test_malformed_manifest_is_skipped() {
        let dir = TempDir::new().unwrap();

        // Valid plugin
        make_temp_plugin(
            &dir,
            "good-plugin",
            r#"
[plugin]
name = "good-plugin"
version = "1.0.0"
description = "Works fine"
entry_point = "good.wasm"
"#,
        );

        // Invalid TOML
        make_temp_plugin(
            &dir,
            "bad-plugin",
            "this is not [valid toml at all!!!",
        );

        let registry = PluginRegistry::load_from_dir(dir.path().to_str().unwrap()).unwrap();
        // Only the good plugin should be loaded
        assert_eq!(registry.len(), 1);
        assert!(registry.get("good-plugin").is_some());
        assert!(registry.get("bad-plugin").is_none());
    }

    // ── nonexistent directory returns error ───────────────────────────────────

    #[test]
    fn test_nonexistent_directory_returns_error() {
        let result = PluginRegistry::load_from_dir("/tmp/opencode-test-does-not-exist-xyz");
        assert!(result.is_err());
        match result.unwrap_err() {
            PluginError::DirectoryNotFound(p) => {
                assert!(p.contains("does-not-exist-xyz"))
            }
            other => panic!("unexpected error: {}", other),
        }
    }

    // ── PluginInfo serialization roundtrip ────────────────────────────────────

    #[test]
    fn test_plugin_info_serde_roundtrip() {
        let info = PluginInfo {
            name: "my-plugin".to_string(),
            version: "3.0.0".to_string(),
            description: "Does something".to_string(),
            entry_point: "my_plugin.wasm".to_string(),
            permissions: vec!["net:outbound".to_string()],
        };

        let json = serde_json::to_string(&info).unwrap();
        let decoded: PluginInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, info);
    }
}
