/**
 * Sidecar-backed Ripgrep Service
 *
 * Implements the same Ripgrep.Service interface but routes operations
 * through the Rust sidecar instead of spawning ripgrep child processes.
 *
 * When OPENCODE_RUST_TOOLS is enabled, this layer replaces the default
 * ripgrep layer in the Effect service graph.
 */

import { Effect, Layer, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import path from "path"
import { Ripgrep, type FilesInput, type SearchInput, type SearchResult, type TreeInput, type Item } from "../file/ripgrep"
import { SidecarClient } from "./client"
import * as SidecarService from "./service"

/**
 * Create a Ripgrep.Service layer that uses the sidecar for glob/grep.
 *
 * Requires SidecarService in the context.
 */
export const layer: Layer.Layer<Ripgrep.Service, Error, SidecarService.Service> = Layer.effect(
  Ripgrep.Service,
  Effect.gen(function* () {
    const { client } = yield* SidecarService.Service

    return {
      files: (input: FilesInput): Stream.Stream<string, PlatformError | Error> => {
        return Stream.fromEffect(
          Effect.tryPromise({
            try: async () => {
              // Convert glob patterns to a single pattern for the sidecar
              const pattern = input.glob?.[0] ?? "*"
              const result = await client.glob({ pattern, path: input.cwd })
              return result.files.map((f: string) => path.relative(input.cwd, f))
            },
            catch: (e) => new Error(`sidecar glob failed: ${e}`),
          }),
        ).pipe(Stream.flatMap((files) => Stream.fromIterable(files)))
      },

      search: (input: SearchInput): Effect.Effect<SearchResult, PlatformError | Error> => {
        return Effect.tryPromise({
          try: async () => {
            const result = await client.grep({
              pattern: input.pattern,
              path: input.cwd,
              max_results: input.limit,
            })

            const items: Item[] = result.matches.map((m) => ({
              path: { text: path.relative(input.cwd, m.file) },
              lines: { text: m.content },
              line_number: m.line as any,
              absolute_offset: 0 as any,
              submatches: [],
            }))

            return {
              items,
              partial: false,
            }
          },
          catch: (e) => new Error(`sidecar grep failed: ${e}`),
        })
      },

      tree: (input: TreeInput): Effect.Effect<string, PlatformError | Error> => {
        // Tree is implemented as a glob of all files, then formatted
        return Effect.tryPromise({
          try: async () => {
            const result = await client.glob({ pattern: "**/*", path: input.cwd })
            const files = result.files
              .map((f: string) => path.relative(input.cwd, f))
              .sort()
            if (input.limit && files.length > input.limit) {
              files.length = input.limit
            }
            return files.join("\n")
          },
          catch: (e) => new Error(`sidecar tree failed: ${e}`),
        })
      },
    }
  }),
)

import * as Log from "@opencode-ai/core/util/log"

const _log = Log.create({ service: "sidecar-ripgrep" })

/**
 * Self-contained layer that provides both SidecarService and the
 * sidecar-backed Ripgrep.Service. Drop-in replacement for Ripgrep.defaultLayer.
 *
 * If the sidecar binary is not found or fails to start, the layer
 * will fail (use `withFallback` for graceful degradation).
 */
export const defaultLayer = layer.pipe(
  Layer.provide(SidecarService.layer),
  Layer.orDie,
)

/**
 * Try the sidecar layer; if the binary isn't available,
 * gracefully fall back to the given native layer.
 *
 * Decision is made synchronously at layer construction time by
 * checking if the sidecar binary exists on disk.
 */
export function withFallback(
  nativeLayer: Layer.Layer<Ripgrep.Service, never, never>,
): Layer.Layer<Ripgrep.Service, never, never> {
  // If user explicitly disabled sidecar, skip
  const disabled = process.env["OPENCODE_RUST_TOOLS"]?.toLowerCase()
  if (disabled === "false" || disabled === "0") {
    return nativeLayer
  }

  // Check if the sidecar binary exists
  try {
    const fs = require("fs") as typeof import("fs")
    const { getSidecarBinaryPath } = require("./index") as { getSidecarBinaryPath: () => string }
    const binaryPath = getSidecarBinaryPath()

    // If it's a bare name (no path separator), it's a PATH lookup — skip sidecar
    // since we can't verify existence without spawning
    if (!binaryPath.includes("/") && !binaryPath.includes("\\")) {
      _log.info("sidecar binary not resolved to absolute path, using native", { binaryPath })
      return nativeLayer
    }

    if (!fs.existsSync(binaryPath)) {
      _log.info("sidecar binary not found, using native ripgrep", { binaryPath })
      return nativeLayer
    }

    _log.info("sidecar binary found, using sidecar ripgrep", { binaryPath })
    return defaultLayer
  } catch (e) {
    _log.info("sidecar check failed, using native ripgrep", { error: String(e) })
    return nativeLayer
  }
}
