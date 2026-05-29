//! Git operations using git2-rs

use git2::{DiffFormat, Repository, Sort};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::debug;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum GitError {
    #[error("not a git repository: {0}")]
    NotARepo(String),
    #[error("invalid ref: {0}")]
    InvalidRef(String),
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct StatusParams {
    /// Working directory (must be inside a git repo)
    pub cwd: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatusKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Other,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileStatus {
    pub path: String,
    pub status: FileStatusKind,
}

/// Return the list of changed / untracked files in the repository.
pub fn status(params: StatusParams) -> Result<Vec<FileStatus>, GitError> {
    let repo = open_repo(&params.cwd)?;

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        let path = entry
            .path()
            .unwrap_or("<invalid utf-8>")
            .to_string();

        let flags = entry.status();
        let kind = if flags.intersects(
            git2::Status::INDEX_NEW | git2::Status::WT_NEW,
        ) {
            if flags.contains(git2::Status::WT_NEW) {
                FileStatusKind::Untracked
            } else {
                FileStatusKind::Added
            }
        } else if flags.intersects(
            git2::Status::INDEX_DELETED | git2::Status::WT_DELETED,
        ) {
            FileStatusKind::Deleted
        } else if flags.intersects(
            git2::Status::INDEX_RENAMED | git2::Status::WT_RENAMED,
        ) {
            FileStatusKind::Renamed
        } else if flags.intersects(
            git2::Status::INDEX_MODIFIED | git2::Status::WT_MODIFIED,
        ) {
            FileStatusKind::Modified
        } else {
            FileStatusKind::Other
        };

        debug!(path = %path, ?kind, "git status entry");
        result.push(FileStatus { path, status: kind });
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DiffParams {
    /// Working directory
    pub cwd: String,
    /// Ref spec (commit hash, branch, tag). When `None` returns unstaged changes.
    pub ref_spec: Option<String>,
}

/// Return a unified diff string.
pub fn diff(params: DiffParams) -> Result<String, GitError> {
    let repo = open_repo(&params.cwd)?;

    let git_diff = match &params.ref_spec {
        None => {
            // Unstaged changes: workdir vs index
            repo.diff_index_to_workdir(None, None)?
        }
        Some(spec) => {
            // Diff of the named commit vs its parent (first parent)
            let obj = repo
                .revparse_single(spec)
                .map_err(|_| GitError::InvalidRef(spec.clone()))?;
            let commit = obj
                .peel_to_commit()
                .map_err(|_| GitError::InvalidRef(spec.clone()))?;

            let commit_tree = commit.tree()?;

            if commit.parent_count() == 0 {
                // Initial commit — diff against empty tree
                let empty = repo.find_tree(repo.treebuilder(None)?.write()?)?;
                repo.diff_tree_to_tree(Some(&empty), Some(&commit_tree), None)?
            } else {
                let parent_tree = commit.parent(0)?.tree()?;
                repo.diff_tree_to_tree(
                    Some(&parent_tree),
                    Some(&commit_tree),
                    None,
                )?
            }
        }
    };

    let mut patch = String::new();
    git_diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' | '-' | ' ' => line.origin().to_string(),
            'F' => return true, // file header — already included via H
            'H' | 'B' | 'O' => String::new(),
            _ => String::new(),
        };
        let content = std::str::from_utf8(line.content()).unwrap_or("");
        patch.push_str(&prefix);
        patch.push_str(content);
        true
    })?;

    Ok(patch)
}

// ---------------------------------------------------------------------------
// log
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LogParams {
    /// Working directory
    pub cwd: String,
    /// Maximum number of commits to return (default: 20)
    pub max_count: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    /// Unix timestamp (seconds)
    pub timestamp: i64,
}

