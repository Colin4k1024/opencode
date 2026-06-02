/**
 * Sidecar-backed AppProcess Service
 *
 * Routes process execution through the Rust sidecar's `process.run` RPC.
 * This replaces direct child process spawning for Git, Worktree, Format, etc.
 */

import { Effect, Layer, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { AppProcess, type RunOptions, type RunResult, AppProcessError } from "@opencode-ai/core/process"
import * as Log from "@opencode-ai/core/util/log"
import * as SidecarService from "./service"

const log = Log.create({ service: "sidecar-process" })

function describeCommand(command: ChildProcess.Command): string {
  if (command._tag === "StandardCommand") {
    return command.args.length ? `${command.command} ${command.args.join(" ")}` : command.command
  }
  return "piped-command"
}

/**
 * Create an AppProcess.Service layer backed by the sidecar.
 */
export const layer: Layer.Layer<AppProcess.Service, Error, SidecarService.Service> = Layer.effect(
  AppProcess.Service,
  Effect.gen(function* () {
    const { client } = yield* SidecarService.Service

    const run = Effect.fn("SidecarProcess.run")(function* (
      command: ChildProcess.Command,
      options?: RunOptions,
    ) {
      if (command._tag !== "StandardCommand") {
        return yield* new AppProcessError({
          command: describeCommand(command),
          cause: new Error("sidecar process.run only supports StandardCommand"),
        })
      }

      const description = describeCommand(command)
      const result = yield* Effect.tryPromise({
        try: () =>
          client.processRun({
            command: command.command,
            args: command.args.length > 0 ? [...command.args] : undefined,
            cwd: command.options?.cwd,
            env: command.options?.env
              ? Object.entries(command.options.env).map(([k, v]) => [k, v ?? ""] as [string, string])
              : undefined,
            stdin: options?.stdin && typeof options.stdin === "string" ? options.stdin : undefined,
            timeout_ms: options?.timeout ? Number(options.timeout) : undefined,
            max_output_bytes: options?.maxOutputBytes,
          }),
        catch: (e) => new AppProcessError({ command: description, cause: e as Error }),
      })

      return {
        command: description,
        exitCode: result.exitCode,
        stdout: Buffer.from(result.stdout, "utf-8"),
        stderr: Buffer.from(result.stderr, "utf-8"),
        stdoutTruncated: false,
        stderrTruncated: false,
      } satisfies RunResult
    })

    // runStream: not ideal for sidecar (batch), but works for short-lived processes
    const runStream = (
      command: ChildProcess.Command,
    ): Stream.Stream<string, AppProcessError> => {
      return Stream.fromEffect(
        Effect.gen(function* () {
          const result = yield* run(command)
          return result.stdout.toString("utf-8")
        }),
      ).pipe(
        Stream.flatMap((text) => Stream.fromIterable(text.split("\n").filter(Boolean))),
      )
    }

    // Spawner stub — required by AppProcess.Interface but sidecar doesn't support streaming spawn
    // Falls through to `run` for compatibility
    const spawner: ChildProcessSpawner["Service"] = {
      spawn: () => {
        throw new Error("sidecar process does not support streaming spawn — use run()")
      },
      lines: () => {
        throw new Error("sidecar process does not support streaming lines — use run()")
      },
    } as any

    return AppProcess.Service.of({ ...spawner, run, runStream })
  }),
)

/**
 * Self-contained layer with SidecarService provided.
 */
export const defaultLayer = layer.pipe(
  Layer.provide(SidecarService.layer),
  Layer.orDie,
)

/**
 * Try sidecar process layer, fall back to native if binary not available.
 */
export function withFallback(
  nativeLayer: Layer.Layer<AppProcess.Service, never, never>,
): Layer.Layer<AppProcess.Service, never, never> {
  const disabled = process.env["OPENCODE_RUST_TOOLS"]?.toLowerCase()
  if (disabled === "false" || disabled === "0") {
    return nativeLayer
  }

  try {
    const fs = require("fs") as typeof import("fs")
    const { getSidecarBinaryPath } = require("./index") as { getSidecarBinaryPath: () => string }
    const binaryPath = getSidecarBinaryPath()

    if (!binaryPath.includes("/") && !binaryPath.includes("\\")) {
      return nativeLayer
    }
    if (!fs.existsSync(binaryPath)) {
      return nativeLayer
    }

    log.info("using sidecar process layer", { binaryPath })
    return defaultLayer
  } catch {
    return nativeLayer
  }
}
