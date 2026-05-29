/**
 * Sidecar Lifecycle Manager
 *
 * Responsible for spawning, monitoring, and restarting the Rust sidecar process.
 * The sidecar communicates via Unix socket (Linux/macOS) or Named Pipe (Windows).
 */

import { Effect, Context, Layer } from "effect"
import { spawn, type ChildProcess } from "child_process"
import * as path from "path"
import * as fs from "fs"
import * as net from "net"

export interface SidecarConfig {
  /** Path to the sidecar binary */
  binaryPath: string
  /** Max restart attempts */
  maxRetries: number
  /** Restart delay in ms */
  restartDelay: number
  /** Handshake timeout in ms */
  handshakeTimeout: number
}

export const DEFAULT_CONFIG: SidecarConfig = {
  binaryPath: getSidecarBinaryPath(),
  maxRetries: 3,
  restartDelay: 1000,
  handshakeTimeout: 5000,
}

export type SidecarStatus = "stopped" | "starting" | "ready" | "error"

export interface SidecarState {
  status: SidecarStatus
  socketPath: string | null
  process: ChildProcess | null
  retryCount: number
}

/**
 * Determine the sidecar binary path based on platform and architecture
 */
function getSidecarBinaryPath(): string {
  const platform = process.platform
  const arch = process.arch

  const binaryName = platform === "win32" ? "opencode-sidecar.exe" : "opencode-sidecar"

  // Look in several locations:
  // 1. Next to the current executable
  // 2. In the crates/target/release directory (dev)
  // 3. In a platform-specific subdirectory
  const candidates = [
    path.join(__dirname, "..", "..", "..", "crates", "target", "release", binaryName),
    path.join(__dirname, "..", binaryName),
    path.join(process.cwd(), binaryName),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  // Fallback: assume it's in PATH
  return binaryName
}

/**
 * Spawn the Rust sidecar process and wait for it to be ready
 */
export async function spawnSidecar(config: SidecarConfig = DEFAULT_CONFIG): Promise<{
  process: ChildProcess
  socketPath: string
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RUST_LOG: process.env.OPENCODE_SIDECAR_LOG || "info",
      },
    })

    let socketPath = ""
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        reject(new Error(`Sidecar handshake timeout after ${config.handshakeTimeout}ms`))
      }
    }, config.handshakeTimeout)

    // First line of stdout is the socket path
    proc.stdout?.once("data", (data: Buffer) => {
      socketPath = data.toString().trim()
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        resolve({ process: proc, socketPath })
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        reject(new Error(`Failed to spawn sidecar: ${err.message}`))
      }
    })

    proc.on("exit", (code) => {
      if (!resolved) {
        clearTimeout(timeout)
        resolved = true
        reject(new Error(`Sidecar exited with code ${code} before ready`))
      }
    })
  })
}

/**
 * Connect to the sidecar's Unix socket and perform handshake
 */
export async function connectToSidecar(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      resolve(socket)
    })
    socket.on("error", (err) => {
      reject(new Error(`Failed to connect to sidecar: ${err.message}`))
    })
  })
}

/**
 * Send a JSON-RPC request to the sidecar via the framed protocol
 */
export function encodeFrame(type: number, payload: Buffer): Buffer {
  const frame = Buffer.alloc(5 + payload.length)
  frame.writeUInt8(type, 0)
  frame.writeUInt32BE(payload.length, 1)
  payload.copy(frame, 5)
  return frame
}

export const FRAME_JSONRPC = 0x01
export const FRAME_MSGPACK = 0x02
export const FRAME_HEARTBEAT = 0x03
export const FRAME_SHUTDOWN = 0xff

/**
 * Gracefully shutdown the sidecar
 */
export async function shutdownSidecar(socket: net.Socket, proc: ChildProcess): Promise<void> {
  // Send shutdown frame
  const frame = encodeFrame(FRAME_SHUTDOWN, Buffer.alloc(0))
  socket.write(frame)

  // Wait for graceful exit (5s)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL")
      resolve()
    }, 5000)

    proc.on("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
