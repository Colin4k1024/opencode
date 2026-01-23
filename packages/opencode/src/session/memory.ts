import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Session } from "."
import { Storage } from "../storage/storage"

const MAX_CHARS_PER_TOKEN = 4

/**
 * Persist a short session summary and context when a session is removed.
 * Call from Session.remove before deleting messages.
 */
export async function persistMemory(sessionID: string): Promise<void> {
  const cfg = await Config.get()
  if (!cfg.experimental?.memory?.persist) return

  const projectID = Instance.project.id
  const session = await Session.get(sessionID).catch(() => null)
  if (!session) return

  const messages = await Session.messages({ sessionID, limit: 20 })
  const maxChars = ((cfg.experimental.memory.maxSummaryTokens ?? 500) * MAX_CHARS_PER_TOKEN) | 0

  const parts: string[] = []
  let len = 0
  for (let i = messages.length - 1; i >= 0 && len < maxChars; i--) {
    const m = messages[i]
    const role = m.info.role
    for (const p of m.parts) {
      if (p.type !== "text" || !("text" in p) || !p.text) continue
      const s = `${role}: ${p.text.slice(0, maxChars - len)}\n`
      parts.push(s)
      len += s.length
      if (len >= maxChars) break
    }
  }
  const summary = parts.join("").slice(0, maxChars)
  const ts = Date.now()

  await Storage.write(["memory", projectID, "last_session"], {
    sessionID,
    summary,
    directory: session.directory,
    ts,
  })
  await Storage.write(["memory", projectID, "context"], { text: summary, ts })
}

/**
 * Load the persisted context summary for the current project.
 * Returns a string to inject as "上一会话摘要：..." or undefined.
 */
export async function loadMemoryContext(): Promise<string | undefined> {
  const cfg = await Config.get()
  if (!cfg.experimental?.memory?.persist) return undefined

  const projectID = Instance.project.id
  const raw = await Storage.read<{ text?: string; summary?: string }>(["memory", projectID, "context"])
  if (!raw) return undefined
  return raw.text ?? raw.summary
}
