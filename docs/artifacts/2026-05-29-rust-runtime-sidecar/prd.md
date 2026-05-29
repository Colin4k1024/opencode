# PRD: OpenCode Agent 后端核心替换为 Rust Runtime

| 字段 | 值 |
|------|-----|
| slug | rust-runtime-sidecar |
| 日期 | 2026-05-29 |
| 状态 | draft |
| 阶段 | intake |
| 主责 | tech-lead |

---

## 背景

OpenCode 当前核心后端（agent/session/tool/mcp/pty/bus/provider）共 ~21,000 行 TypeScript，78 个文件，深度依赖 Effect TS（276 处 import）。运行时为 Bun，分发需捆绑 Node/Bun 运行环境。

### 触发原因

1. CLI 冷启动 ~200-400ms，用户体感慢
2. Session 常驻内存 30-50MB，多实例场景资源压力大
3. 并发 tool 执行（shell/file）受 JS 单线程 + N-API 开销限制
4. 二进制分发依赖 Bun runtime，安装步骤多、体积大
5. PTY 管理经过 N-API 桥接，偶发稳定性问题（见 #29828）

### 当前约束

- 前端层（TUI SolidJS / Desktop Electron / VS Code Extension）不能中断
- OpenCode 迭代极快（近 30k commits），不能长时间 feature freeze
- 社区贡献者以 TypeScript 为主

---

## 目标与成功标准

| 目标 | 成功标准 | 优先级 |
|------|----------|--------|
| 冷启动加速 | CLI 启动 < 50ms (p95) | P0 |
| 内存降低 | Session 常驻 < 15MB | P0 |
| 并发吞吐提升 | 并发 tool 执行吞吐 ≥ 当前 2x | P1 |
| 单文件分发 | 静态链接单文件，无运行时依赖 | P1 |
| 零前端中断 | TUI/Desktop/Extension 功能不退化 | P0 |
| 渐进迁移 | 每个 Phase 可独立交付、可回滚 | P0 |

---

## 用户故事

### US-1: 开发者快速启动
> 作为开发者，我希望运行 `opencode` 后在 50ms 内进入交互，不再等待 JS runtime 初始化。

验收标准：
- macOS/Linux x86_64 冷启动 p95 < 50ms
- Windows p95 < 100ms

### US-2: 低资源占用
> 作为在资源受限环境（CI、Codespace、远程 SSH）中使用 opencode 的用户，我希望单 session 内存占用 < 15MB。

验收标准：
- idle session RSS < 15MB
- 10 并发 tool 执行峰值 < 80MB

### US-3: 简单安装
> 作为用户，我希望通过 `curl | sh` 下载单个二进制文件即可使用，无需预装 Node/Bun。

验收标准：
- 单文件静态链接，支持 linux-x64、linux-arm64、darwin-x64、darwin-arm64、windows-x64
- 压缩后 < 30MB

### US-4: 前端无感知
> 作为 TUI/Desktop/Extension 用户，我不应感知到后端从 TS 切换为 Rust。

验收标准：
- 全部 E2E 测试通过
- IPC 协议向后兼容

---

## 范围

### In Scope

- Rust sidecar 进程 + JSON-RPC over Unix socket 协议设计
- Phase 0-6 渐进迁移（PTY → File/Git → LLM → Session/Agent → MCP/Plugin → 集成）
- TS thin client 适配层
- 跨平台交叉编译 CI
- 性能基准测试 suite
- Feature flag 控制新旧路径切换

### Out of Scope

- TUI/Desktop/Extension UI 代码重写
- Web/Docs 站点变更
- 新功能开发（仅迁移现有行为）
- Effect TS 上层编排层短期内不迁移（保留到 Phase 4）

---

## 技术方案概要（方案 C: Rust Sidecar）

```
┌─────────────────────────────────────────────┐
│  Client Layer (不变)                         │
│  CLI / TUI / Desktop / Extension            │
└──────────────────┬──────────────────────────┘
                   │ (进程内调用 → thin client RPC)
┌──────────────────▼──────────────────────────┐
│  TS Orchestration Layer (渐进收缩)           │
│  Session coordinator / Config / Bus         │
└──────────────────┬──────────────────────────┘
                   │ JSON-RPC over Unix socket
┌──────────────────▼──────────────────────────┐
│  Rust Runtime Sidecar                       │
│  ┌─────┐ ┌──────┐ ┌─────┐ ┌─────┐ ┌─────┐ │
│  │ PTY │ │Tools │ │ LLM │ │Sess │ │ MCP │ │
│  └─────┘ └──────┘ └─────┘ └─────┘ └─────┘ │
│  tokio runtime / rusqlite / serde           │
└─────────────────────────────────────────────┘
```

---

## 分 Phase 节奏

