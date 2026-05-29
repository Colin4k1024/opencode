//! File pattern matching using the `ignore` crate

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GlobError {
    #[error("invalid search path: {0}")]
    InvalidPath(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Deserialize)]
pub struct GlobParams {
    pub pattern: String,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GlobResult {
    pub files: Vec<String>,
}

/// Match files against a glob pattern, respecting .gitignore
pub async fn glob(params: GlobParams) -> Result<GlobResult, GlobError> {
    let root = params
        .path
        .as_deref()
        .unwrap_or(".");

    let root_path = Path::new(root).canonicalize().map_err(|e| {
        GlobError::InvalidPath(format!("{root}: {e}"))
    })?;

    let pattern = &params.pattern;

    // Build glob matcher from the pattern.
    // literal_separator=true means `*` won't cross `/`, so `src/*.rs` won't
    // match `src/sub/helper.rs`. Use `**` to cross directory boundaries.
    let glob_matcher = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| GlobError::InvalidPath(format!("invalid glob pattern '{pattern}': {e}")))?
        .compile_matcher();

    let mut files: Vec<String> = Vec::new();

    let walker = WalkBuilder::new(&root_path)
        .hidden(false)       // include hidden files (let .gitignore handle it)
        .git_ignore(true)    // respect .gitignore
        .git_global(true)    // respect global .gitignore
        .git_exclude(true)   // respect .git/info/exclude
        .require_git(false)  // respect .gitignore even outside a git repo
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Only match files, not directories
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }

        let abs_path = entry.path();

        // Get path relative to root
        let rel_path = match abs_path.strip_prefix(&root_path) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let rel_str = rel_path.to_string_lossy();

        if glob_matcher.is_match(rel_str.as_ref()) {
            files.push(rel_str.into_owned());
        }
    }

    files.sort();

    Ok(GlobResult { files })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        fs::create_dir_all(base.join("src")).unwrap();
        fs::create_dir_all(base.join("src/sub")).unwrap();
        fs::create_dir_all(base.join("tests")).unwrap();

        fs::write(base.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(base.join("src/lib.rs"), "pub fn foo() {}").unwrap();
        fs::write(base.join("src/sub/helper.rs"), "// helper").unwrap();
        fs::write(base.join("tests/test.rs"), "#[test] fn t() {}").unwrap();
        fs::write(base.join("README.md"), "# readme").unwrap();
        fs::write(base.join("Cargo.toml"), "[package]").unwrap();

        dir
    }

    #[tokio::test]
    async fn test_glob_all_rs_files() {
        let dir = setup_test_dir();
        let result = glob(GlobParams {
            pattern: "**/*.rs".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
        })
        .await
        .unwrap();

        assert_eq!(result.files.len(), 4);
        assert!(result.files.contains(&"src/main.rs".to_string()));
        assert!(result.files.contains(&"src/lib.rs".to_string()));
        assert!(result.files.contains(&"src/sub/helper.rs".to_string()));
        assert!(result.files.contains(&"tests/test.rs".to_string()));
    }

    #[tokio::test]
    async fn test_glob_specific_dir() {
        let dir = setup_test_dir();
        let result = glob(GlobParams {
            pattern: "src/*.rs".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
        })
        .await
        .unwrap();

        assert_eq!(result.files.len(), 2);
        assert!(result.files.contains(&"src/lib.rs".to_string()));
        assert!(result.files.contains(&"src/main.rs".to_string()));
    }

    #[tokio::test]
    async fn test_glob_md_files() {
        let dir = setup_test_dir();
        let result = glob(GlobParams {
            pattern: "**/*.md".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
        })
        .await
        .unwrap();

        assert_eq!(result.files.len(), 1);
        assert!(result.files.contains(&"README.md".to_string()));
    }

    #[tokio::test]
    async fn test_glob_no_matches() {
        let dir = setup_test_dir();
        let result = glob(GlobParams {
            pattern: "**/*.py".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
        })
        .await
        .unwrap();

        assert!(result.files.is_empty());
    }

    #[tokio::test]
    async fn test_glob_results_are_sorted() {
        let dir = setup_test_dir();
        let result = glob(GlobParams {
            pattern: "**/*.rs".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
        })
        .await
        .unwrap();

        let mut sorted = result.files.clone();
        sorted.sort();
        assert_eq!(result.files, sorted);
    }

    #[tokio::test]
    async fn test_glob_respects_gitignore() {
        let dir = setup_test_dir();
        let base = dir.path();

        // Create a .gitignore that excludes target/
        fs::write(base.join(".gitignore"), "target/\n").unwrap();
        fs::create_dir_all(base.join("target/debug")).unwrap();
        fs::write(base.join("target/debug/output.rs"), "// ignored").unwrap();

        let result = glob(GlobParams {
            pattern: "**/*.rs".to_string(),
            path: Some(base.to_string_lossy().into_owned()),
        })
        .await
        .unwrap();

        // target/debug/output.rs should be excluded
        assert!(!result.files.iter().any(|f| f.contains("target")));
    }
}
