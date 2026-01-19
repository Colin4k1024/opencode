import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_FIX from "./prompt/fix.txt"
import PROMPT_DEEPAGENT from "./prompt/deepagent.txt"
import PROMPT_CODING from "./prompt/coding.txt"
import PROMPT_PLANNER from "./prompt/planner.txt"
import PROMPT_ARCHITECT from "./prompt/architect.txt"
import PROMPT_CODE_REVIEWER from "./prompt/code-reviewer.txt"
import PROMPT_SECURITY_REVIEWER from "./prompt/security-reviewer.txt"
import PROMPT_TDD_GUIDE from "./prompt/tdd-guide.txt"
import PROMPT_E2E_RUNNER from "./prompt/e2e-runner.txt"
import PROMPT_REFACTOR_CLEANER from "./prompt/refactor-cleaner.txt"
import PROMPT_DOC_UPDATER from "./prompt/doc-updater.txt"
import PROMPT_SPECKIT from "./prompt/speckit.txt"
import PROMPT_SPECKIT_VIBE from "./prompt/speckit-vibe.txt"
import PROMPT_DDD_VIBE from "./prompt/ddd-vibe.txt"
import PROMPT_PARSER from "./prompt/parser.txt"
import PROMPT_G6_SCENARIO_TESTS from "./prompt/g6-scenario-tests.txt"
import PROMPT_G6_SCENARIO_TEST_RUNNER from "./prompt/g6-scenario-test-runner.txt"
import PROMPT_PRODUCT_ASSET_EXTRACTOR from "./prompt/product-asset-extractor.txt"
import PROMPT_DDD_TO_G6 from "./prompt/ddd-to-g6.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      skill: "allow", // Explicitly allow all skills
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      build: {
        name: "build",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_exit: "allow",
            external_directory: {
              [path.join(Global.Path.data, "plans", "*")]: "allow",
            },
            edit: {
              "*": "deny",
              [path.join(".opencode", "plans", "*.md")]: "allow",
              [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      planner: {
        name: "planner",
        description: `Agent for breaking down tasks and planning implementation paths. Use when you need an ordered list of steps, phases, or a recommended execution order. It only reads and searches—it does not edit, write, or run bash.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            codesearch: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_PLANNER,
        options: {},
        mode: "subagent",
        native: true,
      },
      architect: {
        name: "architect",
        description: `Agent for system design decisions and architectural advice. Use when you need module boundaries, data flow, or design trade-offs. It only reads and searches—it does not edit, write, or run bash.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            codesearch: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_ARCHITECT,
        options: {},
        mode: "subagent",
        native: true,
      },
      "code-reviewer": {
        name: "code-reviewer",
        description: `Agent for code quality and security review. Use for reviewing changes, commits, or branches. It can run read-only commands (tests, linters, git show) and use codesearch, websearch. It does not modify code.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            codesearch: "allow",
            websearch: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_CODE_REVIEWER,
        options: {},
        mode: "subagent",
        native: true,
      },
      "security-reviewer": {
        name: "security-reviewer",
        description: `Agent for vulnerability analysis and security review. Use for finding injection, auth, secrets, and dependency risks. It only reads and searches—it does not edit, write, or run bash.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            codesearch: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_SECURITY_REVIEWER,
        options: {},
        mode: "subagent",
        native: true,
      },
      "tdd-guide": {
        name: "tdd-guide",
        description: `Agent for leading Test-Driven Development: red–green–refactor. Use when implementing a feature with "test first" discipline. It can read, edit, write, run tests; it does not use orchestrate or task.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            edit: "allow",
            write: "allow",
            bash: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            todoread: "deny",
            todowrite: "deny",
            task: "deny",
            orchestrate: "deny",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_TDD_GUIDE,
        options: {},
        mode: "subagent",
        native: true,
      },
      "e2e-runner": {
        name: "e2e-runner",
        description: `Agent for running Playwright E2E tests. Use to execute npx playwright test (or project script), support --project, --grep, and report pass/fail. It does not write application or test code.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            bash: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_E2E_RUNNER,
        options: {},
        mode: "subagent",
        native: true,
      },
      "refactor-cleaner": {
        name: "refactor-cleaner",
        description: `Agent for removing dead code and safe refactoring. Use to delete unused exports, simplify structure, and improve maintainability without changing behavior. It does not fix bugs.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            edit: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_REFACTOR_CLEANER,
        options: {},
        mode: "subagent",
        native: true,
      },
      "doc-updater": {
        name: "doc-updater",
        description: `Agent for keeping documentation in sync with code. Use to update README, docs/, *.md. It only edits documentation files—never source code.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            edit: {
              "**/README*": "allow",
              "**/docs/**": "allow",
              "**/*.md": "allow",
              "**/CHANGELOG*": "allow",
              "**/CONTRIBUTING*": "allow",
              "*": "deny",
            },
            glob: "allow",
            list: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_DOC_UPDATER,
        options: {},
        mode: "subagent",
        native: true,
      },
      speckit: {
        name: "speckit",
        description: `Agent for spec-driven development artifacts (spec/plan/tasks) under .opencode/speckit/. It only edits those artifacts and never modifies application source code.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            edit: {
              "*": "deny",
              ".opencode/speckit/**": "allow",
            },
            write: "allow",
            todoread: "deny",
            todowrite: "deny",
            task: "deny",
            orchestrate: "deny",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_SPECKIT,
        options: {},
        mode: "subagent",
        native: true,
      },
      "speckit-vibe": {
        name: "speckit-vibe",
        description: `Doc-driven speckit vibecoding orchestrator: ingest requirement docs, decompose into REQ-IDs with strict traceability, clarify gaps, generate spec/plan/tasks, then auto-implement via coding agent.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            question: "allow",
            orchestrate: "allow",
            task: "allow",
            // speckit-vibe itself should not author code; it may write artifacts if needed
            edit: {
              "*": "deny",
              ".opencode/speckit/**": "allow",
            },
            write: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_SPECKIT_VIBE,
        options: {},
        mode: "primary",
        native: true,
      },
      "ddd-vibe": {
        name: "ddd-vibe",
        description: `Interactive DDD vibecoding orchestrator: ingest requirement docs, decompose into REQ-IDs with strict traceability, clarify gaps, generate complete DDD design artifacts (strategic/tactical/services), then auto-implement via ddd-implement agent.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            question: "allow",
            orchestrate: "allow",
            task: "allow",
            // ddd-vibe itself should not author code; it may write artifacts if needed
            edit: {
              "*": "deny",
              ".opencode/ddd/**": "allow",
            },
            write: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_DDD_VIBE,
        options: {},
        mode: "primary",
        native: true,
      },
      parser: {
        name: "parser",
        description: `G6 JSON parser orchestrator: parse G6 design files, analyze dependencies, split into implementation tasks by module and node type, generate plan file, generate TODOs, then call coding agent for full implementation workflow (code → tests → commit).`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            question: "allow",
            skill: "allow",
            task: "allow",
            todoread: "allow",
            todowrite: "allow",
            // parser itself should not author code; it delegates to coding agent
            edit: {
              "*": "deny",
              ".opencode/plans/**": "allow",
              ".opencode/g6/**": "allow",
            },
            write: {
              "*": "deny",
              ".opencode/plans/**": "allow",
              ".opencode/g6/**": "allow",
            },
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_PARSER,
        options: {},
        mode: "primary",
        native: true,
      },
      "g6-scenario-tests": {
        name: "g6-scenario-tests",
        description: `Parse G6 JSON design files via g6-parser skill and generate scenario-based test cases (interface, process, entity, integration, E2E). Output: .opencode/g6/<projectId>/scenario-tests.md. Does not write code or run tests.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            question: "allow",
            skill: "allow",
            // write tool is gated by "edit" permission in permission/next.ts (EDIT_TOOLS)
            edit: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_G6_SCENARIO_TESTS,
        options: {},
        mode: "primary",
        native: true,
      },
      "g6-scenario-test-runner": {
        name: "g6-scenario-test-runner",
        description: `Execute scenario test document (scenario-tests.md), run checks against the codebase, and judge whether each scenario is satisfied. Output: .opencode/g6/<projectId>/scenario-test-results.json.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            bash: "allow",
            question: "allow",
            edit: {
              "*": "deny",
              ".opencode/g6/**": "allow",
              "**/src/test/scenario/**": "allow",
            },
            write: {
              "*": "deny",
              ".opencode/g6/**": "allow",
              "**/src/test/scenario/**": "allow",
            },
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_G6_SCENARIO_TEST_RUNNER,
        options: {},
        mode: "primary",
        native: true,
      },
      "ddd-to-g6": {
        name: "ddd-to-g6",
        description: `Generate G6 JSON from DDD design artifacts; requires product-asset template docx or product-assets.json. Reads .opencode/ddd/designs/<projectId>/ and writes .opencode/g6/<projectId>/design.json. May use all skills (docx, g6-parser, ddd-to-g6-with-docx).`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            list: "allow",
            skill: "allow",
            bash: "allow",
            edit: {
              "*": "deny",
              ".opencode/g6/**": "allow",
            },
            write: {
              "*": "deny",
              ".opencode/g6/**": "allow",
            },
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_DDD_TO_G6,
        options: {},
        mode: "primary",
        native: true,
      },
      "product-asset-extractor": {
        name: "product-asset-extractor",
        description: `Parse Word or Markdown documents to extract product assets (layout assets, page assets) and generate structured JSON output.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            write: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            skill: "allow",
            bash: "allow",
            external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          }),
          user,
        ),
        prompt: PROMPT_PRODUCT_ASSET_EXTRACTOR,
        options: {},
        mode: "primary",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
      fix: {
        name: "fix",
        description: `Specialized agent for analyzing and fixing code errors, compilation issues, and runtime problems. Use this agent when you encounter errors that need investigation and repair.`,
        mode: "primary",
        options: {},
        native: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            sql: "allow",
            config_reader: "allow",
            read: "allow",
            edit: "allow",
            bash: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            sequential_thinking: "allow",
          }),
          user,
        ),
        prompt: PROMPT_FIX,
      },
      deepagent: {
        name: "deepagent",
        description: `Orchestrator agent for coordinating multiple agents in sequential workflows. Use this agent when you need to execute a sequence of agents (e.g., fix -> test -> git commit) with conditional logic and error handling.`,
        mode: "all",
        options: {},
        native: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            orchestrate: "allow",
            task: "allow",
            read: "allow",
            bash: "allow",
            glob: "allow",
            list: "allow",
          }),
          user,
        ),
        prompt: PROMPT_DEEPAGENT,
      },
      coding: {
        name: "coding",
        description: `Specialized agent for automatically completing TODO tasks in code. This agent identifies TODOs, creates implementation plans, implements code, generates unit tests, fixes errors, and commits changes.`,
        mode: "all",
        options: {},
        native: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            orchestrate: "allow",
            task: "allow",
            read: "allow",
            edit: "allow",
            write: "allow",
            bash: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            todoread: "allow",
            todowrite: "allow",
            plan_enter: "allow",
            plan_exit: "allow",
            sequential_thinking: "allow",
          }),
          user,
        ),
        prompt: PROMPT_CODING,
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    // Ensure Truncate.DIR is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
