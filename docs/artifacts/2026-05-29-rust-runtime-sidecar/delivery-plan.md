# Delivery Plan: OpenCode Rust Runtime Sidecar

| 字段 | 值 |
|------|-----|
| slug | rust-runtime-sidecar |
| 日期 | 2026-05-29 |
| 状态 | draft |
| 阶段 | plan |
| 主责 | tech-lead |

---

## 需求挑战会结论

### 挑战 1: IPC 协议选型 — JSON-RPC 不适合高频 streaming

| 项目 | 内容 |
|------|------|
| 质疑人 | architect |
| 质疑 | JSON-RPC 是 request-response 模型，LLM token stream 每秒 >500 条事件时 JSON 序列化成瓶颈 |
| 替代路径 | A) gRPC streaming B) length-prefixed MessagePack C) Cap'n Proto |
| 结论 | **采用混合方案**：控制面用 JSON-RPC（简单、调试友好），数据面（LLM stream）用 length-prefixed MessagePack 帧流。Phase 0 产出 benchmark 对比验证 |
| 阻断条件 | IPC 延迟 P99 > 1ms/event 则方案不可接受 |

### 挑战 2: 双进程模型运维复杂度

| 项目 | 内容 |
|------|------|
| 质疑人 | architect |
| 质疑 | 6 Phase 内双进程共享 SQLite、跨进程 trace、crash 恢复协调 |
| 替代路径 | A) 大爆炸迁移 B) WASM 嵌入 C) Napi FFI |
| 结论 | 坚持 sidecar 方案但增加约束：每 Phase 双引擎 TTL ≤ 4 周，超时必须 promote 或 revert。加 shadow-mode 对比测试 |
| 阻断条件 | 任何 Phase 中间态无法独立 ship |

### 挑战 3: SQLite 并发锁竞争

| 项目 | 内容 |
|------|------|
| 质疑人 | architect |
| 质疑 | TS + Rust 双进程写同一 SQLite 文件，WAL 模式下写仍排他 |
| 替代路径 | A) DB 访问收归 Rust B) 拆分 db 文件 C) libSQL |
| 结论 | **Phase 0 拆分为两个 db**：`runtime.db`(Rust 独占) + `state.db`(TS 独占)。Phase 4 统一收归 Rust |
| 阻断条件 | 写操作 P99 > 200ms |

### 挑战 4: 静态链接 TLS 体积

| 项目 | 内容 |
|------|------|
| 质疑人 | architect |
| 质疑 | OpenSSL 静态链接 15-25MB + 交叉编译复杂 |
| 结论 | **使用 rustls**（纯 Rust TLS），FIPS 场景列为 Out of Scope，企业版可后续扩展 |
| 阻断条件 | 目标用户强制 FIPS 140-2 |

### 挑战 5: 工期估算未纳入 upstream drift

| 项目 | 内容 |
|------|------|
| 质疑人 | project-manager |
| 质疑 | 16-19 周仅覆盖 schedule variance，未计入 TS 代码持续变化的追赶成本 |
| 结论 | 增加 weekly drift audit：每周审查目标模块 diff，如 >15% surface 变化触发 re-estimation。总估算调整为 **18-22 周** |
| 阻断条件 | 任意 Phase 目标模块月变更率 >30% |

### 挑战 6: Phase 3/4 并行化空间

| 项目 | 内容 |
|------|------|
| 质疑人 | project-manager |
| 质疑 | LLM(P3) 和 Session(P4) 串行依赖是否架构强制？ |
| 结论 | 若 Phase 0 稳定 Message 类型定义，P3/P4 可 1 周 stagger 后并行。调整计划：P3+P4 合并窗口 6 周（并行 with stagger），而非 8 周串行 |
| 阻断条件 | Message schema 在 P3 期间不稳定 |

---

## 版本目标

| 里程碑 | 范围 | 放行标准 |
|--------|------|----------|
| M0: Foundation | 协议定义、Rust workspace、CI、benchmark harness | 协议 design review 通过 + CI 绿 |
| M1: Tools Runtime | PTY + Shell + File + Git + Glob + Grep 全部走 Rust | 全部 tool 集成测试通过，性能 ≥ 当前 |
| M2: LLM + Session | LLM streaming + Session/Agent 编排 | shadow-mode 对比 0 diff |
| M3: Full Runtime | MCP + Plugin + 集成切换 | E2E 全量通过，feature flag 100% 切到 Rust |

