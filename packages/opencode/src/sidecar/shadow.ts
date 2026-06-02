/**
 * Shadow-mode comparison for sidecar operations.
 *
 * When OPENCODE_RUST_SHADOW=1, a background sidecar process is started
 * and comparison calls are logged. This module provides utility functions
 * that can be called from tool implementations to fire background comparisons.
 *
 * Usage: Shadow mode does NOT modify the Effect service graph. Instead,
 * tool code calls `shadowCompareGlob()` / `shadowCompareGrep()` after
 * getting native results, and discrepancies are logged.
 */

import * as Log from "@opencode-ai/core/util/log"
import type { SidecarClient } from "./client"

const log = Log.create({ service: "sidecar-shadow" })

export function isShadowEnabled(): boolean {
  const v = process.env["OPENCODE_RUST_SHADOW"]?.toLowerCase()
  return v === "true" || v === "1"
}

// ── Lazy sidecar connection ──────────────────────────────────────────────────

let _client: SidecarClient | null = null
let _attempted = false
let _proc: import("child_process").ChildProcess | null = null

async function getClient(): Promise<SidecarClient | null> {
  if (_attempted) return _client
  _attempted = true
  try {
    const { spawnSidecar, connectToSidecar } = await import("./index")
    const { SidecarClient } = await import("./client")
    const { process: proc, socketPath } = await spawnSidecar()
    _proc = proc
    const socket = await connectToSidecar(socketPath)
    const client = new SidecarClient(socket)
    await client.initialize()
    _client = client
    log.info("shadow mode: sidecar connected", { socketPath })
  } catch (e) {
    log.warn("shadow mode: sidecar not available", { error: String(e) })
  }
  return _client
}

/**
 * Shut down the shadow sidecar process (call at app exit).
 */
export async function shutdownShadow(): Promise<void> {
  if (_client) {
    try {
      await _client.shutdown()
    } catch {}
  }
  if (_proc && !_proc.killed) {
    _proc.kill("SIGKILL")
  }
}

// ── Comparison functions ─────────────────────────────────────────────────────

/**
 * Fire a background glob comparison. Does not block.
 * Call after native glob returns results.
 */
export function shadowCompareGlob(params: {
  pattern: string
  cwd: string
  nativeCount: number
}): void {
  if (!isShadowEnabled()) return

  getClient()
    .then((client) => {
      if (!client) return
      return client.glob({ pattern: params.pattern, path: params.cwd })
    })
    .then((result) => {
      if (!result) return
      const diff = Math.abs(result.files.length - params.nativeCount)
      if (diff === 0) {
        log.info("shadow [glob] match", {
          pattern: params.pattern,
          count: params.nativeCount,
        })
      } else {
        log.warn("shadow [glob] MISMATCH", {
          pattern: params.pattern,
          cwd: params.cwd,
          native: params.nativeCount,
          sidecar: result.files.length,
          diff,
        })
      }
    })
    .catch((e) => {
      log.warn("shadow [glob] error", { error: String(e) })
    })
}

/**
 * Fire a background grep comparison. Does not block.
 * Call after native grep returns results.
 */
export function shadowCompareGrep(params: {
  pattern: string
  cwd: string
  nativeCount: number
  limit?: number
}): void {
  if (!isShadowEnabled()) return

  getClient()
    .then((client) => {
      if (!client) return
      return client.grep({
        pattern: params.pattern,
        path: params.cwd,
        max_results: params.limit,
      })
    })
    .then((result) => {
      if (!result) return
      const diff = Math.abs(result.matches.length - params.nativeCount)
      if (diff === 0) {
        log.info("shadow [grep] match", {
          pattern: params.pattern,
          count: params.nativeCount,
        })
      } else {
        log.warn("shadow [grep] MISMATCH", {
          pattern: params.pattern,
          cwd: params.cwd,
          native: params.nativeCount,
          sidecar: result.matches.length,
          diff,
        })
      }
    })
    .catch((e) => {
      log.warn("shadow [grep] error", { error: String(e) })
    })
}
