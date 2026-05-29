# OpenCode Sidecar IPC Protocol Specification

Version: 0.1.0

## Overview

The OpenCode Rust sidecar communicates with the TS host process over a single
Unix domain socket (Linux/macOS) or Named Pipe (Windows). The connection carries
two logical channels multiplexed via a frame header:

1. **Control Plane** — JSON-RPC 2.0 (request/response, notifications)
2. **Data Plane** — Length-prefixed MessagePack frames (streaming events)

## Transport

| Platform | Transport | Path |
|----------|-----------|------|
| Linux/macOS | Unix Domain Socket | `$XDG_RUNTIME_DIR/opencode-{pid}.sock` or `/tmp/opencode-{pid}.sock` |
| Windows | Named Pipe | `\\.\pipe\opencode-{pid}` |

## Frame Format

Every message on the wire is wrapped in a frame:

```
┌─────────┬──────────┬─────────────────────────────┐
│ u8 type │ u32 len  │ payload (len bytes)          │
│ (1 byte)│ (4 BE)   │                              │
└─────────┴──────────┴─────────────────────────────┘
```

### Frame Types

| Type byte | Name | Payload encoding |
|-----------|------|------------------|
| `0x01` | JSON-RPC | UTF-8 JSON |
| `0x02` | MsgPack Stream Event | MessagePack binary |
| `0x03` | Heartbeat | empty (len=0) |
| `0xFF` | Shutdown | empty (len=0) |

## Control Plane: JSON-RPC 2.0

Standard JSON-RPC 2.0 messages wrapped in type `0x01` frames.

### Handshake

After connection, the client sends:

```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"version":"0.1.0","capabilities":["tools","pty","llm","session","mcp"]}}
```

Server responds:

```json
{"jsonrpc":"2.0","id":0,"result":{"version":"0.1.0","capabilities":["tools","pty","llm","session","mcp"]}}
```

### Method Namespaces

| Namespace | Phase | Examples |
|-----------|-------|----------|
| `pty.*` | 1 | `pty.spawn`, `pty.resize`, `pty.write`, `pty.kill` |
| `tools.*` | 1-2 | `tools.shell.exec`, `tools.file.read`, `tools.glob`, `tools.grep`, `tools.git.status` |
| `llm.*` | 3 | `llm.stream`, `llm.cancel` |
| `session.*` | 4 | `session.create`, `session.get`, `session.append`, `session.compact` |
| `agent.*` | 4 | `agent.list`, `agent.get` |
| `mcp.*` | 5 | `mcp.connect`, `mcp.call`, `mcp.disconnect` |
| `plugin.*` | 5 | `plugin.load`, `plugin.call` |
| `system.*` | 0 | `system.ping`, `system.shutdown`, `system.metrics` |

### Notifications (Server → Client)

| Method | Payload |
|--------|---------|
| `pty.output` | `{id, data: base64}` |
| `pty.exit` | `{id, exitCode}` |
| `session.event` | `{sessionId, type, payload}` |
| `system.log` | `{level, message, fields}` |

### Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32000 | Tool execution failed |
| -32001 | PTY not found |
| -32002 | Session not found |
| -32003 | Provider error |
| -32004 | Permission denied |
| -32005 | Timeout |

## Data Plane: MsgPack Stream Events

Used exclusively for LLM streaming. After `llm.stream` JSON-RPC call,
the server sends a series of type `0x02` frames:

### Event Schema (MessagePack)

```
{
  "stream_id": string,     // matches the llm.stream response
  "seq": u64,             // monotonic sequence number
  "type": string,         // event type (see below)
  "data": any             // type-specific payload
}
```

### Event Types

| Type | Data | Description |
|------|------|-------------|
| `token` | `{text: string}` | Incremental token |
| `tool_call_start` | `{id, name}` | Tool call initiated |
| `tool_call_delta` | `{id, args_delta: string}` | Tool call args chunk |
| `tool_call_end` | `{id}` | Tool call args complete |
| `tool_result` | `{id, result}` | Tool execution result |
| `usage` | `{input_tokens, output_tokens, cache_read, cache_write}` | Token usage |
| `error` | `{code, message}` | Stream error |
| `done` | `{finish_reason}` | Stream complete |

### Flow Control

- Client can send `llm.cancel` JSON-RPC to abort a stream
- Server sends final `done` event with `finish_reason: "cancelled"`
- Unacknowledged streams auto-timeout after 300s

## Heartbeat

Server sends `0x03` frames every 30s. If client receives no frames for 60s,
it should consider the connection dead and attempt reconnection.

## Lifecycle

```
1. TS host spawns Rust sidecar process
2. Sidecar creates socket/pipe and prints path to stdout
3. TS host connects to socket
4. Client sends `initialize` handshake
5. Normal operation (JSON-RPC + MsgPack streams)
6. On shutdown: client sends `0xFF` frame OR `system.shutdown` RPC
7. Sidecar drains pending work (5s grace) then exits
8. On crash: TS host detects EOF, restarts sidecar (max 3 retries)
```

## Versioning

Protocol version follows semver. Breaking changes increment major.
Client and server must agree on major version during handshake.