| Phase | 内容 | 时长 | 前置依赖 | 交付物 |
|-------|------|------|----------|--------|
| 0 | 协议定义 + Rust workspace 骨架 + CI | 2 周 | — | `crates/` 目录、proto 定义、CI pipeline |
| 1 | PTY + Shell 模块 | 3 周 | Phase 0 | `crates/pty`、`crates/tools/shell`、TS thin client |
| 2 | File/Git/Glob/Grep 工具层 | 3 周 | Phase 0（可与 P1 并行） | `crates/tools/{file,git,search}` |
| 3 | LLM Streaming 层 | 4 周 | Phase 1+2 | `crates/llm`、多 provider 支持 |
| 4 | Session + Agent 编排 | 4 周 | Phase 3 | `crates/session`、`crates/agent` |
| 5 | MCP + Plugin | 3 周 | Phase 4（可与 P4 尾段并行） | `crates/mcp`、`crates/plugin` |
| 6 | 集成切换 + 全量验证 | 2 周 | Phase 5 | feature flag、E2E 通过、benchmark 报告 |

**总计：16-19 周（4-5 个月），2 名 Rust 工程师并行**

---

## 风险与依赖

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| Effect TS 模式无直接 Rust 等价物 | CRITICAL | 用 tower Service + thiserror + tokio channels 替代 DI/Stream/Error |
| Vercel AI SDK 无 Rust port | HIGH | 手写 reqwest + SSE parser，对齐各 provider 协议差异 |
| MCP 协议重实现工作量 | HIGH | 复用 `mcp-rs` 社区 crate，补齐 OAuth flow |
| IPC 协议设计失误导致返工 | HIGH | Phase 0 产出 proto 后进行 design review + 压测 |
| 上游 TS 层持续变化导致 Rust 侧追赶 | MEDIUM | feature flag 隔离，新旧路径可共存 |
| 团队 Rust 经验不足 | MEDIUM | Phase 1 作为 ramp-up，选择最简单模块入手 |

---

## 待确认项

1. [ ] JSON-RPC vs gRPC vs Cap'n Proto — 最终协议选型需 design review
2. [ ] Rust sidecar 生命周期管理 — 谁启动/停止/重启 sidecar？
3. [ ] SQLite 数据库文件共享 — TS 和 Rust 是否同时访问同一 db？锁策略？
4. [ ] Windows named pipe vs Unix socket — 跨平台 IPC 策略
5. [ ] 是否保留 TS 作为 fallback 路径（双引擎模式）直到 GA？
6. [ ] 社区贡献者 onboarding — Rust 部分的贡献门槛如何降低？

---

## 企业治理待确认项

- 非企业内部应用，无应用等级 / 数据合规限制
- 开源项目，MIT License，无 private enterprise overlay 需求

---

## 领域技能包启用建议

| 技能 | 用途 |
|------|------|
| `rust-patterns` | Rust 惯用法、错误处理、并发模式 |
| `golang-patterns` (参考) | 类似 sidecar 架构的参考实现 |
| `api-design` | JSON-RPC 协议设计 |
| `tdd-workflow` | Phase 1-2 TDD 驱动开发 |
| `deployment-patterns` | 交叉编译 + 单文件分发 |

---

## UI 范围

**无 UI 变更** — 本次迁移仅涉及后端 runtime 层，前端 TUI/Desktop/Extension 保持不变。IPC 协议变更对 UI 层透明。

---

## 参与角色

| 角色 | 职责 |
|------|------|
| `tech-lead` | 整体架构决策、Phase 节奏把控、协议设计 review |
| `architect` | IPC 协议设计、crate 拆分、数据流规划 |
| `backend-engineer` (×2 Rust) | Rust 实现、基准测试、交叉编译 |
| `backend-engineer` (×1 TS) | TS thin client 适配、feature flag、兼容性维护 |
| `qa-engineer` | E2E 回归、性能基准、跨平台验证 |
| `devops-engineer` | CI pipeline、交叉编译、release 分发 |

---

## 需求挑战会候选分组

### 分组 1: 协议与架构（Phase 0 前必须收敛）
- tech-lead + architect + backend-engineer
- 议题：IPC 协议选型、sidecar 生命周期、SQLite 共享策略、Windows 适配

### 分组 2: LLM 层迁移可行性（Phase 3 前）
- architect + backend-engineer (Rust)
- 议题：多 provider SSE streaming 在 Rust 中的实现路径、AI SDK 功能覆盖度

### 分组 3: 社区与兼容性（Phase 6 前）
- tech-lead + devops-engineer
- 议题：双引擎共存策略、贡献者门槛、release 策略

---

## 下一步

→ 进入 `/team-plan` 产出 Delivery Plan，锁定 Phase 0 具体任务拆解和 design review 时间。
