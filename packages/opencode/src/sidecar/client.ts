/**
 * Sidecar RPC Client
 *
 * Thin client that sends JSON-RPC requests to the Rust sidecar
 * and decodes responses. Handles frame encoding/decoding.
 */

import * as net from "net"
import { FRAME_JSONRPC, FRAME_MSGPACK, FRAME_SHUTDOWN, encodeFrame } from "./index"

export interface RpcResponse<T = unknown> {
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

export class SidecarClient {
  private socket: net.Socket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private buffer = Buffer.alloc(0)

  constructor(socket: net.Socket) {
    this.socket = socket
    this.socket.on("data", (data: Buffer) => this.onData(data))
    this.socket.on("error", (err) => {
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(err)
      }
      this.pending.clear()
    })
  }

  private onData(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data])
    this.processBuffer()
  }

  private processBuffer() {
    while (this.buffer.length >= 5) {
      const type = this.buffer.readUInt8(0)
      const len = this.buffer.readUInt32BE(1)

      if (this.buffer.length < 5 + len) break // incomplete frame

      const payload = this.buffer.subarray(5, 5 + len)
      this.buffer = this.buffer.subarray(5 + len)

      if (type === FRAME_JSONRPC) {
        const response = JSON.parse(payload.toString("utf-8"))
        const pending = this.pending.get(response.id)
        if (pending) {
          this.pending.delete(response.id)
          if (response.error) {
            pending.reject(new Error(`RPC error ${response.error.code}: ${response.error.message}`))
          } else {
            pending.resolve(response.result)
          }
        }
      }
      // FRAME_MSGPACK events would go to a stream handler (Phase 3)
    }
  }

  /**
   * Send a JSON-RPC request and wait for the response
   */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    const request = { jsonrpc: "2.0", id, method, params }
    const payload = Buffer.from(JSON.stringify(request), "utf-8")
    const frame = encodeFrame(FRAME_JSONRPC, payload)

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.write(frame, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  /**
   * Perform the initialize handshake
   */
  async initialize(): Promise<{ version: string; capabilities: string[] }> {
    return this.call("initialize", { version: "0.1.0", capabilities: ["tools", "pty"] })
  }

  /**
   * Send shutdown and close connection
   */
  async shutdown(): Promise<void> {
    const frame = encodeFrame(FRAME_SHUTDOWN, Buffer.alloc(0))
    this.socket.write(frame)
    this.socket.end()
  }

  // --- PTY Methods ---

  async ptySpawn(params: {
    command: string
    args?: string[]
    cwd?: string
    env?: Array<[string, string]>
    cols?: number
    rows?: number
  }): Promise<{ id: string }> {
    return this.call("pty.spawn", {
      command: params.command,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env,
      cols: params.cols ?? 80,
      rows: params.rows ?? 24,
    })
  }

  async ptyWrite(id: string, data: string): Promise<void> {
    await this.call("pty.write", { id, data })
  }

  async ptyResize(id: string, cols: number, rows: number): Promise<void> {
    await this.call("pty.resize", { id, cols, rows })
  }

  async ptyKill(id: string): Promise<void> {
    await this.call("pty.kill", { id })
  }

  // --- Shell Methods ---

  async shellExec(params: {
    command: string
    cwd?: string
    timeout_ms?: number
    env?: Array<[string, string]>
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.call("tools.shell.exec", params)
  }
}
