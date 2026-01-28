import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Agent } from "../agent/agent"
import { ConfigMarkdown } from "../config/markdown"
import { PermissionNext } from "../permission/next"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { State } from "../project/state"

const parameters = z.object({
  name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review' or 'category/helper')"),
})

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
      ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
      : [
          "Load a skill to get detailed instructions for a specific task.",
          "Skills provide specialized knowledge and step-by-step guidance.",
          "Use this when a task matches an available skill's description.",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join(" ")

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
          `All loaded skills (${allSkills.length}): ${allSkills.map((s) => s.name).sort().join(", ")}`,
          `Accessible skills (${accessible.length}): ${accessible.map((s) => s.name).sort().join(", ")}`,
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
      // Load and parse skill content
      const parsed = await ConfigMarkdown.parse(skill.location)
      const dir = path.dirname(skill.location)

      // Format output similar to plugin pattern
      const output = [`## Skill: ${skill.name}`, "", `**Base directory**: ${dir}`, "", parsed.content.trim()].join("\n")

      return {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          dir,
        },
      }
    },
  }
})
