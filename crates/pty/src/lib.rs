//! PTY management for OpenCode sidecar
//!
//! Provides cross-platform PTY spawn, resize, write, and kill operations.
//! Uses `portable-pty` for Unix (openpty) and Windows (ConPTY) support.

mod manager;

pub use manager::{PtyManager, PtyId, SpawnParams, PtyEvent, PtyError};