---

## 工作拆解（Phase 0 + Phase 1 详细）

### Phase 0: Foundation（Week 1-2）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 0.1 | IPC 协议 spec 文档 | architect | — | 控制面 JSON-RPC + 数据面 MsgPack 帧格式定义完成 |
| 0.2 | Rust workspace 骨架 | backend-eng (Rust) | — | `crates/{runtime,protocol,pty,tools,llm}` 编译通过 |
| 0.3 | CI pipeline (cross-compile) | devops-engineer | 0.2 | linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64 全绿 |
| 0.4 | Sidecar lifecycle manager (TS) | backend-eng (TS) | 0.1 | TS 侧可 spawn/monitor/restart Rust sidecar |
| 0.5 | SQLite 拆分方案实施 | backend-eng (TS) | — | `runtime.db` + `state.db` 分离，现有测试通过 |
| 0.6 | Benchmark harness | backend-eng (Rust) | 0.2 | hyperfine + criterion 基准套件，baseline 记录 |
| 0.7 | Protocol design review | tech-lead | 0.1 | 全组 review 通过，ADR 产出 |
| 0.8 | IPC benchmark (JSON-RPC vs MsgPack) | backend-eng (Rust) | 0.2, 0.1 | P99 < 1ms/event 在 1000 event/s 下 |

**Phase 0 检查节点**：
- Week 1 末：0.1 + 0.2 + 0.5 完成
- Week 2 末：0.3 + 0.4 + 0.6 + 0.7 + 0.8 完成，design review 通过

---

### Phase 1: PTY + Shell（Week 3-5）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 1.1 | `crates/pty` — PTY spawn/resize/signal | backend-eng (Rust-A) | P0 | Unix + Windows ConPTY，单元测试通过 |
| 1.2 | `crates/tools/shell` — 命令执行/timeout/sandbox | backend-eng (Rust-A) | 1.1 | 支持 timeout、working dir、env 注入 |
| 1.3 | Shell RPC handler (sidecar 侧) | backend-eng (Rust-A) | 1.2, P0.1 | 注册到 sidecar JSON-RPC router |
| 1.4 | TS thin client — `pty/` 替换 | backend-eng (TS) | 1.3 | 现有 PTY 集成测试全部通过（走 RPC） |
| 1.5 | Feature flag: `OPENCODE_RUST_PTY` | backend-eng (TS) | 1.4 | flag=off 走旧路径，flag=on 走 Rust |
| 1.6 | 性能基准对比 | qa-engineer | 1.4 | 并发 10 shell 吞吐 ≥ 2x 当前 |
| 1.7 | Windows ConPTY 验证 | qa-engineer | 1.1 | Windows CI 绿，PID 0 edge case 覆盖 |

**Phase 1 检查节点**：
- Week 3 末：1.1 + 1.2 完成
- Week 4 末：1.3 + 1.4 + 1.5 完成
- Week 5 末：1.6 + 1.7 完成，Phase 1 sign-off

---

### Phase 2: File/Git/Search（Week 3-5，与 P1 并行）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 2.1 | `crates/tools/file` — read/write/edit/glob | backend-eng (Rust-B) | P0 | ignore crate + 全量 glob 测试 |
| 2.2 | `crates/tools/search` — grep (ripgrep 内核) | backend-eng (Rust-B) | P0 | regex + context lines + head_limit |
| 2.3 | `crates/tools/git` — status/diff/log/commit | backend-eng (Rust-B) | P0 | git2-rs 封装，全量 git 测试 |
| 2.4 | Tools RPC handlers (sidecar 侧) | backend-eng (Rust-B) | 2.1-2.3 | 注册到 sidecar router |
| 2.5 | TS thin client — `tool/{glob,grep,read,write,edit,git}` 替换 | backend-eng (TS) | 2.4 | 现有 tool 测试全部通过 |
| 2.6 | Feature flag: `OPENCODE_RUST_TOOLS` | backend-eng (TS) | 2.5 | 独立开关 |
| 2.7 | 性能基准：大仓库 grep/glob | qa-engineer | 2.5 | 100k 文件仓库 glob P95 < 500ms |

