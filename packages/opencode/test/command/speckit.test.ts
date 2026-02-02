import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Command } from "../../src/command/index"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"

describe("speckit integration", () => {
  test("registers speckit commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const commands = await Command.list()
        const names = commands.map((c) => c.name)

        expect(names).toContain("speckit.init")
        expect(names).toContain("speckit.constitution")
        expect(names).toContain("speckit.specify")
        expect(names).toContain("speckit.plan")
        expect(names).toContain("speckit.tasks")
        expect(names).toContain("speckit.implement")
        expect(names).toContain("speckit.ingest")
        expect(names).toContain("speckit.vibe")
      },
    })
  }, 20_000)

  test("speckit commands have expected agents and hints", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const init = await Command.get("speckit.init")
        const tasks = await Command.get("speckit.tasks")
        const implement = await Command.get("speckit.implement")
        const ingest = await Command.get("speckit.ingest")
        const vibe = await Command.get("speckit.vibe")

        expect(init?.agent).toBe("speckit")
        expect(init?.hints).toContain("$ARGUMENTS")

        expect(tasks?.agent).toBe("speckit")
        expect(tasks?.hints).toEqual([])

        expect(implement?.agent).toBe("coding")

        expect(ingest?.agent).toBe("speckit")
        expect(ingest?.hints).toContain("$ARGUMENTS")

        expect(vibe?.agent).toBe("speckit-vibe")
        expect(vibe?.hints).toContain("$ARGUMENTS")
      },
    })
  }, 20_000)

  test("speckit templates resolve", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = await Command.get("speckit.init")
        expect(cmd).toBeDefined()
        const template = await cmd!.template
        expect(typeof template).toBe("string")
        expect(template).toContain(".opencode/speckit")
      },
    })
  })

  test("speckit agent only allows editing under .opencode/speckit/**", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const speckit = await Agent.get("speckit")
        expect(speckit).toBeDefined()
        expect(speckit?.mode).toBe("subagent")

        expect(PermissionNext.evaluate("edit", ".opencode/speckit/constitution.md", speckit!.permission).action).toBe(
          "allow",
        )
        expect(PermissionNext.evaluate("edit", ".opencode/speckit/specs/x/spec.md", speckit!.permission).action).toBe(
          "allow",
        )
        expect(PermissionNext.evaluate("edit", "README.md", speckit!.permission).action).toBe("deny")
        expect(PermissionNext.evaluate("edit", "src/index.ts", speckit!.permission).action).toBe("deny")

        expect(speckit?.prompt).toContain("spec-driven")

        // doc-driven ingest requires webfetch
        expect(PermissionNext.evaluate("webfetch", "*", speckit!.permission).action).toBe("allow")
      },
    })
  })

  test("speckit-vibe agent has question/task/orchestrate and restricted edit", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const vibe = await Agent.get("speckit-vibe")
        expect(vibe).toBeDefined()
        expect(vibe?.mode).toBe("primary")

        expect(PermissionNext.evaluate("question", "*", vibe!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "*", vibe!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("orchestrate", "*", vibe!.permission).action).toBe("allow")

        expect(
          PermissionNext.evaluate("edit", ".opencode/speckit/specs/x/requirements.md", vibe!.permission).action,
        ).toBe("allow")
        expect(PermissionNext.evaluate("edit", "src/index.ts", vibe!.permission).action).toBe("deny")
      },
    })
  })
})
