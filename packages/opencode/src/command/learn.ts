import z from "zod"
import { generateObject } from "ai"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Skill } from "../skill/skill"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create({ service: "command.learn" })

const LEARN_SYSTEM = `You extract reusable patterns, checklists, or step-by-step procedures from a coding conversation and turn them into a SKILL.

Output:
- name: a short slug (e.g. "react-query-patterns", "api-error-handling"). Use lowercase, hyphens for spaces.
- description: one clear line for when to use this skill.
- content: markdown body with the actual checklist, steps, or patterns. No frontmatter—just the content.`

const schema = z.object({
  name: z.string().describe("Slug-style name for the skill"),
  description: z.string().describe("One-line description"),
  content: z.string().describe("Markdown body of the skill"),
})

export type LearnCommandInput = {
  sessionID: string
  arguments: string
}

/**
 * From the current session's recent messages, use an LLM to extract a reusable skill
 * (name, description, content) and write it to .opencode/skill/name/SKILL.md.
 * Returns the created Skill.Info; the caller should then prompt with a summary.
 */
export async function LearnCommandHandler(input: LearnCommandInput): Promise<Skill.Info> {
  const msgs = await Session.messages({ sessionID: input.sessionID, limit: 20 })
  const serialized = msgs
    .map((m) => {
      const pre = `[${m.info.role}]: `
      const parts = m.parts
        .map((p) => {
          if (p.type === "text") return (p as MessageV2.TextPart).text
          return `[${p.type}]`
        })
        .join(" ")
      return pre + parts.slice(0, 600)
    })
    .join("\n\n")

  const hint = input.arguments.trim() ? `\nFocus or naming hint from user: ${input.arguments}` : ""

  const cfg = await Config.get()
  const defaultModel = await Provider.defaultModel()
  const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
  const language = await Provider.getLanguage(model)

  const { object } = await generateObject({
    model: language,
    schema,
    temperature: 0.3,
    messages: [
      { role: "system", content: LEARN_SYSTEM },
      {
        role: "user",
        content: `Extract a skill from this conversation.${hint}\n\n---\n\n${serialized || "(No messages yet.)"}`,
      },
    ],
  })

  const info = await Skill.create({
    name: object.name,
    description: object.description,
    content: object.content,
  })
  log.info("created skill", { name: info.name, location: info.location })
  return info
}
