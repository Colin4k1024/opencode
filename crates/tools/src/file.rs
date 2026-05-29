//! File operations: read, write, edit

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;
use tracing::info;

#[derive(Error, Debug)]
pub enum FileError {
    #[error("file not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("old_string not found in file: {0}")]
    OldStringNotFound(String),
    #[error("old_string is not unique; found {count} occurrences in file: {path}")]
    OldStringNotUnique { path: String, count: usize },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ReadParams {
    pub path: String,
    /// 1-based line offset to start reading from (inclusive). Defaults to 1.
    pub offset: Option<usize>,
    /// Maximum number of lines to return. Defaults to all remaining lines.
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ReadResult {
    pub content: String,
    pub total_lines: usize,
}

/// Read a file, optionally slicing by line offset/limit.
pub async fn read(params: ReadParams) -> Result<ReadResult, FileError> {
    info!(path = %params.path, "reading file");

    let raw = fs::read_to_string(&params.path).await.map_err(|e| {
        map_io_error(e, &params.path)
    })?;

    let lines: Vec<&str> = raw.lines().collect();
    let total_lines = lines.len();

    let start = params.offset.unwrap_or(1).saturating_sub(1); // convert 1-based to 0-based
    let end = match params.limit {
        Some(limit) => (start + limit).min(total_lines),
        None => total_lines,
    };

    let content = if start >= total_lines {
        String::new()
    } else {
        lines[start..end].join("\n")
    };

    Ok(ReadResult {
        content,
        total_lines,
    })
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct WriteParams {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct WriteResult {
    pub bytes_written: usize,
}

/// Write content to a file, creating parent directories if necessary.
pub async fn write(params: WriteParams) -> Result<WriteResult, FileError> {
    info!(path = %params.path, "writing file");

    if let Some(parent) = std::path::Path::new(&params.path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).await.map_err(|e| map_io_error(e, &params.path))?;
        }
    }

    let bytes = params.content.as_bytes().len();
    fs::write(&params.path, &params.content).await.map_err(|e| map_io_error(e, &params.path))?;

    Ok(WriteResult { bytes_written: bytes })
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct EditParams {
    pub path: String,
    pub old_string: String,
    pub new_string: String,
    /// When true, replace every occurrence; when false (default), require
    /// exactly one occurrence.
    pub replace_all: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct EditResult {
    pub replacements: usize,
}

/// Find-and-replace inside a file.
pub async fn edit(params: EditParams) -> Result<EditResult, FileError> {
    info!(path = %params.path, "editing file");

    let content = fs::read_to_string(&params.path).await.map_err(|e| {
        map_io_error(e, &params.path)
    })?;

    let count = content.matches(params.old_string.as_str()).count();

    if count == 0 {
        return Err(FileError::OldStringNotFound(params.path.clone()));
    }

    let replace_all = params.replace_all.unwrap_or(false);

    if !replace_all && count > 1 {
        return Err(FileError::OldStringNotUnique {
            path: params.path.clone(),
            count,
        });
    }

    let new_content = if replace_all {
        content.replace(params.old_string.as_str(), params.new_string.as_str())
    } else {
        content.replacen(params.old_string.as_str(), params.new_string.as_str(), 1)
    };

    fs::write(&params.path, &new_content).await.map_err(|e| map_io_error(e, &params.path))?;

    Ok(EditResult { replacements: count })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn map_io_error(e: std::io::Error, path: &str) -> FileError {
    match e.kind() {
        std::io::ErrorKind::NotFound => FileError::NotFound(path.to_string()),
        std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
        _ => FileError::Io(e),
    }
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Helper: create a temp dir and return (TempDir, path_buf_to_file).
    fn tmp_file(dir: &TempDir, name: &str) -> PathBuf {
        dir.path().join(name)
    }

    // -----------------------------------------------------------------------
    // read tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_read_basic() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "hello.txt");
        std::fs::write(&p, "line1\nline2\nline3\n").unwrap();

        let result = read(ReadParams {
            path: p.to_string_lossy().to_string(),
            offset: None,
            limit: None,
        })
        .await
        .unwrap();

        assert_eq!(result.total_lines, 3);
        assert!(result.content.contains("line1"));
        assert!(result.content.contains("line3"));
    }

    #[tokio::test]
    async fn test_read_with_offset_and_limit() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "multi.txt");
        std::fs::write(&p, "a\nb\nc\nd\ne\n").unwrap();

        let result = read(ReadParams {
            path: p.to_string_lossy().to_string(),
            offset: Some(2), // 1-based → start at line 2 ("b")
            limit: Some(2),  // read "b" and "c"
        })
        .await
        .unwrap();

        assert_eq!(result.total_lines, 5);
        assert_eq!(result.content, "b\nc");
    }

    #[tokio::test]
    async fn test_read_file_not_found() {
        let result = read(ReadParams {
            path: "/nonexistent/path/missing.txt".to_string(),
            offset: None,
            limit: None,
        })
        .await;

        assert!(matches!(result, Err(FileError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_read_offset_beyond_file() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "short.txt");
        std::fs::write(&p, "only one line\n").unwrap();

        let result = read(ReadParams {
            path: p.to_string_lossy().to_string(),
            offset: Some(100),
            limit: None,
        })
        .await
        .unwrap();

        assert_eq!(result.content, "");
        assert_eq!(result.total_lines, 1);
    }

    // -----------------------------------------------------------------------
    // write tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_write_and_read_back() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "out.txt");
        let content = "hello from write\nsecond line\n".to_string();

        let wr = write(WriteParams {
            path: p.to_string_lossy().to_string(),
            content: content.clone(),
        })
        .await
        .unwrap();

        assert_eq!(wr.bytes_written, content.len());

        // Read back
        let rr = read(ReadParams {
            path: p.to_string_lossy().to_string(),
            offset: None,
            limit: None,
        })
        .await
        .unwrap();

        assert!(rr.content.contains("hello from write"));
        assert!(rr.content.contains("second line"));
    }

    #[tokio::test]
    async fn test_write_creates_parent_dirs() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("deep").join("nested").join("file.txt");

        write(WriteParams {
            path: p.to_string_lossy().to_string(),
            content: "nested content".to_string(),
        })
        .await
        .unwrap();

        assert!(p.exists());
    }

    // -----------------------------------------------------------------------
    // edit tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_edit_replace_single() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "edit.txt");
        std::fs::write(&p, "foo bar baz\n").unwrap();

        let er = edit(EditParams {
            path: p.to_string_lossy().to_string(),
            old_string: "bar".to_string(),
            new_string: "qux".to_string(),
            replace_all: None,
        })
        .await
        .unwrap();

        assert_eq!(er.replacements, 1);
        let new_content = std::fs::read_to_string(&p).unwrap();
        assert!(new_content.contains("qux"));
        assert!(!new_content.contains("bar"));
    }

    #[tokio::test]
    async fn test_edit_replace_all() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "edit_all.txt");
        std::fs::write(&p, "cat cat cat\n").unwrap();

