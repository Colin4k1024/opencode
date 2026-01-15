import path from "path"
import fs from "fs/promises"
import matter from "gray-matter"
import z from "zod"
import { Instance } from "../project/instance"
import { NamedError } from "@opencode-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Bus } from "@/bus"
import { Session } from "@/session"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  const BUNDLED_SKILLS_GLOB = new Bun.Glob("**/SKILL.md")

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const bundledSkillLocations = new Set<string>()

    const addSkill = async (match: string, isBundled = false) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? `${err.data.path}: ${err.data.message}`
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) {
        log.warn("failed to parse skill metadata", {
          path: match,
          issues: parsed.error.issues,
          data: md.data,
          isBundled,
        })
        return
      }

      // Special logging for g6-parser to debug loading issues
      if (parsed.data.name === "g6-parser") {
        log.info("loading g6-parser skill", {
          path: match,
          isBundled,
          location: match,
          description: parsed.data.description,
        })
      }

      // Prevent overriding bundled skills from project-level skills
      if (skills[parsed.data.name]) {
        if (bundledSkillLocations.has(skills[parsed.data.name].location)) {
          log.warn("skipping project-level skill, bundled skill already exists", {
            name: parsed.data.name,
            bundled: skills[parsed.data.name].location,
            project: match,
          })
          return
        }
        log.warn("duplicate skill name, overriding", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
      }
      if (isBundled) {
        bundledSkillLocations.add(match)
      }
      log.info("loaded skill", { name: parsed.data.name, location: match, bundled: isBundled })
    }

    // Scan bundled skills from global directory ~/.opencode/skills/
    const globalSkillsDir = path.join(Global.Path.home, ".opencode", "skills")
    log.info("scanning bundled skills from global directory", { dir: globalSkillsDir })
    if (await Filesystem.isDir(globalSkillsDir).catch(() => false)) {
      let bundledCount = 0
      let bundledErrors = 0
      try {
        for await (const match of BUNDLED_SKILLS_GLOB.scan({
          cwd: globalSkillsDir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
        })) {
          try {
            await addSkill(match, true)
            bundledCount++
          } catch (error) {
            bundledErrors++
            log.error("error adding bundled skill", { path: match, error })
          }
        }
        log.info("scanned bundled skills from global directory", {
          count: bundledCount,
          errors: bundledErrors,
          dir: globalSkillsDir,
        })
      } catch (error) {
        log.error("error scanning bundled skills directory", { dir: globalSkillsDir, error })
      }
    } else {
      log.warn("bundled skills directory not found", { dir: globalSkillsDir })
    }

    log.info("loaded skills", {
      count: Object.keys(skills).length,
      names: Object.keys(skills).sort(),
      bundledCount: bundledSkillLocations.size,
      bundledLocations: Array.from(bundledSkillLocations).sort(),
      source: "~/.opencode/skills/ only",
    })
    return skills
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x))
  }

  /**
   * Diagnose skill loading status for debugging
   */
  export async function diagnose() {
    const globalSkillsDir = path.join(Global.Path.home, ".opencode", "skills")
    const exists = await Filesystem.isDir(globalSkillsDir).catch(() => false)
    const skills = await all()

    return {
      globalDir: globalSkillsDir,
      exists,
      loadedSkills: Object.keys(skills).sort(),
      skillCount: skills.length,
    }
  }

  /**
   * Force reload skills by disposing the current instance state
   */
  export async function reload() {
    log.info("reloading skills by disposing instance state")
    await Instance.dispose()
    const skills = await all()
    log.info("skills reloaded", {
      count: skills.length,
      names: skills.map((s) => s.name).sort(),
    })
    return skills
  }

  /**
   * Test skill loading, specifically for g6-parser
   */
  export async function test() {
    const allSkills = await all()
    const g6Parser = await get("g6-parser")
    const globalSkillsDir = path.join(Global.Path.home, ".opencode", "skills")
    const g6ParserPath = path.join(globalSkillsDir, "g6-parser", "SKILL.md")
    const fileExists = await Filesystem.exists(g6ParserPath)

    return {
      total: allSkills.length,
      hasG6Parser: !!g6Parser,
      g6ParserLocation: g6Parser?.location,
      g6ParserFileExists: fileExists,
      g6ParserExpectedPath: g6ParserPath,
      allNames: allSkills.map((s) => s.name).sort(),
      globalDir: globalSkillsDir,
      globalDirExists: await Filesystem.isDir(globalSkillsDir).catch(() => false),
    }
  }

  /**
   * Create a new skill at baseDir/name/SKILL.md with the given frontmatter and content.
   * baseDir defaults to .opencode/skill in the project worktree.
   */
  export async function create(input: {
    name: string
    description: string
    content: string
    baseDir?: string
  }): Promise<Info> {
    const base = input.baseDir ?? path.join(Instance.worktree, ".opencode", "skill")
    const dir = path.join(base, input.name)
    const filePath = path.join(dir, "SKILL.md")
    await fs.mkdir(dir, { recursive: true })
    const body = matter.stringify(input.content.trim(), {
      name: input.name,
      description: input.description,
    })
    await fs.writeFile(filePath, body, "utf8")
    const info: Info = {
      name: input.name,
      description: input.description,
      location: filePath,
    }
    await Instance.dispose()
    return info
  }
}
