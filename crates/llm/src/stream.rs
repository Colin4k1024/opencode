//! Stream controller — manages LLM streaming sessions
//!
//! Wraps oris-runtime's `stream()` method and converts events to our
//! protocol's MsgPack StreamEvent format.

use crate::error::LlmError;
use crate::provider::{ProviderConfig, create_provider};
use futures::StreamExt;
use opencode_protocol::stream_event::{Event, StreamEvent};
use oris_runtime::language_models::llm::LLM;
use oris_runtime::schemas::Message;
use tokio::sync::{mpsc, watch};
use tracing::{error, info};

/// A streaming LLM session that produces StreamEvents
pub struct StreamController {
    stream_id: String,
    cancel_tx: watch::Sender<bool>,
}

impl StreamController {
    /// Start a streaming LLM call, returning a controller and event receiver
    pub fn start(
        stream_id: String,
        config: ProviderConfig,
        messages: Vec<LlmMessage>,
        system: Option<String>,
    ) -> Result<(Self, mpsc::UnboundedReceiver<StreamEvent>), LlmError> {
        let provider = create_provider(&config)?;
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (cancel_tx, cancel_rx) = watch::channel(false);

        let sid = stream_id.clone();
        tokio::spawn(async move {
            run_stream(sid, provider, messages, system, event_tx, cancel_rx).await;
        });

        let controller = Self {
            stream_id,
            cancel_tx,
        };

        Ok((controller, event_rx))
    }

    /// Cancel the stream
    pub fn cancel(&self) {
        let _ = self.cancel_tx.send(true);
    }

    pub fn stream_id(&self) -> &str {
        &self.stream_id
    }
}

/// Message format for LLM requests
#[derive(Debug, Clone, serde::Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

impl From<&LlmMessage> for Message {
    fn from(msg: &LlmMessage) -> Self {
        match msg.role.as_str() {
            "system" => Message::new_system_message(&msg.content),
            "assistant" => Message::new_ai_message(&msg.content),
            _ => Message::new_human_message(&msg.content),
        }
    }
}

async fn run_stream(
    stream_id: String,
    provider: Box<dyn LLM>,
    messages: Vec<LlmMessage>,
    system: Option<String>,
    event_tx: mpsc::UnboundedSender<StreamEvent>,
    mut cancel_rx: watch::Receiver<bool>,
) {
    let mut seq: u64 = 0;

    // Build oris messages
    let mut oris_messages: Vec<Message> = Vec::new();
    if let Some(sys) = system {
        oris_messages.push(Message::new_system_message(&sys));
    }
    for msg in &messages {
        oris_messages.push(msg.into());
    }

    info!(stream_id = %stream_id, messages = oris_messages.len(), "starting LLM stream");

    // Use oris stream API
    let stream_result = provider.stream(&oris_messages).await;

    match stream_result {
        Ok(mut stream) => {
            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() {
                            let _ = event_tx.send(StreamEvent {
                                stream_id: stream_id.clone(),
                                seq,
                                event: Event::Done { finish_reason: "cancelled".to_string() },
                            });
                            return;
                        }
                    }
                    item = stream.next() => {
                        match item {
                            Some(Ok(data)) => {
                                let event = Event::Token { text: data.content };
                                let _ = event_tx.send(StreamEvent {
                                    stream_id: stream_id.clone(),
                                    seq,
                                    event,
                                });
                                seq += 1;
                            }
                            Some(Err(e)) => {
                                let _ = event_tx.send(StreamEvent {
                                    stream_id: stream_id.clone(),
                                    seq,
                                    event: Event::Error {
                                        code: -1,
                                        message: e.to_string(),
                                    },
                                });
                                return;
                            }
                            None => {
                                // Stream ended
                                break;
                            }
                        }
                    }
                }
            }

            // Send done event
            let _ = event_tx.send(StreamEvent {
                stream_id: stream_id.clone(),
                seq,
                event: Event::Done {
                    finish_reason: "stop".to_string(),
                },
            });
        }
        Err(e) => {
            error!(stream_id = %stream_id, error = %e, "stream failed to start");
            let _ = event_tx.send(StreamEvent {
                stream_id,
                seq: 0,
                event: Event::Error {
                    code: -1,
                    message: e.to_string(),
                },
            });
        }
    }
}