/// Return recent commits from HEAD.
pub fn log(params: LogParams) -> Result<Vec<CommitInfo>, GitError> {
    let repo = open_repo(&params.cwd)?;
    let max = params.max_count.unwrap_or(20);

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME)?;

    let mut commits = Vec::with_capacity(max);
    for oid_result in revwalk.take(max) {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;

        let hash = oid.to_string();
        let short_hash = hash[..7].to_string();
        let message = commit
            .message()
            .unwrap_or("<no message>")
            .trim_end()
            .to_string();
        let sig = commit.author();
        let author = sig.name().unwrap_or("<unknown>").to_string();
        let author_email = sig.email().unwrap_or("").to_string();
        let timestamp = sig.when().seconds();

        commits.push(CommitInfo {
            hash,
            short_hash,
            message,
            author,
            author_email,
            timestamp,
        });
    }

    Ok(commits)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn open_repo(cwd: &str) -> Result<Repository, GitError> {
    Repository::discover(cwd).map_err(|_| GitError::NotARepo(cwd.to_string()))
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    /// Bootstrap a minimal git repo with an initial commit.
    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).expect("init repo");

        // Configure identity so git2 can create commits
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        drop(config);

        repo
    }

    /// Add a file to the index and return the blob oid.
    fn add_file(repo: &Repository, name: &str, content: &str) {
        let root = repo.workdir().unwrap().to_path_buf();
        fs::write(root.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
    }

    /// Create a commit from the current index.
    fn commit(repo: &Repository, message: &str) -> git2::Oid {
        let mut index = repo.index().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = repo.signature().unwrap();
        let parents: Vec<git2::Commit> = match repo.head() {
            Ok(head) => {
                let parent_oid = head.target().unwrap();
                vec![repo.find_commit(parent_oid).unwrap()]
            }
            Err(_) => vec![],
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap()
    }

    // ------------------------------------------------------------------
    // Test 1: status detects modified and untracked files
    // ------------------------------------------------------------------
    #[test]
    fn test_status_detects_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo(tmp.path());

        // Initial commit with hello.txt
        add_file(&repo, "hello.txt", "hello\n");
        commit(&repo, "initial commit");

        // Modify hello.txt (unstaged)
        fs::write(tmp.path().join("hello.txt"), "hello world\n").unwrap();

        // Add an untracked file
        fs::write(tmp.path().join("new.txt"), "brand new\n").unwrap();

        let entries = status(StatusParams {
            cwd: tmp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"hello.txt"), "hello.txt should appear");
        assert!(paths.contains(&"new.txt"), "new.txt should appear");

        let hello = entries.iter().find(|e| e.path == "hello.txt").unwrap();
        assert_eq!(hello.status, FileStatusKind::Modified);

        let new = entries.iter().find(|e| e.path == "new.txt").unwrap();
        assert_eq!(new.status, FileStatusKind::Untracked);
    }

    // ------------------------------------------------------------------
    // Test 2: status shows Added for staged new file
    // ------------------------------------------------------------------
    #[test]
    fn test_status_added_staged_file() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo(tmp.path());

        // Initial commit
        add_file(&repo, "base.txt", "base\n");
        commit(&repo, "initial");

        // Stage a new file without committing
        add_file(&repo, "staged.txt", "staged content\n");

        let entries = status(StatusParams {
            cwd: tmp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        let staged = entries
            .iter()
            .find(|e| e.path == "staged.txt")
            .expect("staged.txt should be in status");
        assert_eq!(staged.status, FileStatusKind::Added);
    }

    // ------------------------------------------------------------------
    // Test 3: log returns commits in reverse-chronological order
    // ------------------------------------------------------------------
    #[test]
    fn test_log_returns_commits() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo(tmp.path());

        add_file(&repo, "a.txt", "a\n");
        commit(&repo, "first commit");

        add_file(&repo, "b.txt", "b\n");
        commit(&repo, "second commit");

        add_file(&repo, "c.txt", "c\n");
        commit(&repo, "third commit");

        let log_entries = log(LogParams {
            cwd: tmp.path().to_string_lossy().to_string(),
            max_count: Some(10),
        })
        .unwrap();

        assert_eq!(log_entries.len(), 3);

        // All three commit messages should be present
        let messages: Vec<&str> = log_entries.iter().map(|c| c.message.as_str()).collect();
        assert!(messages.contains(&"first commit"), "missing first commit");
        assert!(messages.contains(&"second commit"), "missing second commit");
        assert!(messages.contains(&"third commit"), "missing third commit");

        // Hash fields have correct lengths
        assert_eq!(log_entries[0].hash.len(), 40);
        assert_eq!(log_entries[0].short_hash.len(), 7);

        // Author info populated
        assert_eq!(log_entries[0].author, "Test User");
        assert_eq!(log_entries[0].author_email, "test@example.com");
    }

    // ------------------------------------------------------------------
    // Test 4: log respects max_count
    // ------------------------------------------------------------------
    #[test]
    fn test_log_max_count() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo(tmp.path());

        for i in 0..5 {
            add_file(&repo, &format!("f{i}.txt"), "x\n");
            commit(&repo, &format!("commit {i}"));
        }

        let log_entries = log(LogParams {
            cwd: tmp.path().to_string_lossy().to_string(),
            max_count: Some(3),
        })
        .unwrap();

        assert_eq!(log_entries.len(), 3);
    }

    // ------------------------------------------------------------------
    // Test 5: diff returns non-empty output for unstaged changes
    // ------------------------------------------------------------------
    #[test]
    fn test_diff_unstaged_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo(tmp.path());

        add_file(&repo, "readme.txt", "line1\nline2\n");
        commit(&repo, "initial");

        // Modify file without staging
        fs::write(tmp.path().join("readme.txt"), "line1\nline2\nline3\n").unwrap();

        let patch = diff(DiffParams {
            cwd: tmp.path().to_string_lossy().to_string(),
            ref_spec: None,
        })
        .unwrap();

        assert!(!patch.is_empty(), "diff should not be empty");
        assert!(patch.contains("line3"), "diff should mention added line");
    }

    // ------------------------------------------------------------------
    // Test 6: error on non-repo path
    // ------------------------------------------------------------------
    #[test]
    fn test_not_a_repo_error() {
        let tmp = tempfile::tempdir().unwrap();
        // Do NOT init a repo — just use the bare temp dir
        let result = status(StatusParams {
            cwd: tmp.path().to_string_lossy().to_string(),
        });
        assert!(
            matches!(result, Err(GitError::NotARepo(_))),
            "expected NotARepo error"
        );
    }
}
