# Arch Design: OpenCode Rust Runtime Sidecar

| 字段 | 值 |
|------|-----|
| slug | rust-runtime-sidecar |
| 日期 | 2026-05-29 |
| 状态 | draft |
| 主责 | architect |

---

## 系统边界

```
┌────────────────────────────────────────────────────────────────┐
│ External                                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ LLM APIs    │  │ MCP Servers  │  │ Git / Filesystem    │   │
│  │ (HTTPS/WSS) │  │ (stdio/SSE)  │  │ (local)             │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘   │
└─────────┼────────────────┼──────────────────────┼──────────────┘
          │                │                      │
┌─────────▼────────────────▼──────────────────────▼──────────────┐
│ Rust Runtime Sidecar (单进程, tokio multi-thread)               │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌───────┐ ┌──────────┐ │
│  │ LLM      │ │ Tools    │ │ PTY    │ │ MCP   │ │ Session  │ │
│  │ Streaming│ │ Registry │ │ Manager│ │ Client│ │ + Agent  │ │
│  └────┬─────┘ └────┬─────┘ └───┬────┘ └───┬───┘ └────┬─────┘ │
│       │            │           │           │          │        │
│  ┌────▼────────────▼───────────▼───────────▼──────────▼─────┐ │
│  │ RPC Router (JSON-RPC control + MsgPack data stream)       │ │
│  └─────────────────────────────┬─────────────────────────────┘ │
│                                │                                │
│  ┌─────────────────────────────▼─────────────────────────────┐ │
│  │ Storage Layer (rusqlite: runtime.db → 统一 db)            │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬───────────────────────────────┘
                                 │ Unix socket / Named pipe
┌────────────────────────────────▼───────────────────────────────┐
│ TS Host Process (Bun)                                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Thin Client  │  │ Config/Bus   │  │ UI Layer (渐进收缩)  │ │
│  │ (RPC caller) │  │ (Effect TS)  │  │ CLI / TUI / Desktop  │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

---

## Rust Crate 拆分

```
crates/
├── runtime/           # main binary, tokio bootstrap, lifecycle
│   └── src/main.rs
├── protocol/          # IPC 协议定义 (JSON-RPC + MsgPack frames)
│   ├── src/jsonrpc.rs
│   ├── src/msgpack.rs
│   └── src/schema.rs  # shared Message/Event types
├── pty/               # PTY spawn/resize/signal (portable-pty)
│   └── src/lib.rs
├── tools/             # Tool implementations
│   ├── src/shell.rs   # command execution
│   ├── src/file.rs    # read/write/edit
│   ├── src/glob.rs    # file pattern matching (ignore crate)
│   ├── src/grep.rs    # content search (grep-searcher)
│   ├── src/git.rs     # git operations (git2-rs)
│   └── src/registry.rs
├── llm/               # LLM provider abstraction
│   ├── src/provider/
│   │   ├── anthropic.rs
│   │   ├── openai.rs
│   │   ├── google.rs
│   │   ├── azure.rs
│   │   ├── bedrock.rs
│   │   └── xai.rs
│   ├── src/stream.rs  # SSE/WebSocket parsing
│   ├── src/cache.rs   # cache policy
│   └── src/tool_call.rs
├── session/           # Session state machine + persistence
│   ├── src/session.rs
│   ├── src/message.rs
│   ├── src/compaction.rs
│   └── src/db.rs      # rusqlite schema + migrations
├── agent/             # Agent config + prompt + tool loop
│   ├── src/agent.rs
│   ├── src/permission.rs
│   └── src/prompt.rs
├── mcp/               # MCP client (stdio + SSE)
│   ├── src/transport.rs
│   ├── src/oauth.rs
│   └── src/client.rs
└── plugin/            # Plugin loading + WASI sandbox
    ├── src/loader.rs
    └── src/sandbox.rs
```

---

## IPC 协议设计

### 控制面: JSON-RPC 2.0 over Unix Socket

```json
// Request
{"jsonrpc":"2.0","id":1,"method":"tools.shell.exec","params":{"command":"ls","cwd":"/tmp","timeout":30000}}

// Response
{"jsonrpc":"2.0","id":1,"result":{"exitCode":0,"stdout":"...","stderr":""}}
```

### 数据面: Length-prefixed MessagePack Frame Stream

```
┌────────────┬──────────────────────────────┐
│ u32 length │ MessagePack payload           │
└────────────┴──────────────────────────────┘
```

用于 LLM streaming events:
- `token_delta`: 增量 token 文本
- `tool_call_start`: tool call 开始
- `tool_call_delta`: tool call 参数增量
- `tool_result`: tool 执行结果
- `usage`: token 使用统计
- `done`: 流结束

### 生命周期管理

```
TS Host 启动 → spawn Rust sidecar (子进程)
  → Unix socket ready (handshake)
  → 正常服务
  → TS Host 退出 → SIGTERM → Rust graceful shutdown (5s timeout)
  → Rust crash → TS 检测退出码 → auto-restart (max 3 retries)
```

---

## 关键数据流

### Tool 执行流

```
User input → TS CLI parse → thin client RPC → Rust RPC Router
  → Tools Registry → Shell/File/Git executor → result
  → RPC response → TS → UI render
