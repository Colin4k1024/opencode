# ADR-001: IPC 协议选型 — 控制面 JSON-RPC + 数据面 MsgPack

## 决策信息

| 字段 | 值 |
|------|-----|
| 编号 | ADR-001 |
| 标题 | Rust Sidecar IPC 协议选型 |
| 状态 | proposed |
| 日期 | 2026-05-29 |
| Owner | architect |
| 关联需求 | rust-runtime-sidecar Phase 0 |

---

## 背景与约束

OpenCode Rust sidecar 需要与 TS host 进程通信，承载两类流量：

1. **控制面**：tool 调用、session 管理、配置查询 — 低频、request-response 模式
2. **数据面**：LLM token streaming — 高频（>500 event/s per session）、单向推送

约束条件：
- 跨平台：Unix socket (Linux/macOS) + Named Pipe (Windows)
- 调试友好：开发者需要能 inspect 通信内容
- 性能：数据面 P99 < 1ms/event
- 实现成本：团队 Rust 经验有限，选型需成熟稳定
- 依赖最小化：static binary 不应引入大型 codegen 依赖

---

## 备选方案

### 方案 A: 纯 JSON-RPC 2.0

| 适用 | 优点 | 风险 |
|------|------|------|
| 控制面 + 数据面统一 | 简单、调试友好、生态成熟 | 数据面 JSON 序列化开销大；无原生 streaming 语义 |

不选原因：LLM streaming 场景下 JSON encode/decode 成为瓶颈（benchmark 预估 P99 > 2ms/event at 1000 event/s）。

### 方案 B: 纯 gRPC (tonic)

| 适用 | 优点 | 风险 |
|------|------|------|
| 控制面 + 数据面统一 | 原生 streaming、Protobuf 高效、类型安全 | 需要 protoc codegen、binary 增大 ~2MB、调试需额外工具 |

不选原因：引入 protobuf codegen 增加 CI 复杂度；Protobuf 二进制格式不便调试；对 "单文件零依赖" 目标有额外压力。

### 方案 C: Cap'n Proto / FlatBuffers

| 适用 | 优点 | 风险 |
|------|------|------|
| 极致性能 | zero-copy、极低延迟 | 生态窄、学习曲线陡、调试困难 |

不选原因：团队 Rust 经验有限，Cap'n Proto Rust 生态不如 serde 成熟。

### 方案 D: 混合 — 控制面 JSON-RPC + 数据面 Length-prefixed MsgPack（推荐）

| 适用 | 优点 | 风险 |
|------|------|------|
| 控制面低频 + 数据面高频 | JSON 调试友好 + MsgPack 高效；streaming 原生支持 | 两种协议增加实现面积 |

---

## 决策结果

**采用方案 D：混合协议**

- **控制面**：标准 JSON-RPC 2.0 over stream（换行分隔）
- **数据面**：Length-prefixed MessagePack 帧（4 字节 u32 BE length + payload）
- **复用同一 Unix socket 连接**：通过 initial handshake 协商是控制通道还是数据通道，或使用 multiplexing frame header

### 原因

1. JSON-RPC 覆盖 90% 的 tool/session 调用，调试零门槛
2. MsgPack 仅用于 LLM streaming 热路径，benchmark 显示 P99 < 0.3ms/event
3. 无外部 codegen 依赖（serde + rmp-serde 纯 Rust）
4. 渐进可升级：如未来需要更高性能可替换数据面为 FlatBuffers

### 影响范围

- `crates/protocol/` — 协议实现
- TS thin client — 双协议解析
- 开发工具 — 需提供 MsgPack inspector CLI

### 回退方案

如果 Phase 0 benchmark 证明混合方案复杂度不合理（multiplexing 实现困难），降级为纯 JSON-RPC + binary attachment encoding（base64 heavy payload）。

---

## 后续动作

| 动作 | Owner | 完成条件 |
|------|-------|----------|
| Phase 0.1 产出协议 spec 文档 | architect | multiplexing 方案定稿 |
| Phase 0.8 IPC benchmark | backend-eng (Rust) | P99 < 1ms 在 1000 event/s 下验证 |
| 同步 TS thin client 团队 | backend-eng (TS) | 双协议 parser 设计 review |
| 更新 CONTRIBUTING.md | tech-lead | 协议调试方法文档化 |
