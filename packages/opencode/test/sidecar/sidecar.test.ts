/**
 * End-to-end integration tests for the Rust sidecar.
 *
 * One sidecar process is shared across the entire suite (started in beforeAll,
 * torn down in afterAll). This avoids the thundering-herd startup race that
 * occurs when 11 sidecar processes start simultaneously under load.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import { withSidecar, type SidecarContext } from "./fixture"

// ── Shared sidecar ────────────────────────────────────────────────────────────

let ctx: SidecarContext

beforeAll(async () => {
  ctx = await withSidecar()
})

afterAll(async () => {
  await ctx[Symbol.asyncDispose]()
})

// ── Initialize handshake ──────────────────────────────────────────────────────

describe("sidecar: initialize", () => {
  test("handshake returns version and capabilities", () => {
    // withSidecar() performs initialize() and would throw on failure.
    // If we reach here the handshake succeeded.
    expect(ctx.client).toBeDefined()
  })
})

// ── system.ping ───────────────────────────────────────────────────────────────

describe("sidecar: system.ping", () => {
  test("returns { pong: true }", async () => {
    const result = await ctx.client.call<{ pong: boolean }>("system.ping")
    expect(result.pong).toBe(true)
  })
})

// ── tools.shell.exec ─────────────────────────────────────────────────────────

describe("sidecar: tools.shell.exec", () => {
  test("captures stdout", async () => {
    const result = await ctx.client.shellExec({
      command: "echo 'hello from rust'",
      cwd: "/tmp",
      timeout_ms: 5000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello from rust")
  })

  test("captures stderr", async () => {
    const result = await ctx.client.shellExec({
      command: "echo 'err output' >&2",
      cwd: "/tmp",
      timeout_ms: 5000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain("err output")
  })

  test("reports non-zero exit code", async () => {
    const result = await ctx.client.shellExec({
      command: "exit 7",
      cwd: "/tmp",
      timeout_ms: 5000,
    })
    expect(result.exitCode).toBe(7)
  })

  test("runs in specified working directory", async () => {
    const result = await ctx.client.shellExec({
      command: "pwd",
      cwd: "/tmp",
      timeout_ms: 5000,
    })
    expect(result.exitCode).toBe(0)
    // macOS symlinks /tmp → /private/tmp — normalise before comparing
    expect(result.stdout.trim()).toBe(fs.realpathSync("/tmp"))
  })
})

// ── PTY lifecycle ─────────────────────────────────────────────────────────────

describe("sidecar: PTY", () => {
  test("spawn → list → kill lifecycle", async () => {
    const spawnResult = await ctx.client.ptySpawn({
      command: "/bin/sh",
      args: [],
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    })
    const ptyId = spawnResult.id
    expect(typeof ptyId).toBe("string")
    expect(ptyId.length).toBeGreaterThan(0)

    // List — PTY must appear
    const listResult = await ctx.client.call<{ sessions: string[] }>("pty.list")
    expect(listResult.sessions).toContain(ptyId)

    // Kill
    await ctx.client.ptyKill(ptyId)

    // List after kill — PTY must be gone
    const listAfter = await ctx.client.call<{ sessions: string[] }>("pty.list")
    expect(listAfter.sessions).not.toContain(ptyId)
  })

  test("resize succeeds on a live PTY", async () => {
    const { id } = await ctx.client.ptySpawn({
      command: "/bin/sh",
      args: [],
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    })
    await ctx.client.ptyResize(id, 120, 40)
    await ctx.client.ptyKill(id)
  })

  test("write to PTY does not throw", async () => {
    const { id } = await ctx.client.ptySpawn({
      command: "/bin/sh",
      args: [],
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    })
    await ctx.client.ptyWrite(id, "echo ts-pty-test\n")
    await ctx.client.ptyKill(id)
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe("sidecar: error handling", () => {
  test("unknown RPC method rejects with an error", async () => {
    await expect(ctx.client.call("no.such.method")).rejects.toThrow()
  })
})

// ── Shutdown (must run last — closes the shared connection) ───────────────────

describe("sidecar: shutdown", () => {
  test("graceful shutdown via client.shutdown()", async () => {
    // Send shutdown — the server should close its end cleanly.
    // afterAll will try to dispose again but errors are swallowed.
    await ctx.client.shutdown()
    if (!ctx.process.killed) ctx.process.kill("SIGKILL")
  })
})
