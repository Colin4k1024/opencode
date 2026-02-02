import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./sequential-thinking.txt"
import { Storage } from "../storage/storage"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"

export namespace SequentialThinking {
  export const Thought = z
    .object({
      number: z.number().int().positive().describe("Thought number in the sequence"),
      content: z.string().describe("The thought content"),
      timestamp: z.number().describe("Timestamp when the thought was added"),
      isRevision: z.boolean().optional().describe("Whether this thought revises a previous thought"),
      revisesThought: z.number().int().positive().optional().describe("The thought number being revised"),
      branchFromThought: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("The thought number this branch originates from"),
      branchId: z.string().optional().describe("Identifier for the branch"),
    })
    .meta({ ref: "Thought" })
  export type Thought = z.infer<typeof Thought>

  export const Chain = z
    .object({
      thoughts: z.array(Thought).describe("Array of thoughts in the chain"),
      totalThoughts: z.number().int().positive().describe("Total number of thoughts estimated"),
      currentBranch: z.string().optional().describe("Current branch identifier"),
      createdAt: z.number().describe("Timestamp when the chain was created"),
      updatedAt: z.number().describe("Timestamp when the chain was last updated"),
    })
    .meta({ ref: "ThoughtChain" })
  export type Chain = z.infer<typeof Chain>

  export const Event = {
    Updated: BusEvent.define(
      "sequential_thinking.updated",
      z.object({
        sessionID: z.string(),
        chain: Chain,
      }),
    ),
  }

  export async function update(input: { sessionID: string; chain: Chain }) {
    await Storage.write(["sequential_thinking", input.sessionID], input.chain)
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: string): Promise<Chain | null> {
    return Storage.read<Chain>(["sequential_thinking", sessionID])
      .then((x) => x || null)
      .catch(() => null)
  }

  export function formatChain(chain: Chain): string {
    const lines: string[] = []
    lines.push(`Sequential Thinking Chain (${chain.thoughts.length}/${chain.totalThoughts} thoughts)`)
    lines.push("=".repeat(60))

    for (const thought of chain.thoughts) {
      const prefix = thought.isRevision ? "[REVISION]" : thought.branchFromThought ? "[BRANCH]" : ""
      lines.push(`\nThought ${thought.number}${prefix ? ` ${prefix}` : ""}:`)
      if (thought.revisesThought) {
        lines.push(`  (Revises Thought ${thought.revisesThought})`)
      }
      if (thought.branchFromThought) {
        lines.push(
          `  (Branches from Thought ${thought.branchFromThought}${thought.branchId ? `, Branch: ${thought.branchId}` : ""})`,
        )
      }
      lines.push(`  ${thought.content}`)
    }

    if (chain.currentBranch) {
      lines.push(`\nCurrent Branch: ${chain.currentBranch}`)
    }

    lines.push("\n" + "=".repeat(60))
    return lines.join("\n")
  }
}

const parameters = z.object({
  thought: z
    .string()
    .describe(
      "Your current thinking step, which can include analytical steps, revisions, questions, hypothesis generation, or verification",
    ),
  thoughtNumber: z
    .number()
    .int()
    .positive()
    .describe("Current number in the sequence (can exceed initial estimate if needed)"),
  totalThoughts: z
    .number()
    .int()
    .positive()
    .describe("Current estimate of total thoughts needed (adjustable up or down)"),
  nextThoughtNeeded: z.boolean().describe("Whether another thought step is required, even at what seemed like the end"),
  isRevision: z.boolean().optional().describe("Whether this thought revises previous thinking"),
  revisesThought: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Which thought number is being reconsidered if revising"),
  branchFromThought: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Which thought number serves as the branching point"),
  branchId: z.string().optional().describe("Identifier for the current branch (if any)"),
  needsMoreThoughts: z
    .boolean()
    .optional()
    .describe("Flag for realizing more thoughts are needed upon reaching the apparent end"),
})

export const SequentialThinkingTool = Tool.define("sequential_thinking", {
  description: DESCRIPTION,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const existingChain = await SequentialThinking.get(ctx.sessionID)
    const now = Date.now()

    let chain: SequentialThinking.Chain
    if (!existingChain) {
      // Create new chain
      chain = {
        thoughts: [],
        totalThoughts: params.totalThoughts,
        currentBranch: params.branchId,
        createdAt: now,
        updatedAt: now,
      }
    } else {
      // Update existing chain
      chain = {
        ...existingChain,
        totalThoughts: params.totalThoughts,
        updatedAt: now,
      }
      if (params.branchId) {
        chain.currentBranch = params.branchId
      }
    }

    // Validate thought number
    if (params.isRevision && params.revisesThought) {
      const revisesThought = chain.thoughts.find((t) => t.number === params.revisesThought)
      if (!revisesThought) {
        throw new Error(`Cannot revise thought ${params.revisesThought}: thought not found`)
      }
    }

    if (params.branchFromThought) {
      const branchFromThought = chain.thoughts.find((t) => t.number === params.branchFromThought)
      if (!branchFromThought) {
        throw new Error(`Cannot branch from thought ${params.branchFromThought}: thought not found`)
      }
    }

    // Add or update thought
    const existingThoughtIndex = chain.thoughts.findIndex((t) => t.number === params.thoughtNumber)
    const newThought: SequentialThinking.Thought = {
      number: params.thoughtNumber,
      content: params.thought,
      timestamp: now,
      isRevision: params.isRevision,
      revisesThought: params.revisesThought,
      branchFromThought: params.branchFromThought,
      branchId: params.branchId,
    }

    if (existingThoughtIndex >= 0) {
      // Update existing thought
      chain.thoughts[existingThoughtIndex] = newThought
    } else {
      // Add new thought
      chain.thoughts.push(newThought)
      // Sort by thought number
      chain.thoughts.sort((a, b) => a.number - b.number)
    }

    // Update total thoughts if needed
    if (params.needsMoreThoughts && params.thoughtNumber >= chain.totalThoughts) {
      chain.totalThoughts = params.thoughtNumber + 1
    }

    // Save chain
    await SequentialThinking.update({
      sessionID: ctx.sessionID,
      chain,
    })

    // Generate summary
    const summary = SequentialThinking.formatChain(chain)
    const status = params.nextThoughtNeeded
      ? `Thought ${params.thoughtNumber} added. Continue with thought ${params.thoughtNumber + 1}.`
      : `Thought ${params.thoughtNumber} added. Thinking chain complete.`

    return {
      title: `Sequential Thinking - Thought ${params.thoughtNumber}/${chain.totalThoughts}`,
      output: `${status}\n\n${summary}`,
      metadata: {
        chain,
        thoughtNumber: params.thoughtNumber,
        totalThoughts: chain.totalThoughts,
        nextThoughtNeeded: params.nextThoughtNeeded,
        isComplete: !params.nextThoughtNeeded,
      },
    }
  },
})
