import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { Config } from "../config/config"
import { scanSecrets } from "../util/secret-check"
import { minimatch } from "minimatch"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    const normalizedPath = filepath.replace(/\\/g, "/")
    const isG6NodeCache =
      normalizedPath.includes(".opencode/g6/") && normalizedPath.includes("/nodes/") && normalizedPath.endsWith(".json")
    if (isG6NodeCache && params.content.trim().length === 0) {
      throw new Error(
        "G6 node cache files must not be empty. Provide the full Level 4 JSON as content (node, outgoingEdges, incomingEdges, dependencies, implementationRequirements)."
      )
    }

    const file = Bun.file(filepath)
    const exists = await file.exists()
    const contentOld = exists ? await file.text() : ""
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
    const cfg = await Config.get()
    const rel = path.relative(Instance.worktree, filepath)
    if (
      !exists &&
      /\.(md|txt)$/i.test(filepath) &&
      !/^README/i.test(path.basename(filepath)) &&
      cfg.experimental?.hook?.docControl
    ) {
      const allowPaths = cfg.experimental.hook.docControl.allowPaths ?? []
      const allowed = allowPaths.some((p) => minimatch(rel.replace(/\\/g, "/"), p))
      if (!allowed) {
        if (cfg.experimental.hook.docControl.defaultPermission === "deny") {
          throw new Error("Creating this doc is not allowed (docControl.defaultPermission: deny).")
        }
        await ctx.ask({
          permission: "create_doc",
          patterns: [rel],
          always: ["*"],
          metadata: { createDoc: true },
        })
      }
    }
    const askMeta: Record<string, unknown> = { filepath, diff }
    if (cfg.rules?.noSecrets) {
      const m = scanSecrets(params.content)
      if (m) Object.assign(askMeta, { likelySecret: true, matched: m.snippet, pattern: m.pattern })
    }
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: askMeta,
    })

    await Bun.write(filepath, params.content)
    await Bus.publish(File.Event.Edited, {
      file: filepath,
      tool: "write",
    })
    FileTime.read(ctx.sessionID, filepath)

    let output = "Wrote file successfully."
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilepath = Filesystem.normalizePath(filepath)
    let projectDiagnosticsCount = 0
    for (const [file, issues] of Object.entries(diagnostics)) {
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length === 0) continue
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      if (file === normalizedFilepath) {
        output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        continue
      }
      if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    if (
      cfg.experimental?.hook?.codeHygiene?.warnConsoleLog &&
      /\.(js|ts|jsx|tsx)$/i.test(filepath) &&
      /console\.log\s*\(/.test(params.content)
    ) {
      output += "\n\n[Code hygiene] This file contains console.log. Consider removing before commit."
    }

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
