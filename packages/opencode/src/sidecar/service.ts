/**
 * Sidecar Effect Service
 *
 * Manages the lifecycle of the Rust sidecar process and exposes a
 * `SidecarClient` via an Effect `Context.Service`.  The service is a
 * process-level singleton: it spawns the binary, performs the initialize
 * handshake, and tears everything down cleanly when the Effect runtime exits.
 *
 * Usage:
 *
 *   const client = yield* Sidecar.Service
 *   const result  = await client.shellExec({ command: "echo hi" })
 *
 * Provide the layer in your app bootstrap:
 *
 *   Layer.provide(Sidecar.layer)
 */

import { Effect, Layer, Context } from "effect"
import * as net from "net"
import * as Log from "@opencode-ai/core/util/log"

import { SidecarClient } from "./client"
import {
  DEFAULT_CONFIG,
  spawnSidecar,
  connectToSidecar,
  shutdownSidecar,
  type SidecarConfig,
} from "./index"

const log = Log.create({ service: "sidecar" })

// ── Service interface ─────────────────────────────────────────────────────────

export interface Interface {
  readonly client: SidecarClient
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Sidecar") {}

// ── Layer ─────────────────────────────────────────────────────────────────────

/**
 * Build a Layer that spawns the sidecar, performs the initialize handshake,
 * and shuts everything down when the scope closes.
 */
function makeLayer(config: SidecarConfig = DEFAULT_CONFIG): Layer.Layer<Service, Error> {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      log.info("spawning sidecar", { binary: config.binaryPath })

      // Spawn the process — resolves once the socket path appears on stdout
      const { process: proc, socketPath } = yield* Effect.tryPromise({
        try: () => spawnSidecar(config),
        catch: (e) => new Error(`sidecar spawn failed: ${e}`),
      })

      log.info("sidecar ready", { socketPath })

      // Connect over the Unix socket
      const socket: net.Socket = yield* Effect.tryPromise({
        try: () => connectToSidecar(socketPath),
        catch: (e) => new Error(`sidecar connect failed: ${e}`),
      })

      // Build the typed RPC client
      const client = new SidecarClient(socket)

      // Perform the initialize handshake
      yield* Effect.tryPromise({
        try: () => client.initialize(),
        catch: (e) => new Error(`sidecar initialize failed: ${e}`),
      })

      log.info("sidecar initialized")

      // Register teardown for when the Effect scope closes
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          log.info("shutting down sidecar")
          try {
            await shutdownSidecar(socket, proc)
          } catch (e) {
            log.error("sidecar shutdown error", { e })
          }
        }),
      )

      return { client }
    }),
  )
}

export const layer: Layer.Layer<Service, Error> = makeLayer()

export const layerWithConfig = makeLayer

// ── Convenience accessors ─────────────────────────────────────────────────────

/** Access the underlying `SidecarClient` from within an Effect. */
export const client: Effect.Effect<SidecarClient, never, Service> = Effect.map(
  Service,
  (s) => s.client,
)
