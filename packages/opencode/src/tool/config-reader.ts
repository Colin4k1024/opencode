import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./config-reader.txt"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { parse as parseJsonc } from "jsonc-parser"

const log = Log.create({ service: "config-reader-tool" })

const COMMON_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "drizzle.config.ts",
  "prisma/schema.prisma",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "webpack.config.ts",
  "next.config.js",
  "next.config.ts",
  "tailwind.config.js",
  "tailwind.config.ts",
  "eslint.config.js",
  "eslint.config.ts",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  ".prettierrc.json",
  // Spring Boot configuration files
  "application.yml",
  "application.yaml",
  "application.properties",
  "application-dev.yml",
  "application-dev.yaml",
  "application-dev.properties",
  "application-prod.yml",
  "application-prod.yaml",
  "application-prod.properties",
  "application-test.yml",
  "application-test.yaml",
  "application-test.properties",
  // Spring Boot standard paths
  "src/main/resources/application.yml",
  "src/main/resources/application.yaml",
  "src/main/resources/application.properties",
]

async function findConfigFile(fileName: string, directory: string): Promise<string | null> {
  // Try exact path first
  const exactPath = path.isAbsolute(fileName) ? fileName : path.join(directory, fileName)
  try {
    await fs.access(exactPath)
    return exactPath
  } catch {
    // File doesn't exist at exact path
  }

  // Special handling for Spring Boot application files
  if (fileName.includes("application") || fileName === "application.yml" || fileName === "application.properties") {
    // Try Spring Boot standard paths first
    const springBootPaths = [
      path.join(directory, "src/main/resources/application.yml"),
      path.join(directory, "src/main/resources/application.yaml"),
      path.join(directory, "src/main/resources/application.properties"),
      path.join(directory, "application.yml"),
      path.join(directory, "application.yaml"),
      path.join(directory, "application.properties"),
    ]
    for (const springPath of springBootPaths) {
      try {
        await fs.access(springPath)
        return springPath
      } catch {
        // Continue
      }
    }
  }

  // Try common locations
  for (const commonFile of COMMON_CONFIG_FILES) {
    if (commonFile === fileName || commonFile.endsWith(fileName)) {
      const commonPath = path.join(directory, commonFile)
      try {
        await fs.access(commonPath)
        return commonPath
      } catch {
        // Continue searching
      }
    }
  }

  // Try searching up the directory tree
  const found = await Filesystem.findUp(fileName, directory, Instance.worktree)
  if (found.length > 0) {
    return found[0]
  }

  return null
}

async function parseConfigFile(filePath: string): Promise<any> {
  const ext = path.extname(filePath).toLowerCase()
  const content = await fs.readFile(filePath, "utf-8")

  if (ext === ".json" || ext === ".jsonc" || filePath.endsWith(".json") || filePath.endsWith(".jsonc")) {
    // Parse JSON/JSONC
    const errors: any[] = []
    const data = parseJsonc(content, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
      throw new Error(`Failed to parse JSON: ${errors.map((e) => e.message).join(", ")}`)
    }
    return data
  }

  if (ext === ".ts" || ext === ".js" || filePath.endsWith(".ts") || filePath.endsWith(".js")) {
    // For TypeScript/JavaScript config files, we'll read the raw content
    // and try to extract configuration object
    // This is a simplified approach - full parsing would require a TypeScript parser
    return {
      _type: "javascript",
      _content: content,
      _note: "JavaScript/TypeScript config file. Content shown as-is for analysis.",
    }
  }

  if (ext === ".prisma" || filePath.endsWith(".prisma")) {
    // Prisma schema - return as text for now
    return {
      _type: "prisma",
      _content: content,
      _note: "Prisma schema file. Content shown as-is for analysis.",
    }
  }

  if (filePath.includes(".env") || path.basename(filePath).startsWith(".env")) {
    // Environment file
    const envVars: Record<string, string> = {}
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("#")) {
        const match = trimmed.match(/^([^=]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          let value = match[2].trim()
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
          }
          envVars[key] = value
        }
      }
    }
    return envVars
  }

  if (ext === ".toml" || filePath.endsWith(".toml")) {
    // TOML - try to parse if toml package is available
    try {
      const toml = await import("toml")
      return toml.parse(content)
    } catch {
      // Fallback to raw content
      return {
        _type: "toml",
        _content: content,
        _note: "TOML file. Content shown as-is for analysis.",
      }
    }
  }

  if (ext === ".yaml" || ext === ".yml" || filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    // YAML - try to parse if js-yaml package is available
    try {
      const yaml = await import("js-yaml")
      return yaml.load(content)
    } catch {
      // Fallback to raw content
      return {
        _type: "yaml",
        _content: content,
        _note: "YAML file. Content shown as-is for analysis.",
      }
    }
  }

  if (ext === ".properties" || filePath.endsWith(".properties")) {
    // Properties file (commonly used in Spring Boot, Java projects)
    const props: Record<string, string> = {}
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue
      
      // Handle key=value format
      const equalIndex = trimmed.indexOf("=")
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim()
        let value = trimmed.substring(equalIndex + 1).trim()
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        // Handle Spring Boot property paths (e.g., spring.datasource.url)
        props[key] = value
      }
    }
    return props
  }

  // Default: return as text
  return {
    _type: "text",
    _content: content,
    _note: "Unknown file type. Content shown as-is for analysis.",
  }
}

export const ConfigReaderTool = Tool.define("config-reader", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z
      .string()
      .describe(
        "Path to the configuration file. Can be a filename (e.g., 'package.json') or relative/absolute path. The tool will search common locations if just a filename is provided.",
      ),
  }),
  async execute(params, ctx) {
    // Check permission
    await ctx.ask({
      permission: "config_reader",
      patterns: [params.filePath],
      always: ["*"],
      metadata: { filePath: params.filePath },
    })

    const directory = Instance.directory
    const filePath = await findConfigFile(params.filePath, directory)

    if (!filePath) {
      // List available config files
      const availableFiles: string[] = []
      for (const commonFile of COMMON_CONFIG_FILES) {
        const commonPath = path.join(directory, commonFile)
        try {
          await fs.access(commonPath)
          availableFiles.push(commonFile)
        } catch {
          // File doesn't exist
        }
      }

      if (availableFiles.length > 0) {
        throw new Error(
          `Configuration file not found: ${params.filePath}\n\nAvailable configuration files:\n${availableFiles.map((f) => `  - ${f}`).join("\n")}`,
        )
      }
      throw new Error(`Configuration file not found: ${params.filePath}`)
    }

    log.info("Reading config file", { filePath })

    const config = await parseConfigFile(filePath)
    const relativePath = path.relative(Instance.worktree, filePath)

    let output = `Configuration file: ${relativePath}\n\n`
    output += "```json\n"
    output += JSON.stringify(config, null, 2)
    output += "\n```\n"

    return {
      title: `Config: ${path.basename(filePath)}`,
      output,
      metadata: {
        filePath: relativePath,
        absolutePath: filePath,
      },
    }
  },
})
