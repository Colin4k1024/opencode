import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./sql.txt"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "sql-tool" })

const MAX_RESULT_ROWS = 1000
const MAX_RESULT_BYTES = 100 * 1024 // 100KB

type DatabaseType = "mysql" | "postgresql" | "sqlite"

interface DatabaseConfig {
  type: DatabaseType
  connectionString?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  file?: string // For SQLite
}

async function detectDatabaseConfig(): Promise<DatabaseConfig | null> {
  const directory = Instance.directory

  // Check for DATABASE_URL in environment
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    return parseDatabaseUrl(databaseUrl)
  }

  // Check for .env files
  const envFiles = [".env", ".env.local", ".env.development", ".env.production"]
  for (const envFile of envFiles) {
    const envPath = path.join(directory, envFile)
    try {
      const content = await fs.readFile(envPath, "utf-8")
      const envVars = parseEnvFile(content)
      if (envVars.DATABASE_URL) {
        return parseDatabaseUrl(envVars.DATABASE_URL)
      }
      // Check for individual database connection variables
      if (envVars.DB_HOST || envVars.DB_USER || envVars.DB_NAME) {
        return {
          type: (envVars.DB_TYPE as DatabaseType) || "postgresql",
          host: envVars.DB_HOST,
          port: envVars.DB_PORT ? parseInt(envVars.DB_PORT, 10) : undefined,
          user: envVars.DB_USER,
          password: envVars.DB_PASSWORD,
          database: envVars.DB_NAME || envVars.DB_DATABASE,
        }
      }
    } catch (err) {
      // File doesn't exist or can't be read, continue
    }
  }

  // Check for Drizzle config
  const drizzleConfigPath = path.join(directory, "drizzle.config.ts")
  try {
    const content = await fs.readFile(drizzleConfigPath, "utf-8")
    const config = await parseDrizzleConfig(content)
    if (config) return config
  } catch (err) {
    // File doesn't exist or can't be read
  }

  // Check for Prisma schema
  const prismaSchemaPath = path.join(directory, "prisma", "schema.prisma")
  try {
    const content = await fs.readFile(prismaSchemaPath, "utf-8")
    const config = await parsePrismaSchema(content)
    if (config) return config
  } catch (err) {
    // File doesn't exist or can't be read
  }

  // Check for Spring Boot configuration
  const springBootConfig = await detectSpringBootConfig(directory)
  if (springBootConfig) return springBootConfig

  return null
}

function parseDatabaseUrl(url: string): DatabaseConfig {
  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol.replace(":", "")

    if (protocol === "mysql" || protocol === "mysql2") {
      return {
        type: "mysql",
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 3306,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname.replace("/", ""),
      }
    }

    if (protocol === "postgresql" || protocol === "postgres") {
      return {
        type: "postgresql",
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 5432,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname.replace("/", ""),
      }
    }

    if (protocol === "sqlite" || protocol === "file") {
      return {
        type: "sqlite",
        file: parsed.pathname,
      }
    }
  } catch (err) {
    log.warn("Failed to parse database URL", { url, error: err })
  }

  // Fallback: try to detect from URL string
  if (url.includes("mysql")) {
    return { type: "mysql", connectionString: url }
  }
  if (url.includes("postgres")) {
    return { type: "postgresql", connectionString: url }
  }
  if (url.includes("sqlite") || url.endsWith(".db") || url.endsWith(".sqlite")) {
    return { type: "sqlite", file: url }
  }

  throw new Error(`Unsupported database URL format: ${url}`)
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
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
        result[key] = value
      }
    }
  }
  return result
}

