import path from "path"
import os from "os"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@opencode-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Flag } from "@/flag/flag"
import { Discovery } from "./discovery"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
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
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")
  const OPENCODE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const SKILL_GLOB = new Bun.Glob("**/SKILL.md")

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const bundledSkillLocations = new Set<string>()
    const dirs = new Set<string>()

    const addSkill = async (match: string, isBundled = false) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
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

      dirs.add(path.dirname(match))

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        content: md.content,
      }
      dirs.add(path.dirname(match))
      if (isBundled) {
        bundledSkillLocations.add(match)
      }
      log.info("loaded skill", { name: parsed.data.name, location: match, bundled: isBundled })
    }

    const scanExternal = async (root: string, scope: "global" | "project") => {
      return Array.fromAsync(
        EXTERNAL_SKILL_GLOB.scan({
          cwd: root,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        }),
      )
        .then((matches) => Promise.all(matches.map((m) => addSkill(m))))
        .catch((error) => {
          log.error(`failed to scan ${scope} skills`, { dir: root, error })
        })
    }

    if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanExternal(root, "global")
      }
      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanExternal(root, "project")
      }
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

    // Scan .opencode/skill/ directories
    for (const dir of await Config.directories()) {
      for await (const match of OPENCODE_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      for await (const match of SKILL_GLOB.scan({
        cwd: resolved,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    // Download and load skills from URLs
    for (const url of config.skills?.urls ?? []) {
      const list = await Discovery.pull(url)
      for (const dir of list) {
        dirs.add(dir)
        for await (const match of SKILL_GLOB.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
        })) {
          await addSkill(match)
        }
      }
    }

    log.info("loaded skills", {
      count: Object.keys(skills).length,
      names: Object.keys(skills).sort(),
      bundledCount: bundledSkillLocations.size,
      bundledLocations: Array.from(bundledSkillLocations).sort(),
    })
    return {
      skills,
      dirs: Array.from(dirs),
    }
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
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
      loadedSkills: skills.map((s) => s.name).sort(),
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
    const fs = await import("fs/promises")
    const matter = await import("gray-matter")
    const base = input.baseDir ?? path.join(Instance.worktree, ".opencode", "skill")
    const dir = path.join(base, input.name)
    const filePath = path.join(dir, "SKILL.md")
    await fs.mkdir(dir, { recursive: true })
    const body = matter.default.stringify(input.content.trim(), {
      name: input.name,
      description: input.description,
    })
    await fs.writeFile(filePath, body, "utf8")
    const info: Info = {
      name: input.name,
      description: input.description,
      location: filePath,
      content: input.content.trim(),
    }
    await Instance.dispose()
    return info
  }

  export async function content(name: string) {
    const info = await get(name)
    if (!info) return undefined
    const md = await ConfigMarkdown.parse(info.location)
    return md.content
  }
}