        let er = edit(EditParams {
            path: p.to_string_lossy().to_string(),
            old_string: "cat".to_string(),
            new_string: "dog".to_string(),
            replace_all: Some(true),
        })
        .await
        .unwrap();

        assert_eq!(er.replacements, 3);
        let new_content = std::fs::read_to_string(&p).unwrap();
        assert_eq!(new_content, "dog dog dog\n");
    }

    #[tokio::test]
    async fn test_edit_old_string_not_found() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "nochange.txt");
        std::fs::write(&p, "hello world\n").unwrap();

        let result = edit(EditParams {
            path: p.to_string_lossy().to_string(),
            old_string: "missing_string".to_string(),
            new_string: "replacement".to_string(),
            replace_all: None,
        })
        .await;

        assert!(matches!(result, Err(FileError::OldStringNotFound(_))));
    }

    #[tokio::test]
    async fn test_edit_old_string_not_unique() {
        let dir = TempDir::new().unwrap();
        let p = tmp_file(&dir, "dup.txt");
        std::fs::write(&p, "dup dup\n").unwrap();

        let result = edit(EditParams {
            path: p.to_string_lossy().to_string(),
            old_string: "dup".to_string(),
            new_string: "unique".to_string(),
            replace_all: Some(false),
        })
        .await;

        assert!(matches!(
            result,
            Err(FileError::OldStringNotUnique { count: 2, .. })
        ));
    }

    #[tokio::test]
    async fn test_edit_file_not_found() {
        let result = edit(EditParams {
            path: "/does/not/exist.txt".to_string(),
            old_string: "x".to_string(),
            new_string: "y".to_string(),
            replace_all: None,
        })
        .await;

        assert!(matches!(result, Err(FileError::NotFound(_))));
    }
}