async function parseDrizzleConfig(content: string): Promise<DatabaseConfig | null> {
  // Simple regex-based parsing for drizzle.config.ts
  // Look for connection string or database configuration
  const urlMatch = content.match(/connectionString:\s*["'`]([^"'`]+)["'`]/)
  if (urlMatch) {
    return parseDatabaseUrl(urlMatch[1])
  }

  // Look for database object configuration
  const dbTypeMatch = content.match(/driver:\s*["'`]([^"'`]+)["'`]/)
  if (dbTypeMatch) {
    const driver = dbTypeMatch[1].toLowerCase()
    if (driver.includes("mysql")) {
      return { type: "mysql" }
    }
    if (driver.includes("postgres")) {
      return { type: "postgresql" }
    }
    if (driver.includes("sqlite")) {
      return { type: "sqlite" }
    }
  }

  return null
}

async function parsePrismaSchema(content: string): Promise<DatabaseConfig | null> {
  // Parse Prisma schema to extract database URL
  const urlMatch = content.match(/url\s*=\s*["'`]([^"'`]+)["'`]/)
  if (urlMatch) {
    // Prisma URLs may contain env() references
    const url = urlMatch[1]
    if (url.startsWith("env(")) {
      const envVar = url.match(/env\(["']([^"']+)["']\)/)?.[1]
      if (envVar) {
        const envValue = process.env[envVar]
        if (envValue) {
          return parseDatabaseUrl(envValue)
        }
      }
    } else {
      return parseDatabaseUrl(url)
    }
  }

  return null
}

function parseJdbcUrl(jdbcUrl: string): DatabaseConfig | null {
  try {
    // JDBC URL format: jdbc:database://host:port/database
    const match = jdbcUrl.match(/^jdbc:(\w+):\/\/([^:]+):?(\d+)?\/(.+)$/)
    if (!match) {
      // Try alternative format without port: jdbc:database://host/database
      const match2 = jdbcUrl.match(/^jdbc:(\w+):\/\/([^/]+)\/(.+)$/)
      if (match2) {
        const [, dbType, host, database] = match2
        return mapJdbcTypeToConfig(dbType.toLowerCase(), host, undefined, database)
      }
      return null
    }

    const [, dbType, host, portStr, database] = match
    const port = portStr ? parseInt(portStr, 10) : undefined
    return mapJdbcTypeToConfig(dbType.toLowerCase(), host, port, database)
  } catch (err) {
    log.warn("Failed to parse JDBC URL", { url: jdbcUrl, error: err })
    return null
  }
}

function mapJdbcTypeToConfig(
  jdbcType: string,
  host: string,
  port: number | undefined,
  database: string,
): DatabaseConfig | null {
  // Map JDBC driver types to our database types
  if (jdbcType === "mysql" || jdbcType === "mariadb") {
    return {
      type: "mysql",
      host,
      port: port || 3306,
      database,
    }
  }
  if (jdbcType === "postgresql" || jdbcType === "postgres") {
    return {
      type: "postgresql",
      host,
      port: port || 5432,
      database,
    }
  }
  if (jdbcType === "h2") {
    // H2 can be in-memory or file-based
    if (database.startsWith("mem:") || database.startsWith("file:")) {
      log.warn("H2 in-memory or file-based databases are not supported for SQL tool")
      return null
    }
    // H2 TCP mode
    return {
      type: "postgresql", // H2 TCP mode is similar to PostgreSQL
      host,
      port: port || 9092,
      database,
    }
  }
  if (jdbcType === "sqlite") {
    return {
      type: "sqlite",
      file: database,
    }
  }

  log.warn("Unsupported JDBC database type", { type: jdbcType })
  return null
}

async function detectSpringBootConfig(directory: string): Promise<DatabaseConfig | null> {
  // Check for active profile from environment
  const activeProfile = process.env.SPRING_PROFILES_ACTIVE || process.env.SPRING_PROFILE_ACTIVE

  // Spring Boot standard paths
  const resourcesPath = path.join(directory, "src/main/resources")
  const configPaths: string[] = []

  // If active profile is set, prioritize profile-specific files
  if (activeProfile && activeProfile !== "default") {
    configPaths.push(
      path.join(resourcesPath, `application-${activeProfile}.yml`),
      path.join(resourcesPath, `application-${activeProfile}.yaml`),
      path.join(resourcesPath, `application-${activeProfile}.properties`),
      path.join(directory, `application-${activeProfile}.yml`),
      path.join(directory, `application-${activeProfile}.yaml`),
      path.join(directory, `application-${activeProfile}.properties`),
    )
  }

  // Add default files (lower priority)
  configPaths.push(
    path.join(resourcesPath, "application.yml"),
    path.join(resourcesPath, "application.yaml"),
    path.join(resourcesPath, "application.properties"),
    path.join(directory, "application.yml"),
    path.join(directory, "application.yaml"),
    path.join(directory, "application.properties"),
  )

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8")
      const ext = path.extname(configPath).toLowerCase()
      const config = await parseSpringBootConfig(content, ext)
      if (config) {
        log.info("Found Spring Boot database config", { path: configPath, profile: activeProfile || "default" })
        return config
      }
    } catch (err) {
      // File doesn't exist or can't be read, continue
    }
  }

  return null
}

async function parseSpringBootConfig(content: string, ext: string): Promise<DatabaseConfig | null> {
  try {
    if (ext === ".yml" || ext === ".yaml") {
      // Parse YAML
      // @ts-ignore - optional dependency
      const yaml = await import("js-yaml")
      const config = yaml.load(content) as any

      // Extract Spring Boot datasource configuration
      const datasource = config?.spring?.datasource
      if (!datasource || !datasource.url) {
        return null
      }

      const jdbcConfig = parseJdbcUrl(datasource.url)
      if (!jdbcConfig) return null

      // Add credentials if available
      return {
        ...jdbcConfig,
        user: datasource.username || jdbcConfig.user,
        password: datasource.password || jdbcConfig.password,
      }
    } else if (ext === ".properties") {
      // Parse Properties file
      const props: Record<string, string> = {}
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const equalIndex = trimmed.indexOf("=")
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim()
          let value = trimmed.substring(equalIndex + 1).trim()
          // Remove quotes
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
          }
          props[key] = value
        }
      }

      // Extract Spring Boot datasource configuration
      const datasourceUrl = props["spring.datasource.url"]
      if (!datasourceUrl) return null

      const jdbcConfig = parseJdbcUrl(datasourceUrl)
      if (!jdbcConfig) return null

      // Add credentials if available
      return {
        ...jdbcConfig,
        user: props["spring.datasource.username"] || jdbcConfig.user,
        password: props["spring.datasource.password"] || jdbcConfig.password,
      }
    }
  } catch (err) {
    log.warn("Failed to parse Spring Boot config", { error: err })
  }

  return null
}

async function executeQuery(config: DatabaseConfig, query: string, params?: any[]): Promise<any[]> {
  const { type } = config

  try {
    if (type === "mysql") {
      // @ts-ignore - optional dependency
      const mysql = await import("mysql2/promise")
      const connection = await mysql.createConnection({
        host: config.host || "localhost",
        port: config.port || 3306,
        user: config.user,
        password: config.password,
        database: config.database,
      })
      try {
        const [rows] = await connection.execute(query, params || [])
        return rows as any[]
      } finally {
        await connection.end()
      }
    }

    if (type === "postgresql") {
      // @ts-ignore - optional dependency
      const { Client } = await import("pg")
      const client = new Client({
        host: config.host || "localhost",
        port: config.port || 5432,
        user: config.user,
        password: config.password,
        database: config.database,
      })
      try {
        await client.connect()
        const result = await client.query(query, params || [])
        return result.rows
      } finally {
        await client.end()
      }
    }

    if (type === "sqlite") {
      // @ts-ignore - optional dependency
      const Database = (await import("better-sqlite3")).default
      const dbPath = config.file || config.connectionString
      if (!dbPath) {
        throw new Error("SQLite database file path is required")
      }
      const db = new Database(dbPath, { readonly: true })
      try {
        const stmt = db.prepare(query)
        const rows = params ? stmt.all(...params) : stmt.all()
        return rows as any[]
      } finally {
        db.close()
      }
    }

    throw new Error(`Unsupported database type: ${type}`)
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Database query failed: ${err.message}`)
    }
    throw err
  }
}

function truncateResults(results: any[]): { rows: any[]; truncated: boolean; totalRows: number } {
  if (results.length <= MAX_RESULT_ROWS) {
    // Check byte size
    const json = JSON.stringify(results)
    if (Buffer.byteLength(json, "utf-8") <= MAX_RESULT_BYTES) {
      return { rows: results, truncated: false, totalRows: results.length }
    }
  }

  // Truncate to MAX_RESULT_ROWS
  const truncated = results.slice(0, MAX_RESULT_ROWS)
  return { rows: truncated, truncated: true, totalRows: results.length }
}

export const SqlTool = Tool.define("sql", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("The SQL query to execute. Use parameterized queries with ? placeholders for safety."),
    params: z.array(z.any()).optional().describe("Parameters for parameterized queries"),
    databaseUrl: z.string().optional().describe("Database connection URL (overrides auto-detection)"),
    databaseType: z.enum(["mysql", "postgresql", "sqlite"]).optional().describe("Database type (overrides auto-detection)"),
  }),
  async execute(params, ctx) {
    // Check permission
    await ctx.ask({
      permission: "sql",
      patterns: ["*"],
      always: ["*"],
      metadata: { query: params.query.substring(0, 100) },
    })

    // Validate query type (only SELECT allowed by default for safety)
    const queryUpper = params.query.trim().toUpperCase()
    if (!queryUpper.startsWith("SELECT")) {
      throw new Error("Only SELECT queries are allowed. For safety, other query types are restricted.")
    }

    // Detect or use provided database configuration
    let config: DatabaseConfig | null = null

    if (params.databaseUrl) {
      config = parseDatabaseUrl(params.databaseUrl)
    } else if (params.databaseType) {
      config = { type: params.databaseType }
      // Try to detect connection details
      const detected = await detectDatabaseConfig()
      if (detected && detected.type === params.databaseType) {
        config = { ...detected, type: params.databaseType }
      }
    } else {
      config = await detectDatabaseConfig()
    }

    if (!config) {
      throw new Error(
        "Could not detect database configuration. Please provide databaseUrl or databaseType parameter, or ensure DATABASE_URL is set in environment or .env file.",
      )
    }

    if (!config.connectionString && !config.file && (!config.host || !config.database)) {
      throw new Error("Incomplete database configuration. Please provide connection details.")
    }

    log.info("Executing SQL query", { type: config.type, query: params.query.substring(0, 100) })

    // Execute query
    const results = await executeQuery(config, params.query, params.params)

    // Truncate if necessary
    const { rows, truncated, totalRows } = truncateResults(results)

    let output = `Query executed successfully.\n\n`
    output += `Results (${rows.length}${truncated ? ` of ${totalRows}` : ""} rows):\n\n`
    output += "```json\n"
    output += JSON.stringify(rows, null, 2)
    output += "\n```\n"

    if (truncated) {
      output += `\n(Results truncated. Showing ${rows.length} of ${totalRows} rows. Use LIMIT in your query to control result size.)`
    }

    return {
      title: `SQL Query: ${params.query.substring(0, 50)}${params.query.length > 50 ? "..." : ""}`,
      output,
      metadata: {
        rowCount: rows.length,
        totalRows,
        truncated,
        databaseType: config.type,
      },
    }
  },
})
