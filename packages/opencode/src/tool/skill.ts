import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Agent } from "../agent/agent"
import { PermissionNext } from "../permission/next"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { State } from "../project/state"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const log = Log.create({ service: "skill-tool" })

  // CRITICAL: Verify skills are from global directory, force reload if not
  const globalSkillsDir = path.join(Global.Path.home, ".opencode", "skills")
  let allSkills = await Skill.all()

  // Check if any skills are NOT from global directory
  const nonGlobalSkills = allSkills.filter((skill) => !skill.location.startsWith(globalSkillsDir))

  if (nonGlobalSkills.length > 0) {
    log.warn("detected skills not from global directory, forcing reload", {
      nonGlobalSkills: nonGlobalSkills.map((s) => ({
        name: s.name,
        location: s.location,
      })),
      globalDir: globalSkillsDir,
    })

    // Force dispose and reload
    log.info("forcing state disposal to clear cache", {
      directory: Instance.directory,
    })
    await Instance.dispose()
    // Wait a bit to ensure disposal completes
    await new Promise((resolve) => setTimeout(resolve, 100))
    log.info("state disposal completed, reloading skills")
    // Force reload by calling all() which will trigger state() to re-execute init
    allSkills = await Skill.all()

    // Verify reload worked
    const stillNonGlobal = allSkills.filter((skill) => !skill.location.startsWith(globalSkillsDir))
    if (stillNonGlobal.length > 0) {
      log.error("skills still not from global directory after reload", {
        stillNonGlobal: stillNonGlobal.map((s) => ({
          name: s.name,
          location: s.location,
        })),
        globalDir: globalSkillsDir,
      })
    } else {
      log.info("skills reloaded successfully, all from global directory", {
        count: allSkills.length,
        globalDir: globalSkillsDir,
        skillNames: allSkills.map((s) => s.name).sort(),
      })
    }
  }

  log.info("all skills loaded", {
    count: allSkills.length,
    names: allSkills.map((s) => s.name).sort(),
  })

  // CRITICAL: Filter skills to only include those from global directory
  const skills = allSkills.filter((skill) => {
    const isFromGlobalDir = skill.location.startsWith(globalSkillsDir)
    if (!isFromGlobalDir) {
      log.warn("skill filtered out - not from global directory", {
        skill: skill.name,
        location: skill.location,
        expectedDir: globalSkillsDir,
      })
    }
    return isFromGlobalDir
  })

  log.info("skills filtered to global directory only", {
    total: allSkills.length,
    fromGlobalDir: skills.length,
    filtered: allSkills.length - skills.length,
    globalDir: globalSkillsDir,
    skillNames: skills.map((s) => s.name).sort(),
  })

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        // Allow if action is "allow" or "ask" (ask means no explicit rule, default to allow)
        // Only deny if explicitly denied
        const allowed = rule.action !== "deny"
        if (!allowed) {
          log.warn("skill filtered by permission", {
            skill: skill.name,
            action: rule.action,
            agent: agent.name,
            rule: JSON.stringify(rule),
          })
        } else if (rule.action === "ask") {
          log.info("skill permission is ask, allowing by default", {
            skill: skill.name,
            agent: agent.name,
          })
        }
        return allowed
      })
    : skills

  log.info("accessible skills after filtering", {
    count: accessibleSkills.length,
    names: accessibleSkills.map((s) => s.name).sort(),
    agent: agent?.name,
  })

  const description =
    accessibleSkills.length === 0
      ? "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
          "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
          "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `    <location>${pathToFileURL(skill.location).href}</location>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join("\n")

  const examples = accessibleSkills
    .map((skill) => `'${skill.name}'`)
    .slice(0, 3)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z.object({
    name: z.string().describe(`The name of the skill from available_skills${hint}`),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const skill = await Skill.get(params.name)

      if (!skill) {
        const allSkillsRaw = await Skill.all()
        // Filter to only global directory skills
        const globalSkillsDir = path.join(Global.Path.home, ".opencode", "skills")
        const allSkills = allSkillsRaw.filter((s) => s.location.startsWith(globalSkillsDir))
        const agentInfo = ctx.agent ? await Agent.get(ctx.agent).catch(() => undefined) : undefined
        const accessible = agentInfo
          ? allSkills.filter((s) => {
              const rule = PermissionNext.evaluate("skill", s.name, agentInfo.permission)
              return rule.action !== "deny"
            })
          : allSkills

        const permissionCheck = agentInfo
          ? PermissionNext.evaluate("skill", params.name, agentInfo.permission)
          : { action: "allow", permission: "skill", pattern: "*" }

        const errorMessage = [
          `Skill "${params.name}" not found.`,
          ``,
          `All loaded skills (${allSkills.length}): ${allSkills
            .map((s) => s.name)
            .sort()
            .join(", ")}`,
          `Accessible skills (${accessible.length}): ${accessible
            .map((s) => s.name)
            .sort()
            .join(", ")}`,
          `Permission check for "${params.name}": ${JSON.stringify(permissionCheck, null, 2)}`,
          agentInfo ? `Agent: ${agentInfo.name}` : "No agent context",
        ].join("\n")

        log.error("skill not found with detailed diagnostics", {
          requested: params.name,
          allSkills: allSkills.map((s) => s.name).sort(),
          accessible: accessible.map((s) => s.name).sort(),
          permissionCheck,
          agent: agentInfo?.name,
        })

        throw new Error(errorMessage)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)
      const base = pathToFileURL(dir).href

      const limit = 10
      const files = await iife(async () => {
        const arr = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (file.includes("SKILL.md")) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      }).then((f) => f.map((file) => `<file>${file}</file>`).join("\n"))

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          "Note: file list is sampled.",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</skill_content>",
        ].join("\n"),
        metadata: {
          name: skill.name,
          dir,
        },
      }
    },
  }
})
