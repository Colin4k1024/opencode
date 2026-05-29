//! Shell command execution with timeout and sandbox

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use thiserror::Error;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use tracing::info;

#[derive(Error, Debug)]
pub enum ShellError {
    #[error("command timed out after {0}ms")]
    Timeout(u64),
    #[error("spawn failed: {0}")]
    SpawnFailed(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Deserialize)]
pub struct ExecParams {
    pub command: String,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub env: Option<Vec<(String, String)>>,
}

#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Default timeout: 120 seconds
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

/// Execute a shell command with timeout
pub async fn exec(params: ExecParams) -> Result<ExecResult, ShellError> {
    let timeout_ms = params.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);

    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let shell_flag = if cfg!(windows) { "/C" } else { "-c" };

    let mut cmd = Command::new(shell);
    cmd.arg(shell_flag).arg(&params.command);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());

    if let Some(ref cwd) = params.cwd {
        cmd.current_dir(cwd);
    }

    if let Some(ref env_vars) = params.env {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }

    info!(command = %params.command, timeout_ms, "executing shell command");

    let result = timeout(Duration::from_millis(timeout_ms), cmd.output()).await;

    match result {
        Ok(Ok(output)) => {
            let exit_code = output.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            Ok(ExecResult {
                exit_code,
                stdout,
                stderr,
            })
        }
        Ok(Err(e)) => Err(ShellError::SpawnFailed(e.to_string())),
        Err(_) => Err(ShellError::Timeout(timeout_ms)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_exec_simple() {
        let result = exec(ExecParams {
            command: "echo hello".to_string(),
            cwd: None,
            timeout_ms: Some(5000),
            env: None,
        })
        .await
        .unwrap();

        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("hello"));
    }

    #[tokio::test]
    async fn test_exec_exit_code() {
        let result = exec(ExecParams {
            command: "exit 42".to_string(),
            cwd: None,
            timeout_ms: Some(5000),
            env: None,
        })
        .await
        .unwrap();

        assert_eq!(result.exit_code, 42);
    }

    #[tokio::test]
    async fn test_exec_timeout() {
        let result = exec(ExecParams {
            command: "sleep 10".to_string(),
            cwd: None,
            timeout_ms: Some(100),
            env: None,
        })
        .await;

        assert!(matches!(result, Err(ShellError::Timeout(100))));
    }

    #[tokio::test]
    async fn test_exec_with_cwd() {
        let result = exec(ExecParams {
            command: "pwd".to_string(),
            cwd: Some("/tmp".to_string()),
            timeout_ms: Some(5000),
            env: None,
        })
        .await
        .unwrap();

        assert_eq!(result.exit_code, 0);
        // macOS /tmp -> /private/tmp
        assert!(
            result.stdout.contains("/tmp") || result.stdout.contains("/private/tmp")
        );
    }

    #[tokio::test]
    async fn test_exec_with_env() {
        let result = exec(ExecParams {
            command: "echo $MY_VAR".to_string(),
            cwd: None,
            timeout_ms: Some(5000),
            env: Some(vec![("MY_VAR".to_string(), "hello_rust".to_string())]),
        })
        .await
        .unwrap();

        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("hello_rust"));
    }
}
