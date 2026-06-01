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

  // --- File Methods ---

  async fileRead(params: {
    path: string
    offset?: number
    limit?: number
  }): Promise<{ content: string; total_lines: number }> {
    return this.call("tools.file.read", params)
  }

  async fileWrite(params: {
    path: string
    content: string
  }): Promise<{ bytes_written: number }> {
    return this.call("tools.file.write", params)
  }

  async fileEdit(params: {
    path: string
    old_string: string
    new_string: string
    replace_all?: boolean
  }): Promise<{ replacements: number }> {
    return this.call("tools.file.edit", params)
  }

  // --- Search Methods ---

  async glob(params: {
    pattern: string
    path?: string
  }): Promise<{ files: string[] }> {
    return this.call("tools.glob", params)
  }

  async grep(params: {
    pattern: string
    path?: string
    context?: number
    max_results?: number
  }): Promise<{ matches: Array<{ file: string; line: number; content: string }> }> {
    return this.call("tools.grep", params)
  }

  // --- Git Methods ---

  async gitStatus(cwd: string): Promise<Array<{ path: string; status: string }>> {
    return this.call("tools.git.status", { cwd })
  }

  async gitLog(params: {
    cwd: string
    max_count?: number
    since?: string
  }): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
    return this.call("tools.git.log", params)
  }

  async gitDiff(params: {
    cwd: string
    from?: string
    to?: string
  }): Promise<{ diff: string }> {
    return this.call("tools.git.diff", params)
  }

  // --- Session Methods ---

  async sessionCreate(params: {
    slug?: string
    project_id?: string
    directory?: string
    title?: string
    parent_id?: string
  }): Promise<Session> {
    return this.call("session.create", params)
  }

  async sessionGet(id: string): Promise<Session> {
    return this.call("session.get", { id })
  }

  async sessionList(): Promise<{ sessions: Session[] }> {
    return this.call("session.list")
  }

  async sessionUpdateTitle(id: string, title: string): Promise<void> {
    await this.call("session.update_title", { id, title })
  }

  async sessionDelete(id: string): Promise<void> {
    await this.call("session.delete", { id })
  }

  async sessionAppendMessage(params: {
    session_id: string
    role: "user" | "assistant" | "tool"
    content: string
    metadata?: string
  }): Promise<Part> {
    return this.call("session.append_message", params)
  }

  async sessionGetMessages(session_id: string): Promise<{ messages: Part[] }> {
    return this.call("session.get_messages", { session_id })
  }

  // --- Agent Methods ---

  async agentList(): Promise<{ agents: AgentInfo[] }> {
    return this.call("agent.list")
  }

  async agentGet(name: string): Promise<AgentInfo> {
    return this.call("agent.get", { name })
  }

  // --- MCP Methods ---

  async mcpConnect(config: {
    name: string
    transport: "stdio" | "sse"
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
  }): Promise<{ name: string; server_info: McpServerInfo }> {
    return this.call("mcp.connect", config)
  }

  async mcpListTools(name: string): Promise<{ tools: McpToolInfo[] }> {
    return this.call("mcp.list_tools", { name })
  }

  async mcpCallTool(params: {
    name: string
    tool: string
    params?: Record<string, unknown>
  }): Promise<unknown> {
    return this.call("mcp.call_tool", params)
  }

  async mcpDisconnect(name: string): Promise<void> {
    await this.call("mcp.disconnect", { name })
  }

  async mcpList(): Promise<{ servers: string[] }> {
    return this.call("mcp.list")
  }

  // --- LLM Streaming Methods ---

  /**
   * Start an LLM generation stream.
   * Returns `{stream_id}`. Events arrive as FRAME_MSGPACK frames via the
   * `onStreamEvent` callback registered on the client.
   */
  async llmStream(params: LlmStreamParams): Promise<{ stream_id: string }> {
    return this.call("llm.stream", params as unknown as Record<string, unknown>)
  }

  /** Cancel a running stream. Returns `{cancelled: boolean}`. */
  async llmCancel(stream_id: string): Promise<{ cancelled: boolean }> {
    return this.call("llm.cancel", { stream_id })
  }

  // --- Plugin Methods ---

  async pluginList(): Promise<{ plugins: PluginInfo[] }> {
    return this.call("plugin.list")
  }

  async pluginGet(name: string): Promise<PluginInfo> {
    return this.call("plugin.get", { name })
  }
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Session {
  id: string
  slug: string
  project_id: string
  directory: string
  title: string
  parent_id?: string
  created_at: string
  updated_at: string
}

export interface Part {
  id: string
  session_id: string
  role: string
  content: string
  metadata?: string
  seq: number
  created_at: string
}

export interface AgentInfo {
  name: string
  description: string
  mode: "Primary" | "Subagent"
}

export interface McpServerInfo {
  name: string
  version: string
}

export interface McpToolInfo {
  name: string
  description?: string
  input_schema?: unknown
}

export interface PluginInfo {
  name: string
  version: string
  description: string
  entry_point: string
  permissions: string[]
}

export interface LlmStreamParams {
  provider: "anthropic" | "open-ai" | "google" | "amazon-bedrock" | "azure" | "deep-seek" | "x-ai" | "ollama" | "open-ai-compatible"
  model: string
  messages: Array<{ role: string; content: string }>
  system?: string
  api_key?: string
  base_url?: string
  max_tokens?: number
  temperature?: number
  top_p?: number
}

export type StreamEvent =
  | { type: "token"; data: { text: string }; stream_id: string; seq: number }
  | { type: "tool_call_start"; data: { id: string; name: string }; stream_id: string; seq: number }
  | { type: "tool_call_delta"; data: { id: string; args_delta: string }; stream_id: string; seq: number }
  | { type: "tool_call_end"; data: { id: string }; stream_id: string; seq: number }
  | { type: "tool_result"; data: { id: string; result: unknown }; stream_id: string; seq: number }
  | { type: "usage"; data: { input_tokens: number; output_tokens: number; cache_read?: number; cache_write?: number }; stream_id: string; seq: number }
  | { type: "error"; data: { code: number; message: string }; stream_id: string; seq: number }
  | { type: "done"; data: { finish_reason: string }; stream_id: string; seq: number }
