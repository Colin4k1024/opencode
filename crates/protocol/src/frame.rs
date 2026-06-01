//! Wire frame encoding/decoding

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A single frame on the wire
pub struct Frame {
    pub frame_type: u8,
    pub payload: Vec<u8>,
}

/// Reads frames from a Unix socket
pub struct FrameReader {
    reader: OwnedReadHalf,
}

impl FrameReader {
    pub fn new(reader: OwnedReadHalf) -> Self {
        Self { reader }
    }

    pub async fn read_frame(&mut self) -> Result<Frame> {
        // Read type byte
        let frame_type = self.reader.read_u8().await?;

        // Read length (4 bytes big-endian)
        let len = self.reader.read_u32().await?;

        // Read payload
        let mut payload = vec![0u8; len as usize];
        if len > 0 {
            self.reader.read_exact(&mut payload).await?;
        }

        Ok(Frame { frame_type, payload })
    }
}

/// Writes frames to a Unix socket
#[derive(Clone)]
pub struct FrameWriter {
    writer: Arc<Mutex<OwnedWriteHalf>>,
}

impl FrameWriter {
    pub fn new(writer: OwnedWriteHalf) -> Self {
        Self {
            writer: Arc::new(Mutex::new(writer)),
        }
    }

    pub async fn write_frame(&self, frame_type: u8, payload: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().await;
        writer.write_u8(frame_type).await?;
        writer.write_u32(payload.len() as u32).await?;
        if !payload.is_empty() {
            writer.write_all(payload).await?;
        }
        writer.flush().await?;
        Ok(())
    }

    pub async fn write_jsonrpc(&self, response: &crate::jsonrpc::Response) -> Result<()> {
        let payload = serde_json::to_vec(response)?;
        self.write_frame(crate::FRAME_JSONRPC, &payload).await
    }

    pub async fn write_msgpack_event(&self, event: &crate::stream_event::StreamEvent) -> Result<()> {
        let payload = rmp_serde::to_vec(event)?;
        self.write_frame(crate::FRAME_MSGPACK, &payload).await
    }

    pub async fn write_heartbeat(&self) -> Result<()> {
        self.write_frame(crate::FRAME_HEARTBEAT, &[]).await
    }
}
