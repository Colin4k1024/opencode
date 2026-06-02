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

/// Parameters for direct process execution (no shell wrapping)
#[derive(Debug, Deserialize)]
pub struct ProcessRunParams {
    pub command: String,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<Vec<(String, String)>>,
    pub stdin: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

/// Execute a process directly (no shell) with timeout and optional stdin
pub async fn process_run(params: ProcessRunParams) -> Result<ExecResult, ShellError> {
    let timeout_ms = params.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let max_bytes = params.max_output_bytes.unwrap_or(10 * 1024 * 1024); // 10MB default

    let mut cmd = Command::new(&params.command);
    if let Some(ref args) = params.args {
        cmd.args(args);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if params.stdin.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }

    if let Some(ref cwd) = params.cwd {
        cmd.current_dir(cwd);
    }

    if let Some(ref env_vars) = params.env {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }

    info!(command = %params.command, args = ?params.args, timeout_ms, "executing process");

    let mut child = cmd.spawn().map_err(|e| ShellError::SpawnFailed(e.to_string()))?;

    // Write stdin if provided
    if let Some(ref input) = params.stdin {
        use tokio::io::AsyncWriteExt;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes()).await;
            drop(stdin);
        }
    }

    let result = timeout(Duration::from_millis(timeout_ms), child.wait_with_output()).await;

    match result {
        Ok(Ok(output)) => {
            let exit_code = output.status.code().unwrap_or(-1);
            let stdout_bytes = &output.stdout[..output.stdout.len().min(max_bytes)];
            let stderr_bytes = &output.stderr[..output.stderr.len().min(max_bytes)];
            let stdout = String::from_utf8_lossy(stdout_bytes).to_string();
            let stderr = String::from_utf8_lossy(stderr_bytes).to_string();

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
