# Execute Log: Phase 0 — Foundation

| 字段 | 值 |
|------|-----|
| slug | rust-runtime-sidecar |
| 日期 | 2026-05-29 |
| 阶段 | execute (Phase 0) |
| 主责 | backend-engineer |

---

## 计划 vs 实际

| 任务 | 计划 | 实际 | 偏差 |
|------|------|------|------|
| 0.1 IPC 协议 spec | 产出 PROTOCOL.md | ✅ 完成 | 无 |
| 0.2 Rust workspace 骨架 | 9 crates 编译通过 | ✅ 完成，`cargo check` 通过 | 无 |
| 0.3 CI pipeline | 5 平台交叉编译 workflow | ✅ 完成 | 无 |
| 0.4 Sidecar lifecycle manager | TS spawn/monitor/restart | ✅ 完成 | 无 |
| 0.5 SQLite 拆分方案 | 设计文档 + schema | ✅ 完成（设计阶段） | 代码层实施留到 Phase 4 |
| 0.6 Benchmark harness | criterion + hyperfine | ✅ 完成 | 无 |
| 0.7 Design review | 全组 review | ⏳ 待执行 | 需要团队到位 |
| 0.8 IPC benchmark 验证 | P99 < 1ms | ⏳ 待运行 | 依赖 0.7 |

---

## 关键决定

1. **协议采用混合方案**：控制面 JSON-RPC + 数据面 length-prefixed MsgPack，通过 1 字节 frame type 复用同一 socket
2. **Rust edition 2024**：使用最新稳定版，利用 async trait 等特性
3. **TLS 选型 rustls**：避免 OpenSSL 交叉编译复杂度，FIPS 场景 Out of Scope
4. **LLM sub-modules 为空 stub**：Phase 3 实现，骨架仅确保编译通过
5. **Sidecar lifecycle**：TS 作为父进程 spawn Rust 子进程，stdout 首行传递 socket path

---

## 影响面

| 模块 | 变更 |
|------|------|
| `crates/` (新增) | 完整 Rust workspace，9 crates |
| `.github/workflows/rust-sidecar.yml` (新增) | CI pipeline |
| `packages/opencode/src/sidecar/` (新增) | TS lifecycle manager |
| `docs/artifacts/` (新增) | PRD + delivery plan + arch design |
| `docs/adr/` (新增) | ADR-001 IPC 协议选型 |

---

## 未完成项

- [ ] 0.7 Protocol Design Review — 需要团队全员参加
- [ ] 0.8 IPC benchmark 实际运行并记录 baseline
- [ ] Rust sidecar 集成测试（spawn → handshake → ping → shutdown 全流程）
- [ ] `crates/Cargo.toml` 中 `[workspace.dependencies.criterion]` 残留需清理

---

## 自测结论

- `cargo check` 全 workspace 通过（仅 1 个 unused variable warning）
- CI workflow 语法正确（本地无法触发 GitHub Actions）
- TS sidecar manager 类型正确（未做运行时测试，需 Rust binary 配合）