**Phase 2 检查节点**：
- Week 4 末：2.1 + 2.2 + 2.3 完成
- Week 5 末：2.4-2.7 完成，Phase 2 sign-off

---

### Phase 3: LLM Streaming（Week 6-9）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 3.1 | `crates/llm/provider` — Anthropic/OpenAI SSE | backend-eng (Rust-A) | P1+P2 | streaming token 事件输出正确 |
| 3.2 | `crates/llm/provider` — Google/Azure/Bedrock/xAI | backend-eng (Rust-B) | 3.1 | 6 provider 全覆盖 |
| 3.3 | Tool call 解析 + structured output | backend-eng (Rust-A) | 3.1 | JSON schema validation 通过 |
| 3.4 | Cache policy + retry + rate limit | backend-eng (Rust-B) | 3.1 | 与现有行为对齐 |
| 3.5 | MsgPack stream bridge (sidecar → TS) | backend-eng (Rust-A) | 3.1, P0.1 | LLM events 帧流正确 |
| 3.6 | TS thin client — `session/llm.ts` 替换 | backend-eng (TS) | 3.5 | shadow-mode: Rust 输出 vs TS 输出 diff = 0 |
| 3.7 | Feature flag: `OPENCODE_RUST_LLM` | backend-eng (TS) | 3.6 | 可独立切换 |

---

### Phase 4: Session + Agent（Week 7-12，与 P3 stagger 1 周后并行）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 4.1 | Message schema (Rust 定义，共享 JSON Schema) | architect | P0 | TS + Rust 双侧 codegen 通过 |
| 4.2 | `crates/session` — 状态机 + rusqlite 持久化 | backend-eng (Rust-A) | 4.1 | session CRUD + compaction |
| 4.3 | `crates/agent` — 配置加载 + prompt 组装 + tool loop | backend-eng (Rust-B) | 4.2 | agent loop 正确执行 |
| 4.4 | Permission system 移植 | backend-eng (Rust-A) | 4.3 | 规则匹配与现有行为一致 |
| 4.5 | TS 编排层全面切换到 Rust Session RPC | backend-eng (TS) | 4.2-4.4 | E2E 通过 |
| 4.6 | SQLite 统一收归 Rust | backend-eng (Rust-A) | 4.5 | 删除 `state.db`，所有 DB 操作走 sidecar |

---

### Phase 5: MCP + Plugin（Week 11-13，与 P4 尾段并行）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 5.1 | `crates/mcp` — MCP client (stdio + SSE transport) | backend-eng (Rust-B) | P4 | 连接 3+ MCP server 成功 |
| 5.2 | MCP OAuth flow | backend-eng (Rust-A) | 5.1 | 认证流程与现有行为一致 |
| 5.3 | `crates/plugin` — 动态加载 + sandbox | backend-eng (Rust-B) | P4 | WASI sandbox 执行示例插件 |
| 5.4 | Skill registry 移植 | backend-eng (Rust-A) | 5.3 | skill 发现 + 调用通过 |

---

### Phase 6: 集成切换（Week 14-15）

| # | 工作项 | 主责 | 依赖 | 验收标准 |
|---|--------|------|------|----------|
| 6.1 | Feature flag 全量切换到 Rust | backend-eng (TS) | P5 | 所有 flag = on |
| 6.2 | TS legacy 代码删除 | backend-eng (TS) | 6.1 | dead code 清除，CI 绿 |
| 6.3 | E2E 全量回归 (5 平台) | qa-engineer | 6.1 | 全绿 |
| 6.4 | 性能 benchmark 报告 | qa-engineer | 6.3 | 冷启动 <50ms, RSS <15MB |
| 6.5 | Release binary 构建 + 安装脚本 | devops-engineer | 6.2 | `curl \| sh` 安装验证 |
| 6.6 | 文档更新 + 贡献者指南 | tech-lead | 6.5 | CONTRIBUTING.md Rust 部分 |

---

## 角色分工

