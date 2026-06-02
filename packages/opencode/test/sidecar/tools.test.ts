/**
 * Integration tests for tool operations via the Rust sidecar.
 *
 * Tests glob, grep, file read/write/edit, and git operations.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { withSidecar, type SidecarContext } from "./fixture"

let ctx: SidecarContext
let tmpDir: string

beforeAll(async () => {
  ctx = await withSidecar()
})

afterAll(async () => {
  await ctx[Symbol.asyncDispose]()
})

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-tools-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── process.run ──────────────────────────────────────────────────────────────

describe("sidecar: process.run", () => {
  test("runs a command directly without shell", async () => {
    const result = await ctx.client.processRun({
      command: "echo",
      args: ["hello", "from", "process.run"],
      cwd: "/tmp",
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("hello from process.run")
  })

  test("passes env vars", async () => {
    const result = await ctx.client.processRun({
      command: "env",
      cwd: "/tmp",
      env: [["SIDECAR_TEST_VAR", "rust_is_fast"]],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("SIDECAR_TEST_VAR=rust_is_fast")
  })

  test("runs git directly", async () => {
    const result = await ctx.client.processRun({
      command: "git",
      args: ["--version"],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("git version")
  })

  test("reports non-zero exit code", async () => {
    const result = await ctx.client.processRun({
      command: "false",
    })
    expect(result.exitCode).not.toBe(0)
  })
})

// ── tools.glob ───────────────────────────────────────────────────────────────

describe("sidecar: tools.glob", () => {
  test("finds files matching a pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1")
    fs.writeFileSync(path.join(tmpDir, "bar.ts"), "export const bar = 2")
    fs.writeFileSync(path.join(tmpDir, "baz.js"), "const baz = 3")

    const result = await ctx.client.glob({ pattern: "*.ts", path: tmpDir })
    expect(result.files).toHaveLength(2)
    expect(result.files.some((f: string) => f.includes("foo.ts"))).toBe(true)
    expect(result.files.some((f: string) => f.includes("bar.ts"))).toBe(true)
    expect(result.files.some((f: string) => f.includes("baz.js"))).toBe(false)
  })

  test("returns empty array when no matches", async () => {
    const result = await ctx.client.glob({ pattern: "*.xyz", path: tmpDir })
    expect(result.files).toHaveLength(0)
  })

  test("works with nested directories", async () => {
    const subDir = path.join(tmpDir, "src")
    fs.mkdirSync(subDir)
    fs.writeFileSync(path.join(subDir, "index.ts"), "export {}")
    fs.writeFileSync(path.join(tmpDir, "root.ts"), "export {}")

    const result = await ctx.client.glob({ pattern: "**/*.ts", path: tmpDir })
    expect(result.files.length).toBeGreaterThanOrEqual(2)
  })
})

// ── tools.grep ───────────────────────────────────────────────────────────────

describe("sidecar: tools.grep", () => {
  test("finds content matching a regex pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "hello.ts"), "const greeting = 'hello world'\nconst x = 1\n")
    fs.writeFileSync(path.join(tmpDir, "other.ts"), "const y = 2\n")

    const result = await ctx.client.grep({ pattern: "hello", path: tmpDir })
    expect(result.matches.length).toBeGreaterThanOrEqual(1)
    expect(result.matches[0].content).toContain("hello")
  })

  test("returns empty when no matches", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "nothing here")

    const result = await ctx.client.grep({ pattern: "zzzznotfound", path: tmpDir })
    expect(result.matches).toHaveLength(0)
  })

  test("supports regex patterns", async () => {
    fs.writeFileSync(path.join(tmpDir, "nums.txt"), "line1\nline22\nline333\n")

    const result = await ctx.client.grep({ pattern: "line\\d{2,}", path: tmpDir })
    expect(result.matches.length).toBeGreaterThanOrEqual(2)
  })
})

// ── tools.file.read ──────────────────────────────────────────────────────────

