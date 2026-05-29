//! IPC Protocol Benchmark
//!
//! Measures JSON-RPC and MsgPack frame encoding/decoding latency
//! to validate P99 < 1ms per event at 1000 events/s.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use opencode_protocol::jsonrpc::{Request, Response};
use opencode_protocol::stream_event::{Event, StreamEvent};

fn bench_jsonrpc_roundtrip(c: &mut Criterion) {
    let request_json = r#"{"jsonrpc":"2.0","id":1,"method":"tools.shell.exec","params":{"command":"ls","cwd":"/tmp","timeout":30000}}"#;

    c.bench_function("jsonrpc_decode_request", |b| {
        b.iter(|| {
            let _: Request = serde_json::from_str(black_box(request_json)).unwrap();
        })
    });

    let response = Response::success(1, serde_json::json!({"exitCode": 0, "stdout": "hello\nworld\n", "stderr": ""}));

    c.bench_function("jsonrpc_encode_response", |b| {
        b.iter(|| {
            let _ = serde_json::to_vec(black_box(&response)).unwrap();
        })
    });
}

fn bench_msgpack_stream_event(c: &mut Criterion) {
    let event = StreamEvent {
        stream_id: "stream-001".to_string(),
        seq: 42,
        event: Event::Token { text: "Hello".to_string() },
    };

    c.bench_function("msgpack_encode_event", |b| {
        b.iter(|| {
            let _ = rmp_serde::to_vec(black_box(&event)).unwrap();
        })
    });

    let encoded = rmp_serde::to_vec(&event).unwrap();

    c.bench_function("msgpack_decode_event", |b| {
        b.iter(|| {
            let _: StreamEvent = rmp_serde::from_slice(black_box(&encoded)).unwrap();
        })
    });

    // Comparative: JSON encode the same event
    c.bench_function("json_encode_event_comparison", |b| {
        b.iter(|| {
            let _ = serde_json::to_vec(black_box(&event)).unwrap();
        })
    });
}

fn bench_frame_encoding(c: &mut Criterion) {
    let payload = vec![0u8; 256]; // typical token event size

    c.bench_function("frame_header_write", |b| {
        b.iter(|| {
            let mut buf = Vec::with_capacity(5 + payload.len());
            buf.push(0x02u8); // FRAME_MSGPACK
            buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            buf.extend_from_slice(black_box(&payload));
            black_box(buf);
        })
    });
}

criterion_group!(
    benches,
    bench_jsonrpc_roundtrip,
    bench_msgpack_stream_event,
    bench_frame_encoding
);
criterion_main!(benches);
