//! PTY session manager — owns all active PTY sessions

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::info;

/// Unique PTY session identifier
pub type PtyId = String;

#[derive(Error, Debug)]
pub enum PtyError {
    #[error("pty not found: {0}")]
    NotFound(PtyId),
    #[error("spawn failed: {0}")]
    SpawnFailed(String),
    #[error("write failed: {0}")]
    WriteFailed(String),
    #[error("resize failed: {0}")]
    ResizeFailed(String),
    #[error("already closed: {0}")]
    AlreadyClosed(PtyId),
}

/// Parameters for spawning a new PTY
#[derive(Debug, Clone, Deserialize)]
pub struct SpawnParams {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<Vec<(String, String)>>,
    pub cols: u16,
    pub rows: u16,
}

/// Events emitted by a PTY session
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum PtyEvent {
    #[serde(rename = "output")]
    Output { id: PtyId, data: String },
    #[serde(rename = "exit")]
    Exit { id: PtyId, exit_code: Option<u32> },
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Manages all active PTY sessions
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<PtyId, Arc<Mutex<PtySession>>>>>,
    event_tx: mpsc::UnboundedSender<PtyEvent>,
    event_rx: Arc<Mutex<mpsc::UnboundedReceiver<PtyEvent>>>,
    next_id: Arc<std::sync::atomic::AtomicU64>,
}

impl PtyManager {
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            event_rx: Arc::new(Mutex::new(event_rx)),
            next_id: Arc::new(std::sync::atomic::AtomicU64::new(1)),
        }
    }

    /// Get the event receiver for forwarding PTY output to the client
    pub fn event_receiver(&self) -> Arc<Mutex<mpsc::UnboundedReceiver<PtyEvent>>> {
        self.event_rx.clone()
    }

    /// Spawn a new PTY session
    pub fn spawn(&self, params: SpawnParams) -> Result<PtyId, PtyError> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: params.rows,
                cols: params.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&params.command);
        cmd.args(&params.args);

        if let Some(ref cwd) = params.cwd {
            cmd.cwd(cwd);
        }

        if let Some(ref env_vars) = params.env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let id = format!(
            "pty-{}",
            self.next_id
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        );

        // Spawn reader thread for output
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let event_tx = self.event_tx.clone();
        let read_id = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Send output as base64 to handle binary data
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = event_tx.send(PtyEvent::Output {
                            id: read_id.clone(),
                            data,
                        });
                    }
                    Err(_) => break,
                }
            }
            let _ = event_tx.send(PtyEvent::Exit {
                id: read_id,
                exit_code: None,
            });
        });

        let session = PtySession {
            master: pair.master,
            writer,
            _child: child,
        };

        let sessions = self.sessions.clone();
        let session_id = id.clone();
        tokio::spawn(async move {
            sessions
                .write()
                .await
                .insert(session_id, Arc::new(Mutex::new(session)));
        });

        info!(pty_id = %id, command = %params.command, "pty spawned");
        Ok(id)
    }

    /// Write data to a PTY session
    pub async fn write(&self, id: &str, data: &[u8]) -> Result<(), PtyError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        let mut session = session.lock().await;
        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;
        session
            .writer
            .flush()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        Ok(())
    }

    /// Resize a PTY session
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        let session = session.lock().await;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::ResizeFailed(e.to_string()))?;

        Ok(())
    }

    /// Kill a PTY session
    pub async fn kill(&self, id: &str) -> Result<(), PtyError> {
        let mut sessions = self.sessions.write().await;
        let _session = sessions
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        // Dropping the session closes the master PTY, which signals the child
        info!(pty_id = %id, "pty killed");
        Ok(())
    }

    /// List active PTY session IDs
    pub async fn list(&self) -> Vec<PtyId> {
        self.sessions.read().await.keys().cloned().collect()
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_spawn_and_kill() {
        let manager = PtyManager::new();

        let id = manager
            .spawn(SpawnParams {
                command: if cfg!(windows) {
                    "cmd.exe".to_string()
                } else {
                    "/bin/sh".to_string()
                },
                args: vec![],
                cwd: None,
                env: None,
                cols: 80,
                rows: 24,
            })
            .expect("spawn should succeed");

        assert!(id.starts_with("pty-"));

        // Give it a moment to register in the async map
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        manager.kill(&id).await.expect("kill should succeed");
    }
}