describe("sidecar: tools.file.read", () => {
  test("reads file content", async () => {
    const filePath = path.join(tmpDir, "readme.md")
    fs.writeFileSync(filePath, "# Hello\nWorld\nLine 3\n")

    const result = await ctx.client.fileRead({ path: filePath })
    expect(result.content).toContain("# Hello")
    expect(result.total_lines).toBe(3)
  })

  test("supports offset and limit", async () => {
    const filePath = path.join(tmpDir, "lines.txt")
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")
    fs.writeFileSync(filePath, lines)

    const result = await ctx.client.fileRead({ path: filePath, offset: 5, limit: 3 })
    expect(result.content).toContain("line 6")
    expect(result.content).not.toContain("line 1")
  })

  test("errors on non-existent file", async () => {
    await expect(
      ctx.client.fileRead({ path: path.join(tmpDir, "nope.txt") }),
    ).rejects.toThrow()
  })
})

// ── tools.file.write ─────────────────────────────────────────────────────────

describe("sidecar: tools.file.write", () => {
  test("writes content to a new file", async () => {
    const filePath = path.join(tmpDir, "new-file.txt")
    const result = await ctx.client.fileWrite({ path: filePath, content: "hello sidecar" })
    expect(result.bytes_written).toBeGreaterThan(0)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello sidecar")
  })

  test("overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "overwrite.txt")
    fs.writeFileSync(filePath, "old content")
    await ctx.client.fileWrite({ path: filePath, content: "new content" })
    expect(fs.readFileSync(filePath, "utf-8")).toBe("new content")
  })
})

// ── tools.file.edit ──────────────────────────────────────────────────────────

describe("sidecar: tools.file.edit", () => {
  test("replaces a string in a file", async () => {
    const filePath = path.join(tmpDir, "edit-me.ts")
    fs.writeFileSync(filePath, "const name = 'old'\nconst x = 1\n")

    const result = await ctx.client.fileEdit({
      path: filePath,
      old_string: "'old'",
      new_string: "'new'",
    })
    expect(result.replacements).toBe(1)
    expect(fs.readFileSync(filePath, "utf-8")).toContain("'new'")
  })

  test("replace_all replaces multiple occurrences", async () => {
    const filePath = path.join(tmpDir, "multi.txt")
    fs.writeFileSync(filePath, "foo bar foo baz foo\n")

    const result = await ctx.client.fileEdit({
      path: filePath,
      old_string: "foo",
      new_string: "qux",
      replace_all: true,
    })
    expect(result.replacements).toBe(3)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("qux bar qux baz qux\n")
  })

  test("errors when old_string not found", async () => {
    const filePath = path.join(tmpDir, "no-match.txt")
    fs.writeFileSync(filePath, "hello world\n")

    await expect(
      ctx.client.fileEdit({
        path: filePath,
        old_string: "zzz_not_here",
        new_string: "replaced",
      }),
    ).rejects.toThrow()
  })
})

// ── tools.git ────────────────────────────────────────────────────────────────

describe("sidecar: tools.git", () => {
  let gitDir: string

  beforeEach(async () => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-git-"))
    // Initialize a git repo
    const { exitCode } = await ctx.client.shellExec({
      command: "git init && git config user.email 'test@test.com' && git config user.name 'Test'",
      cwd: gitDir,
      timeout_ms: 5000,
    })
    expect(exitCode).toBe(0)

    // Create a file and commit
    fs.writeFileSync(path.join(gitDir, "file.txt"), "initial content\n")
    await ctx.client.shellExec({
      command: "git add . && git commit -m 'initial commit'",
      cwd: gitDir,
      timeout_ms: 5000,
    })
  })

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true })
  })

  test("git.status returns clean status", async () => {
    const result = await ctx.client.gitStatus(gitDir)
    expect(result).toHaveLength(0)
  })

  test("git.status shows modified files", async () => {
    fs.writeFileSync(path.join(gitDir, "file.txt"), "modified\n")
    const result = await ctx.client.gitStatus(gitDir)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some((e: { path: string }) => e.path.includes("file.txt"))).toBe(true)
  })

  test("git.log returns commit history", async () => {
    const result = await ctx.client.gitLog({ cwd: gitDir, max_count: 5 })
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].message).toContain("initial commit")
  })

  test("git.diff shows changes", async () => {
    fs.writeFileSync(path.join(gitDir, "file.txt"), "changed content\n")
    const result: any = await ctx.client.gitDiff({ cwd: gitDir })
    // Result is a raw diff string from the sidecar
    const diff = typeof result === "string" ? result : result.diff
    expect(diff).toContain("changed content")
  })
})
