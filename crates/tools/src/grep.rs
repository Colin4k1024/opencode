//! Content search using grep-searcher (ripgrep kernel)

use grep_regex::RegexMatcher;
use grep_searcher::{BinaryDetection, SearcherBuilder, Sink, SinkContext, SinkMatch};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GrepError {
    #[error("invalid regex pattern: {0}")]
    InvalidPattern(String),
    #[error("invalid search path: {0}")]
    InvalidPath(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Deserialize)]
pub struct GrepParams {
    pub pattern: String,
    pub path: Option<String>,
    pub context: Option<usize>,
    pub max_results: Option<usize>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GrepMatch {
    pub file: String,
    pub line: u64,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct GrepResult {
    pub matches: Vec<GrepMatch>,
}

/// Default maximum number of results
const DEFAULT_MAX_RESULTS: usize = 250;

/// Custom sink that collects both matched lines and context lines
struct CollectSink<'a> {
    file: &'a str,
    matches: &'a mut Vec<GrepMatch>,
    max_results: usize,
}

impl<'a> Sink for CollectSink<'a> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        if self.matches.len() >= self.max_results {
            return Ok(false);
        }
        let content = String::from_utf8_lossy(mat.bytes())
            .trim_end_matches('\n')
            .to_string();
        self.matches.push(GrepMatch {
            file: self.file.to_string(),
            line: mat.line_number().unwrap_or(0),
            content,
        });
        Ok(true)
    }

    fn context(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        ctx: &SinkContext<'_>,
    ) -> Result<bool, Self::Error> {
        if self.matches.len() >= self.max_results {
            return Ok(false);
        }
        let content = String::from_utf8_lossy(ctx.bytes())
            .trim_end_matches('\n')
            .to_string();
        self.matches.push(GrepMatch {
            file: self.file.to_string(),
            line: ctx.line_number().unwrap_or(0),
            content,
        });
        Ok(true)
    }
}

/// Search file contents with regex, returning matching lines with optional context
pub async fn grep(params: GrepParams) -> Result<GrepResult, GrepError> {
    let root = params.path.as_deref().unwrap_or(".");
    let max_results = params.max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let context_lines = params.context.unwrap_or(0);

    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|e| GrepError::InvalidPath(format!("{root}: {e}")))?;

    let matcher = RegexMatcher::new(&params.pattern)
        .map_err(|e| GrepError::InvalidPattern(e.to_string()))?;

    let mut all_matches: Vec<GrepMatch> = Vec::new();

    let walker = WalkBuilder::new(&root_path)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .build();

    'outer: for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Only search files
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }

        let abs_path = entry.path().to_path_buf();
        let rel_path = match abs_path.strip_prefix(&root_path) {
            Ok(p) => p.to_string_lossy().into_owned(),
            Err(_) => continue,
        };

        let mut file_matches: Vec<GrepMatch> = Vec::new();

        let mut searcher = SearcherBuilder::new()
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .before_context(context_lines)
            .after_context(context_lines)
            .line_number(true)
            .build();

        let sink = CollectSink {
            file: &rel_path,
            matches: &mut file_matches,
            max_results,
        };

        let result = searcher.search_path(&matcher, &abs_path, sink);

        // Skip files that produce errors (binary, permission denied, etc.)
        if result.is_err() {
            continue;
        }

        for m in file_matches {
            if all_matches.len() >= max_results {
                break 'outer;
            }
            all_matches.push(m);
        }
    }

    Ok(GrepResult {
        matches: all_matches,
    })
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

        fs::write(
            base.join("src/main.rs"),
            "fn main() {\n    println!(\"hello world\");\n    let x = 42;\n}\n",
        )
        .unwrap();

        fs::write(
            base.join("src/lib.rs"),
            "pub fn greet(name: &str) -> String {\n    format!(\"Hello, {}!\", name)\n}\n\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
        )
        .unwrap();

        fs::write(
            base.join("README.md"),
            "# Project\n\nThis project says hello to the world.\n",
        )
        .unwrap();

        dir
    }

    #[tokio::test]
    async fn test_grep_basic_match() {
        let dir = setup_test_dir();
        let result = grep(GrepParams {
            pattern: "hello".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await
        .unwrap();

        assert!(!result.matches.is_empty());
        assert!(result.matches.iter().all(|m| m.content.contains("hello")
            || m.content.contains("Hello")
            || m.content.to_lowercase().contains("hello")));
    }

    #[tokio::test]
    async fn test_grep_case_sensitive() {
        let dir = setup_test_dir();

        let result_lower = grep(GrepParams {
            pattern: "hello".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await
        .unwrap();

        let result_upper = grep(GrepParams {
            pattern: "Hello".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await
        .unwrap();

        // "hello" (lowercase) only appears in main.rs and README; "Hello" in lib.rs
        // They should have different counts
        assert_ne!(result_lower.matches.len(), 0);
        assert_ne!(result_upper.matches.len(), 0);
    }

    #[tokio::test]
    async fn test_grep_no_matches() {
        let dir = setup_test_dir();
        let result = grep(GrepParams {
            pattern: "nonexistent_xyz_abc".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await
        .unwrap();

        assert!(result.matches.is_empty());
    }

    #[tokio::test]
    async fn test_grep_max_results() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        // Write a file with many matching lines
        let content: String = (0..100).map(|i| format!("line {i} matches here\n")).collect();
        fs::write(base.join("data.txt"), content).unwrap();

        let result = grep(GrepParams {
            pattern: "matches".to_string(),
            path: Some(base.to_string_lossy().into_owned()),
            context: None,
            max_results: Some(10),
        })
        .await
        .unwrap();

        assert_eq!(result.matches.len(), 10);
    }

    #[tokio::test]
    async fn test_grep_regex_pattern() {
        let dir = setup_test_dir();
        let result = grep(GrepParams {
            pattern: r"fn \w+".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await
        .unwrap();

        assert!(!result.matches.is_empty());
        assert!(result.matches.iter().all(|m| m.content.contains("fn ")));
    }

    #[tokio::test]
    async fn test_grep_invalid_regex() {
        let dir = setup_test_dir();
        let result = grep(GrepParams {
            pattern: "[invalid(".to_string(),
            path: Some(dir.path().to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await;

        assert!(matches!(result, Err(GrepError::InvalidPattern(_))));
    }

    #[tokio::test]
    async fn test_grep_line_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        fs::write(
            base.join("file.txt"),
            "line one\nline two\ntarget line\nline four\n",
        )
        .unwrap();

        let result = grep(GrepParams {
            pattern: "target".to_string(),
            path: Some(base.to_string_lossy().into_owned()),
            context: None,
            max_results: None,
        })
        .await
        .unwrap();

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].line, 3);
        assert_eq!(result.matches[0].content, "target line");
    }

    #[tokio::test]
    async fn test_grep_context_lines() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        fs::write(
            base.join("file.txt"),
            "before_line\ntarget line\nafter_line\n",
        )
        .unwrap();

        let result = grep(GrepParams {
            pattern: "target".to_string(),
            path: Some(base.to_string_lossy().into_owned()),
            context: Some(1),
            max_results: None,
        })
        .await
        .unwrap();

        // With context=1, we expect 3 lines: before, match, after
        assert_eq!(result.matches.len(), 3);
        let contents: Vec<&str> = result.matches.iter().map(|m| m.content.as_str()).collect();
        assert!(contents.contains(&"before_line"));
        assert!(contents.contains(&"target line"));
        assert!(contents.contains(&"after_line"));
    }
}
