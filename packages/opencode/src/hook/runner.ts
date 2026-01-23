import { Bus } from "../bus"
import { File } from "../file"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "hook.runner" })

async function runScripts(
  items: Array<{ command: string[]; environment?: Record<string, string> }> | undefined,
  env: Record<string, string>,
) {
  if (!items?.length) return
  for (const item of items) {
    const cmd = item.command.map((c) =>
      c.replace(/\$FILE/g, env.FILE || "").replace(/\$TOOL/g, env.TOOL || "").replace(/\$SESSION_ID/g, env.SESSION_ID || ""),
    )
    log.info("running hook script", { command: cmd })
    const proc = Bun.spawn({
      cmd,
      cwd: Instance.directory,
      env: { ...process.env, ...item.environment, ...env },
      stdout: "ignore",
      stderr: "pipe",
    })
    try {
      await proc.exited
    } catch (e) {
      log.error("hook script failed", { command: cmd, error: e })
    }
  }
}

export async function runFileEditedHooks(
  cfg: Config.Info,
  payload: { file: string; tool?: "write" | "edit" },
) {
  const h = cfg.experimental?.hook?.file_edited
  if (!h || typeof h !== "object") return
  const arr = payload.tool
    ? (Array.isArray((h as Record<string, unknown>)[payload.tool])
        ? (h as Record<string, unknown>)[payload.tool]
        : [])
    : (Array.isArray((h as Record<string, unknown>)["*"]) ? (h as Record<string, unknown>)["*"] : [])
  const list = Array.isArray(arr) ? (arr as Array<{ command: string[]; environment?: Record<string, string> }>) : []
  await runScripts(list, { FILE: payload.file, TOOL: payload.tool || "" })
}

export async function runSessionCompletedHooks(cfg: Config.Info, sessionID: string) {
  const arr = cfg.experimental?.hook?.session_completed
  if (!Array.isArray(arr) || arr.length === 0) return
  await runScripts(arr, { SESSION_ID: sessionID })
}

export function init() {
  Bus.subscribe(File.Event.Edited, async (event) => {
    const { file, tool } = event.properties
    const cfg = await Config.get()
    await runFileEditedHooks(cfg, { file, tool })
  })
  log.info("hook runner subscribed to File.Event.Edited")
}

export async function onSessionRemove(sessionID: string) {
  const cfg = await Config.get()
  await runSessionCompletedHooks(cfg, sessionID)
}
