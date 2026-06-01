/**
 * Test fixture for the Rust sidecar integration tests.
 *
 * Builds the binary path, spawns the sidecar process, connects to its
 * Unix socket, and wraps everything in an async-disposable so tests are
 * guaranteed to clean up even on failure.
 */

import * as net from "net"
import * as path from "path"
import * as fs from "fs"
import type { ChildProcess } from "child_process"
import { spawnSidecar, connectToSidecar, type SidecarConfig } from "@/sidecar/index"
import { SidecarClient } from "@/sidecar/client"

// ── Binary path ───────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const BINARY_NAME = process.platform === "win32" ? "opencode-sidecar.exe" : "opencode-sidecar"
const SIDECAR_RELEASE = path.join(REPO_ROOT, "crates", "target", "release", BINARY_NAME)
const SIDECAR_DEBUG   = path.join(REPO_ROOT, "crates", "target", "debug",   BINARY_NAME)

export function getSidecarBinaryPath(): string {
  // Prefer the release binary — it starts faster and produces less noise in
  // parallel test runs. Fall back to debug if no release build exists yet.
  if (fs.existsSync(SIDECAR_RELEASE)) return SIDECAR_RELEASE
  if (fs.existsSync(SIDECAR_DEBUG))   return SIDECAR_DEBUG
  throw new Error(
    `Rust sidecar binary not found.\n` +
      `Expected: ${SIDECAR_RELEASE}\n` +
      `Run: cargo build --release -p opencode-runtime`,
  )
}

// ── Sidecar test context ──────────────────────────────────────────────────────

export interface SidecarContext {
  client: SidecarClient
  socket: net.Socket
  process: ChildProcess
  socketPath: string
  [Symbol.asyncDispose](): Promise<void>
}

/**
 * Spawn the real sidecar binary, connect, and perform the initialize handshake.
 * Returns an async-disposable context that kills the process on cleanup.
 */
export async function withSidecar(): Promise<SidecarContext> {
  const config: SidecarConfig = {
    binaryPath: getSidecarBinaryPath(),
    maxRetries: 0,
    restartDelay: 0,
    handshakeTimeout: 10_000,
  }

  const { process: proc, socketPath } = await spawnSidecar(config)

  // Retry connecting: under parallel test load many sidecar processes start
  // simultaneously and the OS may delay socket readiness. Retry for up to 5 s.
  let socket: import("net").Socket | undefined
  const retryDelay = 100
  const retryMax = 50 // 50 × 100 ms = 5 s total budget
  for (let i = 0; i < retryMax; i++) {
    try {
      socket = await connectToSidecar(socketPath)
      break
    } catch {
      await new Promise((r) => setTimeout(r, retryDelay))
    }
  }
  if (!socket) {
    proc.kill("SIGKILL")
    throw new Error(`Could not connect to sidecar socket at ${socketPath} after ${retryMax * retryDelay}ms`)
  }
  const client = new SidecarClient(socket)

  // Perform the initialize handshake
  await client.initialize()

  return {
    client,
    socket,
    process: proc,
    socketPath,
    async [Symbol.asyncDispose]() {
      try {
        await client.shutdown()
      } catch {
        // ignore — process may already be dead
      }
      if (!proc.killed) proc.kill("SIGKILL")
      try {
        fs.unlinkSync(socketPath)
      } catch {
        // ignore
      }
    },
  }
}
