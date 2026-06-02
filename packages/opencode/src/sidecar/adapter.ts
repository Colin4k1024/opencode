/**
 * Sidecar Tool Adapter
 *
 * Provides tool-level operations routed through the Rust sidecar when
 * feature flags are enabled. Falls back to native TS implementations
 * when the sidecar is unavailable or flags are off.
 *
 * This module is the integration point between existing TS tool code
 * and the Rust sidecar backend. Individual tools import from here
 * to check whether they should delegate execution to the sidecar.
 */

import { Effect, Layer, Context } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { SidecarClient } from "./client"
import * as SidecarService from "./service"

const log = Log.create({ service: "sidecar-adapter" })

// ── Feature flag checks ──────────────────────────────────────────────────────

export function isToolsSidecarEnabled(): boolean {
  return Flag.OPENCODE_RUST_TOOLS
}

export function isPtySidecarEnabled(): boolean {
  return Flag.OPENCODE_RUST_PTY
}

export function isLlmSidecarEnabled(): boolean {
  return Flag.OPENCODE_RUST_LLM
}

// ── Adapter operations ───────────────────────────────────────────────────────

/**
 * Execute a glob operation via the sidecar.
 * Returns file paths matching the pattern.
 */
export function sidecarGlob(params: {
  pattern: string
  path?: string
}): Effect.Effect<{ files: string[] }, Error, SidecarService.Service> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.glob(params),
      catch: (e) => new Error(`sidecar glob failed: ${e}`),
    })
    return result
  })
}

/**
 * Execute a grep operation via the sidecar.
 */
export function sidecarGrep(params: {
  pattern: string
  path?: string
  context?: number
  max_results?: number
}): Effect.Effect<
  { matches: Array<{ file: string; line: number; content: string }> },
  Error,
  SidecarService.Service
> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.grep(params),
      catch: (e) => new Error(`sidecar grep failed: ${e}`),
    })
    return result
  })
}

/**
 * Read a file via the sidecar.
 */
export function sidecarFileRead(params: {
  path: string
  offset?: number
  limit?: number
}): Effect.Effect<{ content: string; total_lines: number }, Error, SidecarService.Service> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.fileRead(params),
      catch: (e) => new Error(`sidecar file.read failed: ${e}`),
    })
    return result
  })
}

/**
 * Write a file via the sidecar.
 */
export function sidecarFileWrite(params: {
  path: string
  content: string
}): Effect.Effect<{ bytes_written: number }, Error, SidecarService.Service> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.fileWrite(params),
      catch: (e) => new Error(`sidecar file.write failed: ${e}`),
    })
    return result
  })
}

/**
 * Edit a file via the sidecar (string replacement).
 */
export function sidecarFileEdit(params: {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}): Effect.Effect<{ replacements: number }, Error, SidecarService.Service> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.fileEdit(params),
      catch: (e) => new Error(`sidecar file.edit failed: ${e}`),
    })
    return result
  })
}

/**
 * Execute a shell command via the sidecar.
 */
export function sidecarShellExec(params: {
  command: string
  cwd?: string
  timeout_ms?: number
  env?: Array<[string, string]>
}): Effect.Effect<
  { exitCode: number; stdout: string; stderr: string },
  Error,
  SidecarService.Service
> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.shellExec(params),
      catch: (e) => new Error(`sidecar shell.exec failed: ${e}`),
    })
    return result
  })
}

/**
 * Get git status via the sidecar.
 */
export function sidecarGitStatus(
  cwd: string,
): Effect.Effect<Array<{ path: string; status: string }>, Error, SidecarService.Service> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.gitStatus(cwd),
      catch: (e) => new Error(`sidecar git.status failed: ${e}`),
    })
    return result
  })
}

/**
 * Get git log via the sidecar.
 */
export function sidecarGitLog(params: {
  cwd: string
  max_count?: number
  since?: string
}): Effect.Effect<
  Array<{ hash: string; message: string; author: string; date: string }>,
  Error,
  SidecarService.Service
> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.gitLog(params),
      catch: (e) => new Error(`sidecar git.log failed: ${e}`),
    })
    return result
  })
}

/**
 * Get git diff via the sidecar.
 */
export function sidecarGitDiff(params: {
  cwd: string
  from?: string
  to?: string
}): Effect.Effect<string, Error, SidecarService.Service> {
  return Effect.gen(function* () {
    const { client } = yield* SidecarService.Service
    const result = yield* Effect.tryPromise({
      try: () => client.gitDiff(params),
      catch: (e) => new Error(`sidecar git.diff failed: ${e}`),
    })
    return result
  })
}
