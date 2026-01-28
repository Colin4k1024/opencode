import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_PLAN from "./template/plan.txt"
import PROMPT_BUILD_FIX from "./template/build-fix.txt"
import PROMPT_TDD from "./template/tdd.txt"
import PROMPT_SPECKIT_INIT from "./template/speckit-init.txt"
import PROMPT_SPECKIT_CONSTITUTION from "./template/speckit-constitution.txt"
import PROMPT_SPECKIT_SPECIFY from "./template/speckit-specify.txt"
import PROMPT_SPECKIT_PLAN from "./template/speckit-plan.txt"
import PROMPT_SPECKIT_TASKS from "./template/speckit-tasks.txt"
import PROMPT_SPECKIT_IMPLEMENT from "./template/speckit-implement.txt"
import PROMPT_SPECKIT_INGEST from "./template/speckit-ingest.txt"
import PROMPT_SPECKIT_VIBE from "./template/speckit-vibe.txt"
import PROMPT_DDD_VIBE from "./template/ddd-vibe.txt"
import PROMPT_G6_IMPLEMENT from "./template/g6-implement.txt"
import PROMPT_DDD_INIT from "./template/ddd-init.txt"
import PROMPT_DDD_CONSTITUTION from "./template/ddd-constitution.txt"
import PROMPT_DDD_INGEST from "./template/ddd-ingest.txt"
import PROMPT_DDD_REQUIREMENTS from "./template/ddd-requirements.txt"
import PROMPT_DDD_DOMAINS from "./template/ddd-domains.txt"
import PROMPT_DDD_CONTEXTS from "./template/ddd-contexts.txt"
import PROMPT_DDD_MAPPING from "./template/ddd-mapping.txt"
import PROMPT_DDD_STRATEGIC from "./template/ddd-strategic.txt"
import PROMPT_DDD_ENTITIES from "./template/ddd-entities.txt"
import PROMPT_DDD_VALUE_OBJECTS from "./template/ddd-value-objects.txt"
import PROMPT_DDD_AGGREGATES from "./template/ddd-aggregates.txt"
import PROMPT_DDD_REPOSITORIES from "./template/ddd-repositories.txt"
import PROMPT_DDD_EVENTS from "./template/ddd-events.txt"
import PROMPT_DDD_TACTICAL from "./template/ddd-tactical.txt"
import PROMPT_DDD_APP_SERVICES from "./template/ddd-app-services.txt"
import PROMPT_DDD_DOMAIN_SERVICES from "./template/ddd-domain-services.txt"
import PROMPT_DDD_BOUNDARIES from "./template/ddd-boundaries.txt"
import PROMPT_DDD_SERVICES from "./template/ddd-services.txt"
import PROMPT_DDD_DESIGN from "./template/ddd-design.txt"
import PROMPT_DDD_IMPLEMENT from "./template/ddd-implement.txt"
import PROMPT_PRODUCT_ASSET_EXTRACT from "./template/product-asset-extract.txt"
import { MCP } from "../mcp"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      mcp: z.boolean().optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
      handler: z.string().optional().describe("Built-in handler: e.g. 'learn' for /learn"),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    PLAN: "plan",
    CODE_REVIEW: "code-review",
    BUILD_FIX: "build-fix",
    TDD: "tdd",
    LEARN: "learn",
    SPECKIT_INIT: "speckit.init",
    SPECKIT_CONSTITUTION: "speckit.constitution",
    SPECKIT_SPECIFY: "speckit.specify",
    SPECKIT_PLAN: "speckit.plan",
    SPECKIT_TASKS: "speckit.tasks",
    SPECKIT_IMPLEMENT: "speckit.implement",
    SPECKIT_INGEST: "speckit.ingest",
    SPECKIT_VIBE: "speckit.vibe",
    DDD_INIT: "ddd.init",
    DDD_CONSTITUTION: "ddd.constitution",
    DDD_INGEST: "ddd.ingest",
    DDD_REQUIREMENTS: "ddd.requirements",
    DDD_DOMAINS: "ddd.domains",
    DDD_CONTEXTS: "ddd.contexts",
    DDD_MAPPING: "ddd.mapping",
    DDD_STRATEGIC: "ddd.strategic",
    DDD_ENTITIES: "ddd.entities",
    DDD_VALUE_OBJECTS: "ddd.value-objects",
    DDD_AGGREGATES: "ddd.aggregates",
    DDD_REPOSITORIES: "ddd.repositories",
    DDD_EVENTS: "ddd.events",
    DDD_TACTICAL: "ddd.tactical",
    DDD_APP_SERVICES: "ddd.app-services",
    DDD_DOMAIN_SERVICES: "ddd.domain-services",
    DDD_BOUNDARIES: "ddd.boundaries",
    DDD_SERVICES: "ddd.services",
    DDD_DESIGN: "ddd.design",
    DDD_IMPLEMENT: "ddd.implement",
    DDD_VIBE: "ddd.vibe",
    G6_IMPLEMENT: "g6.implement",
    PRODUCT_ASSET_EXTRACT: "product-asset.extract",
  } as const

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
      [Default.PLAN]: {
        name: Default.PLAN,
        description: "have the planner agent break down requirements and suggest an implementation path",
        agent: "planner",
        get template() {
          return PROMPT_PLAN
        },
        hints: hints(PROMPT_PLAN),
      },
      [Default.CODE_REVIEW]: {
        name: Default.CODE_REVIEW,
        description: "start code review with the code-reviewer agent",
        agent: "code-reviewer",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
      [Default.BUILD_FIX]: {
        name: Default.BUILD_FIX,
        description: "fix build errors with the fix agent",
        agent: "fix",
        get template() {
          return PROMPT_BUILD_FIX
        },
        hints: hints(PROMPT_BUILD_FIX),
      },
      [Default.TDD]: {
        name: Default.TDD,
        description: "start TDD workflow with the tdd-guide agent",
        agent: "tdd-guide",
        get template() {
          return PROMPT_TDD
        },
        hints: hints(PROMPT_TDD),
      },
      [Default.LEARN]: {
        name: Default.LEARN,
        description: "extract patterns from this session into a new Skill",
        handler: "learn",
        get template() {
          return "$ARGUMENTS"
        },
        hints: ["$ARGUMENTS"],
      },
      [Default.SPECKIT_INIT]: {
        name: Default.SPECKIT_INIT,
        description: "initialize a speckit feature workspace under .opencode/speckit/",
        agent: "speckit",
        get template() {
          return PROMPT_SPECKIT_INIT
        },
        hints: hints(PROMPT_SPECKIT_INIT),
      },
      [Default.SPECKIT_CONSTITUTION]: {
        name: Default.SPECKIT_CONSTITUTION,
        description: "create/update .opencode/speckit/constitution.md",
        agent: "speckit",
        get template() {
          return PROMPT_SPECKIT_CONSTITUTION
        },
        hints: hints(PROMPT_SPECKIT_CONSTITUTION),
      },
      [Default.SPECKIT_SPECIFY]: {
        name: Default.SPECKIT_SPECIFY,
        description: "generate/update spec.md for the current speckit feature",
        agent: "speckit",
        get template() {
          return PROMPT_SPECKIT_SPECIFY
        },
        hints: hints(PROMPT_SPECKIT_SPECIFY),
      },
      [Default.SPECKIT_PLAN]: {
        name: Default.SPECKIT_PLAN,
        description: "generate/update plan.md for the current speckit feature",
        agent: "speckit",
        get template() {
          return PROMPT_SPECKIT_PLAN
        },
        hints: hints(PROMPT_SPECKIT_PLAN),
      },
      [Default.SPECKIT_TASKS]: {
        name: Default.SPECKIT_TASKS,
        description: "generate/update tasks.md from plan.md for the current speckit feature",
        agent: "speckit",
        get template() {
          return PROMPT_SPECKIT_TASKS
        },
        hints: hints(PROMPT_SPECKIT_TASKS),
      },
      [Default.SPECKIT_IMPLEMENT]: {
        name: Default.SPECKIT_IMPLEMENT,
        description: "implement tasks.md for the current speckit feature (hands off to coding agent)",
        agent: "coding",
        get template() {
          return PROMPT_SPECKIT_IMPLEMENT
        },
        hints: hints(PROMPT_SPECKIT_IMPLEMENT),
      },
      [Default.SPECKIT_INGEST]: {
        name: Default.SPECKIT_INGEST,
        description: "ingest requirement docs (files/paste/urls) and write sources.md + requirements.md (REQ-IDs)",
        agent: "speckit",
        get template() {
          return PROMPT_SPECKIT_INGEST
        },
        hints: hints(PROMPT_SPECKIT_INGEST),
      },
      [Default.SPECKIT_VIBE]: {
        name: Default.SPECKIT_VIBE,
        description: "doc-driven speckit vibecoding (clarify → requirements → spec/plan/tasks → auto implement)",
        agent: "speckit-vibe",
        get template() {
          return PROMPT_SPECKIT_VIBE
        },
        hints: hints(PROMPT_SPECKIT_VIBE),
      },
      [Default.DDD_INIT]: {
        name: Default.DDD_INIT,
        description: "initialize a DDD workspace under .opencode/ddd/",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_INIT
        },
        hints: hints(PROMPT_DDD_INIT),
      },
      [Default.DDD_CONSTITUTION]: {
        name: Default.DDD_CONSTITUTION,
        description: "create/update .opencode/ddd/ddd-constitution.md",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_CONSTITUTION
        },
        hints: hints(PROMPT_DDD_CONSTITUTION),
      },
      [Default.DDD_INGEST]: {
        name: Default.DDD_INGEST,
        description: "ingest requirement docs (files/paste/urls) and write sources.md + requirements.md (REQ-IDs)",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_INGEST
        },
        hints: hints(PROMPT_DDD_INGEST),
      },
      [Default.DDD_REQUIREMENTS]: {
        name: Default.DDD_REQUIREMENTS,
        description: "refine and validate requirements for DDD analysis",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_REQUIREMENTS
        },
        hints: hints(PROMPT_DDD_REQUIREMENTS),
      },
      [Default.DDD_DOMAINS]: {
        name: Default.DDD_DOMAINS,
        description: "perform domain analysis and classification (core, supporting, generic)",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_DOMAINS
        },
        hints: hints(PROMPT_DDD_DOMAINS),
      },
      [Default.DDD_CONTEXTS]: {
        name: Default.DDD_CONTEXTS,
        description: "define bounded contexts with boundaries and ubiquitous language",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_CONTEXTS
        },
        hints: hints(PROMPT_DDD_CONTEXTS),
      },
      [Default.DDD_MAPPING]: {
        name: Default.DDD_MAPPING,
        description: "create context mapping showing relationships between bounded contexts",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_MAPPING
        },
        hints: hints(PROMPT_DDD_MAPPING),
      },
      [Default.DDD_STRATEGIC]: {
        name: Default.DDD_STRATEGIC,
        description: "integrate strategic DDD design (domains, bounded contexts, context mapping)",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_STRATEGIC
        },
        hints: hints(PROMPT_DDD_STRATEGIC),
      },
      [Default.DDD_ENTITIES]: {
        name: Default.DDD_ENTITIES,
        description: "design entities with identity, attributes, behaviors, and invariants",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_ENTITIES
        },
        hints: hints(PROMPT_DDD_ENTITIES),
      },
      [Default.DDD_VALUE_OBJECTS]: {
        name: Default.DDD_VALUE_OBJECTS,
        description: "design value objects with immutability and validation",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_VALUE_OBJECTS
        },
        hints: hints(PROMPT_DDD_VALUE_OBJECTS),
      },
      [Default.DDD_AGGREGATES]: {
        name: Default.DDD_AGGREGATES,
        description: "design aggregates with boundaries and invariants",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_AGGREGATES
        },
        hints: hints(PROMPT_DDD_AGGREGATES),
      },
      [Default.DDD_REPOSITORIES]: {
        name: Default.DDD_REPOSITORIES,
        description: "design repository interfaces for aggregate persistence",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_REPOSITORIES
        },
        hints: hints(PROMPT_DDD_REPOSITORIES),
      },
      [Default.DDD_EVENTS]: {
        name: Default.DDD_EVENTS,
        description: "design domain events with payloads and subscribers",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_EVENTS
        },
        hints: hints(PROMPT_DDD_EVENTS),
      },
      [Default.DDD_TACTICAL]: {
        name: Default.DDD_TACTICAL,
        description: "integrate tactical DDD design (entities, value objects, aggregates, repositories, events)",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_TACTICAL
        },
        hints: hints(PROMPT_DDD_TACTICAL),
      },
      [Default.DDD_APP_SERVICES]: {
        name: Default.DDD_APP_SERVICES,
        description: "design application services for use case orchestration",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_APP_SERVICES
        },
        hints: hints(PROMPT_DDD_APP_SERVICES),
      },
      [Default.DDD_DOMAIN_SERVICES]: {
        name: Default.DDD_DOMAIN_SERVICES,
        description: "design domain services with interfaces and dependencies",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_DOMAIN_SERVICES
        },
        hints: hints(PROMPT_DDD_DOMAIN_SERVICES),
      },
      [Default.DDD_BOUNDARIES]: {
        name: Default.DDD_BOUNDARIES,
        description: "design service boundaries and integration points",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_BOUNDARIES
        },
        hints: hints(PROMPT_DDD_BOUNDARIES),
      },
      [Default.DDD_SERVICES]: {
        name: Default.DDD_SERVICES,
        description: "integrate service design (application services, domain services, boundaries)",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_SERVICES
        },
        hints: hints(PROMPT_DDD_SERVICES),
      },
      [Default.DDD_DESIGN]: {
        name: Default.DDD_DESIGN,
        description: "generate complete DDD design document by synthesizing all design artifacts",
        agent: "ddd",
        get template() {
          return PROMPT_DDD_DESIGN
        },
        hints: hints(PROMPT_DDD_DESIGN),
      },
      [Default.DDD_IMPLEMENT]: {
        name: Default.DDD_IMPLEMENT,
        description: "automatically generate complete code implementation based on DDD design documents",
        agent: "ddd-implement",
        get template() {
          return PROMPT_DDD_IMPLEMENT
        },
        hints: hints(PROMPT_DDD_IMPLEMENT),
      },
      [Default.DDD_VIBE]: {
        name: Default.DDD_VIBE,
        description: "interactive DDD vibecoding (clarify → requirements → strategic/tactical/services → auto implement)",
        agent: "ddd-vibe",
        get template() {
          return PROMPT_DDD_VIBE
        },
        hints: hints(PROMPT_DDD_VIBE),
      },
      [Default.G6_IMPLEMENT]: {
        name: Default.G6_IMPLEMENT,
        description: "parse G6 JSON design file and generate code implementation",
        agent: "g6-parser",
        get template() {
          return PROMPT_G6_IMPLEMENT
        },
        hints: hints(PROMPT_G6_IMPLEMENT),
      },
      [Default.PRODUCT_ASSET_EXTRACT]: {
        name: Default.PRODUCT_ASSET_EXTRACT,
        description: "extract product assets from Word or Markdown documents and generate JSON",
        agent: "product-asset-extractor",
        get template() {
          return PROMPT_PRODUCT_ASSET_EXTRACT
        },
        hints: hints(PROMPT_PRODUCT_ASSET_EXTRACT),
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        mcp: true,
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
