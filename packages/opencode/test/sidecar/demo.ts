/**
 * Sidecar E2E demonstration — proves the Rust sidecar handles all RPC calls.
 * Run: bun run test/sidecar/demo.ts
 */
import { withSidecar } from "./fixture"

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║   OpenCode Rust Sidecar — End-to-End Verification       ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝\n`)

  const ctx = await withSidecar()
  const { client } = ctx
  console.log(`[✓] Sidecar spawned, PID=${ctx.process.pid}`)
  console.log(`[✓] Connected via socket: ${ctx.socketPath}`)
  console.log(`[✓] Initialize handshake complete\n`)

  const root = process.cwd().replace(/\/packages\/opencode$/, "")

  // system.ping
  const ping = await client.call<{ pong: boolean }>("system.ping")
  console.log(`[RPC] system.ping         → ${JSON.stringify(ping)}`)

  // tools.glob
  const glob = await client.glob({ pattern: "*.toml", path: root + "/crates" })
  console.log(`[RPC] tools.glob *.toml   → ${glob.files.length} files`)
  glob.files.forEach(f => console.log(`       ${f}`))

  // tools.grep
  const grep = await client.grep({ pattern: "opencode-runtime", path: root + "/crates", max_results: 5 })
  console.log(`[RPC] tools.grep          → ${grep.matches.length} matches`)
  grep.matches.slice(0, 3).forEach(m => console.log(`       ${m.file.split('/').slice(-2).join('/')}:${m.line} ${m.content.trim().slice(0, 50)}`))

  // tools.file.read
  const read = await client.fileRead({ path: root + "/crates/runtime/src/main.rs", limit: 5 })
  console.log(`[RPC] tools.file.read     → ${read.total_lines} total lines, showing first 3:`)
  read.content.split('\n').slice(0, 3).forEach(l => console.log(`       ${l}`))

  // tools.file.write + read back
  const testFile = "/tmp/sidecar-test-" + Date.now() + ".txt"
  await client.fileWrite({ path: testFile, content: "written by rust sidecar\n" })
  const readBack = await client.fileRead({ path: testFile })
  console.log(`[RPC] tools.file.write    → wrote ${testFile}`)
  console.log(`[RPC] tools.file.read     → "${readBack.content.trim()}"`)

  // tools.file.edit
  await client.fileEdit({ path: testFile, old_string: "rust sidecar", new_string: "RUST SIDECAR" })
  const edited = await client.fileRead({ path: testFile })
  console.log(`[RPC] tools.file.edit     → "${edited.content.trim()}"`)

  // tools.shell.exec
  const shell = await client.shellExec({ command: "echo RUST_SIDECAR_WORKS && uname -m", cwd: "/tmp", timeout_ms: 5000 })
  console.log(`[RPC] tools.shell.exec    → exit=${shell.exitCode}`)
  console.log(`       stdout: "${shell.stdout.trim()}"`)

  // tools.git.status
  const git = await client.gitStatus(root)
  console.log(`[RPC] tools.git.status    → ${git.length} changed files`)
  git.slice(0, 5).forEach(f => console.log(`       ${f.status} ${f.path}`))

  // tools.git.log
  const log = await client.gitLog({ cwd: root, max_count: 3 })
  console.log(`[RPC] tools.git.log       → ${log.length} commits`)
  log.forEach(c => console.log(`       ${c.hash.slice(0, 7)} ${c.message.slice(0, 50)}`))

  // process.run (direct execution, no shell)
  const proc = await client.processRun({ command: "git", args: ["--version"] })
  console.log(`[RPC] process.run         → exit=${proc.exitCode}, "${proc.stdout.trim()}"`)

  // pty.spawn + pty.kill
  const pty = await client.ptySpawn({ command: "/bin/sh", args: [], cwd: "/tmp", cols: 80, rows: 24 })
  console.log(`[RPC] pty.spawn           → id="${pty.id}"`)
  await client.ptyKill(pty.id)
  console.log(`[RPC] pty.kill            → OK`)

  // Cleanup
  const { unlinkSync } = require("fs")
  unlinkSync(testFile)

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║   ALL RPC CALLS SUCCESSFUL — RUST SIDECAR VERIFIED      ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝\n`)

  await ctx[Symbol.asyncDispose]()
}

main().catch(e => { console.error("FAILED:", e); process.exit(1) })