| 角色 | 人员 | 主要交付 |
|------|------|----------|
| tech-lead | 1 | 架构决策、design review、phase sign-off |
| architect | 1 | 协议设计、crate 拆分、Message schema |
| backend-eng (Rust-A) | 1 | PTY/Shell → LLM(Anthropic/OpenAI) → Session → MCP OAuth |
| backend-eng (Rust-B) | 1 | File/Git/Search → LLM(其余 provider) → Agent → Plugin |
| backend-eng (TS) | 1 | thin client、feature flag、legacy 清除 |
| qa-engineer | 1 | benchmark、shadow-mode、E2E、跨平台验证 |
| devops-engineer | 1 | CI、cross-compile、release pipeline |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 | Owner |
|------|------|------|------|-------|
| IPC 协议 P99 不达标 | 中 | 高 | Phase 0 benchmark 验证，不达标则切 gRPC | architect |
| 上游 TS drift 导致 Rust 追赶 | 高 | 中 | weekly drift audit + 15% 阈值触发 re-estimation | tech-lead |
| Rust 工程师离职 (bus factor) | 低 | 极高 | Phase 1-2 产出文档化 + pair review | tech-lead |
| Windows ConPTY edge case | 中 | 中 | Phase 1 优先 Windows CI 验证 | qa-engineer |
| rustls 不满足特定企业需求 | 低 | 低 | Out of Scope，企业版后续扩展 | tech-lead |
| MCP 协议 spec 变更 | 中 | 中 | Phase 5 锁定 spec 版本 | architect |

---

## 检查节点

| 时间 | 检查 | 通过标准 | 升级条件 |
|------|------|----------|----------|
| Week 2 末 | Phase 0 Design Review | 协议 spec + benchmark 通过 | IPC P99 不达标 |
| Week 5 末 | Phase 1+2 Sign-off | 全部 tool 测试绿 + 性能达标 | 任何 tool 功能回归 |
| Week 9 末 | Phase 3 Shadow-mode | Rust vs TS diff = 0 | LLM 行为不一致 |
| Week 12 末 | Phase 4 Integration | E2E 通过 | Session 状态机异常 |
| Week 13 末 | Phase 5 Complete | MCP + Plugin 功能通过 | MCP 连接失败 |
| Week 15 末 | GA Sign-off | 5 平台全绿 + benchmark 达标 | 任何 P0 指标未达 |

---

## 技能装配清单

| 层级 | 技能 | 触发原因 | 主责角色 |
|------|------|----------|----------|
| shared | `rust-patterns` | Rust 实现全程 | backend-eng (Rust) |
| shared | `api-design` | IPC 协议设计 | architect |
| shared | `tdd-workflow` | Phase 1-2 TDD | backend-eng (Rust) |
| shared | `deployment-patterns` | 交叉编译 + release | devops-engineer |
| ECC | `coding-standards` | 代码质量基线 | all |
| ECC | `security-review` | TLS 选型、sandbox | architect |

---

## ADR 需求

需要产出 1 篇 ADR：

**ADR-001: IPC 协议选型 — 控制面 JSON-RPC + 数据面 MsgPack**

- 背景：LLM streaming 高频事件 vs 控制面低频调用
- 备选：纯 JSON-RPC / 纯 gRPC / Cap'n Proto / 混合方案
- 决策：混合方案（Phase 0 benchmark 验证后确认）
- 影响：所有 Phase 的 sidecar 通信

---

## Implementation Readiness 结论

| 维度 | 状态 | 说明 |
|------|------|------|
| 需求挑战会 | ✅ 完成 | 6 条质疑全部收敛 |
| Design Review | ⏳ 待 Phase 0 | 协议 spec 完成后执行 |
| 接口契约 | ⏳ 待 Phase 0.1 | IPC proto 定义 |
| 测试策略 | ✅ 定义完成 | shadow-mode + benchmark + E2E |
| 风险可控 | ✅ | 无 CRITICAL 未缓解风险 |
| 资源就绪 | ⏳ | 需确认 2 Rust 工程师到位 |

**就绪状态**: `ready-for-review` — Phase 0 可立即启动，Design Review 在 Week 2 末完成后升级为 `handoff-ready`。

---

## 下一步

1. → 产出 `arch-design.md`，锁定 crate 拆分和数据流
2. → 产出 `ADR-001-ipc-protocol.md`
3. → 启动 Phase 0 执行（`/team-execute`）