```

### LLM Streaming 流

```
TS: streamRequest(messages, tools, model) → JSON-RPC call to Rust
Rust:
  → resolve provider → build HTTP request → send to LLM API
  → receive SSE stream → parse events → MsgPack frame → Unix socket
TS:
  → read MsgPack frames → decode events → feed to UI stream
  → on tool_call → JSON-RPC call tools.* → feed result back
  → loop until done
```

### Session 持久化流

```
Rust Session:
  → message append → rusqlite INSERT (runtime.db)
  → compaction trigger → summarize → UPDATE
  → snapshot → checkpoint
TS (Phase 0-3):
  → state.db: config, project metadata (TS 独占)
Phase 4+:
  → 全部收归 runtime.db (Rust 独占)
```

---

## 技术选型

| 组件 | 选型 | 原因 |
|------|------|------|
| Runtime | tokio (multi-thread) | 成熟、生态完善 |
| TLS | rustls | 纯 Rust、静态链接友好、无 C 依赖 |
| HTTP client | reqwest (with rustls) | 成熟、async、streaming 支持 |
| SQLite | rusqlite | 同步 API 足够、WAL 模式、与 Drizzle schema 兼容 |
| PTY | portable-pty | 跨平台、ConPTY 支持 |
| Git | git2-rs (libgit2) | 功能完整、静态链接 |
| File search | ignore + grep-searcher | ripgrep 内核 crate |
| Serialization | serde + serde_json + rmp-serde | JSON + MessagePack 双支持 |
| Error handling | thiserror + anyhow | typed error at boundaries, anyhow in tools |
| Logging | tracing + tracing-subscriber | 结构化日志、span 追踪 |
| CLI (sidecar) | clap | 参数解析（端口/socket path 等） |

---

## 风险与约束

| 风险 | 缓解 |
|------|------|
| git2-rs 静态链接 libgit2 增加 ~3MB 体积 | 可接受，总体 binary <20MB |
| rusqlite 不支持 async | Session DB 操作低频，spawn_blocking 足够 |
| portable-pty Windows 行为差异 | Phase 1 优先 Windows CI 验证 |
| MsgPack 调试不如 JSON 直观 | 开发模式可选 JSON fallback |
| libgit2 vs git CLI 行为差异 | 对齐现有 TS 侧 git 操作的具体命令子集 |

---

## 迁移期数据库策略

```
Phase 0-3:
  TS → state.db (config, project, workspace)
  Rust → runtime.db (session, messages, parts)

Phase 4:
  Rust → unified opencode.db (all tables)
  TS → RPC 读写 (via sidecar)

Migration:
  Phase 4 启动时: state.db → opencode.db 一次性迁移
  验证后: 删除 state.db
```

---

## 接口约定

### JSON-RPC Methods (Phase 1-2)

| Method | Params | Result |
|--------|--------|--------|
| `pty.spawn` | `{command, args, cwd, env, cols, rows}` | `{id}` |
| `pty.resize` | `{id, cols, rows}` | `{}` |
| `pty.write` | `{id, data}` | `{}` |
| `pty.kill` | `{id, signal}` | `{}` |
| `tools.shell.exec` | `{command, cwd, timeout, env}` | `{exitCode, stdout, stderr}` |
| `tools.file.read` | `{path, offset, limit}` | `{content, totalLines}` |
| `tools.file.write` | `{path, content}` | `{}` |
| `tools.file.edit` | `{path, oldString, newString, replaceAll}` | `{applied}` |
| `tools.glob` | `{pattern, path}` | `{files[]}` |
| `tools.grep` | `{pattern, path, options}` | `{matches[]}` |
| `tools.git.status` | `{cwd}` | `{files[]}` |
| `tools.git.diff` | `{cwd, ref}` | `{diff}` |

### JSON-RPC Methods (Phase 3-4)

| Method | Params | Result |
|--------|--------|--------|
| `llm.stream` | `{model, messages, tools, system}` | stream ID (data via MsgPack channel) |
| `llm.cancel` | `{streamId}` | `{}` |
| `session.create` | `{projectID, directory}` | `{id, slug}` |
| `session.get` | `{id}` | `{...session}` |
| `session.append` | `{id, message}` | `{messageId}` |
| `session.compact` | `{id}` | `{summary}` |
| `agent.list` | `{}` | `{agents[]}` |
| `agent.get` | `{name}` | `{...info}` |

### Notifications (Rust → TS, 单向)

| Notification | Payload |
|--------------|---------|
| `pty.output` | `{id, data}` |
| `pty.exit` | `{id, exitCode}` |
| `session.event` | `{sessionId, event}` |

---

## 安全考量

- Rust sidecar 仅监听 Unix socket（文件权限 600），不暴露网络端口
- Windows 使用 Named Pipe with DACL 限制当前用户
- LLM API keys 通过 RPC 传递（不持久化在 Rust 侧配置），或从环境变量读取
- Plugin sandbox 使用 WASI（wasmtime），限制 fs/net 访问
- 进程间通信不经过网络栈，无 TLS 开销
