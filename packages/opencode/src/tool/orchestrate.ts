import { Tool } from "./tool"
import DESCRIPTION from "./orchestrate.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { $ } from "bun"

const stepSchema = z.object({
  id: z.string().describe("Unique identifier for this step"),
  agent: z.string().describe("Name of the agent to call (e.g., 'fix', 'test', 'git')"),
  prompt: z.string().describe("Prompt/instruction to send to the agent"),
  condition: z
    .object({
      type: z.enum(["git_exists", "test_passed", "custom"]).describe("Type of condition to check"),
      check: z.string().describe("Bash command or check logic (for custom type)"),
    })
    .optional()
    .describe("Optional condition to check before executing this step"),
  on_success: z
    .string()
    .nullable()
    .optional()
    .describe("ID of the next step to execute on success (null to end workflow)"),
  on_failure: z
    .union([z.literal("stop"), z.literal("continue"), z.string()])
    .optional()
    .describe("What to do on failure: 'stop' to stop workflow, 'continue' to continue, or step ID to jump to"),
})

const parameters = z.object({
  workflow: z.object({
    name: z.string().describe("Name of the workflow"),
    steps: z.array(stepSchema).describe("Array of workflow steps to execute"),
  }),
})

async function checkCondition(
  condition: { type: "git_exists" | "test_passed" | "custom"; check: string },
  ctx: Tool.Context,
): Promise<boolean> {
  const cwd = Instance.worktree

  switch (condition.type) {
    case "git_exists": {
      // Check if .git directory exists
      try {
        const result = await $`test -d .git && echo 'exists' || echo 'not_exists'`.cwd(cwd).quiet().text()
        return result.trim().includes("exists")
      } catch (error) {
        return false
      }
    }

    case "test_passed": {
      // Run the test command and check if it passes
      const testCommand = condition.check || "npm test"
      try {
        // Execute the test command and check exit code
        // Use .nothrow() to capture exit code, then check
        const result = await $`${testCommand}`.cwd(cwd).quiet().nothrow()
        return result.exitCode === 0
      } catch (error) {
        // Test command failed (non-zero exit code or error)
        return false
      }
    }

    case "custom": {
      // Execute custom bash command
      try {
        await $`${condition.check}`.cwd(cwd).quiet()
        return true
      } catch (error) {
        return false
      }
    }

    default:
      return false
  }
}

/**
 * Determine the phase for a workflow step in coding agent workflows
 * Returns the phase name if this is a coding workflow, undefined otherwise
 */
function getPhase(
  step: z.infer<typeof stepSchema>,
  workflowName: string,
): "plan" | "build" | "test" | "fix" | undefined {
  // Only apply phase detection to coding agent workflows
  const isCodingWorkflow =
    workflowName.toLowerCase().includes("coding") ||
    workflowName.toLowerCase().includes("todo") ||
    workflowName.toLowerCase().includes("coding-todo")

  if (!isCodingWorkflow) {
    return undefined
  }

  // Check step ID for phase prefix (plan_*, build_*, test_*, fix_*)
  const stepIdLower = step.id.toLowerCase()
  if (stepIdLower.startsWith("plan_")) return "plan"
  if (stepIdLower.startsWith("build_")) return "build"
  if (stepIdLower.startsWith("test_")) return "test"
  if (stepIdLower.startsWith("fix_")) return "fix"

  // Fallback: determine phase from agent type
  if (step.agent === "plan") return "plan"
  if (step.agent === "build") return "build"
  if (step.agent === "fix") return "fix"
  if (step.agent === "general") {
    // Check prompt for test-related keywords
    const testKeywords = ["test", "测试", "unit test", "pytest", "jest", "mocha", "vitest", "junit"]
    const promptLower = step.prompt.toLowerCase()
    if (testKeywords.some((keyword) => promptLower.includes(keyword))) {
      return "test"
    }
  }

  return undefined
}

interface StepResult {
  success: boolean
  output: string
  sessionID?: string
  skipped?: boolean
  toolCalls?: Array<{
    tool: string
    status: string
    title?: string
    output?: string
  }>
  fileChanges?: Array<{
    files: string[]
    hash: string
  }>
  outputText?: string
}

interface ExitConditions {
  maxStepDuration: number // Single step max execution time (ms)
  maxIterations: number // Max total iterations
  maxConsecutiveFailures: number // Max consecutive failures
  maxTotalDuration: number // Workflow total max execution time (ms)
}

interface ExitCheckResult {
  shouldExit: boolean
  reason?: string
}

function checkExitConditions(
  conditions: ExitConditions,
  stepDuration: number,
  totalDuration: number,
  iterationCount: number,
  consecutiveFailures: number,
): ExitCheckResult {
  if (stepDuration > conditions.maxStepDuration) {
    return {
      shouldExit: true,
      reason: `Step timeout: ${(stepDuration / 1000 / 60).toFixed(1)} minutes > ${(conditions.maxStepDuration / 1000 / 60).toFixed(1)} minutes`,
    }
  }
  if (totalDuration > conditions.maxTotalDuration) {
    return {
      shouldExit: true,
      reason: `Total timeout: ${(totalDuration / 1000 / 60).toFixed(1)} minutes > ${(conditions.maxTotalDuration / 1000 / 60).toFixed(1)} minutes`,
    }
  }
  if (iterationCount > conditions.maxIterations) {
    return {
      shouldExit: true,
      reason: `Max iterations reached: ${iterationCount} > ${conditions.maxIterations}`,
    }
  }
  if (consecutiveFailures > conditions.maxConsecutiveFailures) {
    return {
      shouldExit: true,
      reason: `Max consecutive failures: ${consecutiveFailures} > ${conditions.maxConsecutiveFailures}`,
    }
  }
  return { shouldExit: false }
}

function getExitConditions(workflowName: string): ExitConditions {
  // Only apply exit conditions to coding agent workflows
  const isCodingWorkflow =
    workflowName.toLowerCase().includes("coding") ||
    workflowName.toLowerCase().includes("todo") ||
    workflowName.toLowerCase().includes("coding-todo")

  if (!isCodingWorkflow) {
    // Return very high limits for non-coding workflows (effectively disabled)
    return {
      maxStepDuration: Number.MAX_SAFE_INTEGER,
      maxIterations: Number.MAX_SAFE_INTEGER,
      maxConsecutiveFailures: Number.MAX_SAFE_INTEGER,
      maxTotalDuration: Number.MAX_SAFE_INTEGER,
    }
  }

  // Default exit conditions for coding agent workflows
  return {
    maxStepDuration: 30 * 60 * 1000, // 30 minutes
    maxIterations: 10, // 10 iterations
    maxConsecutiveFailures: 3, // 3 consecutive failures
    maxTotalDuration: 2 * 60 * 60 * 1000, // 2 hours
  }
}

async function extractStepInfo(sessionID: string): Promise<{
  toolCalls: StepResult["toolCalls"]
  fileChanges: StepResult["fileChanges"]
  outputText: string
}> {
  const toolCalls: StepResult["toolCalls"] = []
  const fileChanges: StepResult["fileChanges"] = []
  const textParts: string[] = []

  try {
    // Get all messages from the child session
    for await (const msg of MessageV2.stream(sessionID)) {
      if (msg.info.role !== "assistant") continue

      for (const part of msg.parts) {
        // Extract tool calls
        if (part.type === "tool") {
          toolCalls.push({
            tool: part.tool,
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
            output:
              part.state.status === "completed"
                ? part.state.output?.substring(0, 500) // Limit output length
                : undefined,
          })
        }

        // Extract file changes (patches)
        if (part.type === "patch") {
          fileChanges.push({
            files: part.files,
            hash: part.hash,
          })
        }

        // Extract text output
        if (part.type === "text" && !part.ignored && part.text) {
          textParts.push(part.text)
        }
      }
    }
  } catch (error) {
    // If we can't extract info, continue with empty arrays
    console.warn(`Failed to extract step info from session ${sessionID}:`, error)
  }

  return {
    toolCalls,
    fileChanges,
    outputText: textParts.join("\n\n"),
  }
}

async function executeStep(
  step: z.infer<typeof stepSchema>,
  workflowName: string,
  ctx: Tool.Context,
  stepResults: Map<string, StepResult>,
  stepIndex: number,
  totalSteps: number,
): Promise<StepResult> {
  // Determine phase for coding agent workflows
  const phase = getPhase(step, workflowName)
  const phaseLabel = phase ? ` - Phase: ${phase.charAt(0).toUpperCase() + phase.slice(1)}` : ""

  // Send progress update: starting step
  ctx.metadata({
    title: `Coding Agent${phaseLabel} - Step ${stepIndex + 1}/${totalSteps}: ${step.id} (@${step.agent})`,
    metadata: {
      workflow: workflowName,
      phase,
      currentStep: step.id,
      stepIndex: stepIndex + 1,
      totalSteps,
      status: "executing",
      agent: step.agent,
    },
  })

  // Check condition if present
  if (step.condition) {
    const conditionMet = await checkCondition(step.condition, ctx)
    if (!conditionMet) {
      const phase = getPhase(step, workflowName)
      const phaseLabel = phase ? ` - Phase: ${phase.charAt(0).toUpperCase() + phase.slice(1)}` : ""

      ctx.metadata({
        title: `Coding Agent${phaseLabel} - Skipped Step ${stepIndex + 1}/${totalSteps}: ${step.id}`,
        metadata: {
          workflow: workflowName,
          phase,
          currentStep: step.id,
          stepIndex: stepIndex + 1,
          totalSteps,
          status: "skipped",
          agent: step.agent,
        },
      })
      return {
        success: true, // Condition not met is not a failure, just a skip
        output: `Condition not met: ${step.condition.type}. Skipping step ${step.id}.`,
        skipped: true,
      }
    }
  }

  // Get the agent
  const agent = await Agent.get(step.agent)
  if (!agent) {
    throw new Error(`Unknown agent: ${step.agent}`)
  }

  const config = await Config.get()

  // Create a child session for this step
  const session = await Session.create({
    parentID: ctx.sessionID,
    title: `${workflowName} - Step: ${step.id} (@${agent.name})`,
    permission: [
      {
        permission: "todowrite",
        pattern: "*",
        action: "deny",
      },
      {
        permission: "todoread",
        pattern: "*",
        action: "deny",
      },
      {
        permission: "task",
        pattern: "*",
        action: "deny",
      },
      {
        permission: "orchestrate",
        pattern: "*",
        action: "deny",
      },
      ...(config.experimental?.primary_tools?.map((t) => ({
        pattern: "*",
        action: "allow" as const,
        permission: t,
      })) ?? []),
    ],
  })

  const messageID = Identifier.ascending("message")
  const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
  if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

  const model = agent.model ?? {
    modelID: msg.info.modelID,
    providerID: msg.info.providerID,
  }

  function cancel() {
    SessionPrompt.cancel(session.id)
  }
  ctx.abort.addEventListener("abort", cancel)
  using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

  const promptParts = await SessionPrompt.resolvePromptParts(step.prompt)

  try {
    const result = await SessionPrompt.prompt({
      messageID,
      sessionID: session.id,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      agent: agent.name,
      tools: {
        todowrite: false,
        todoread: false,
        task: false,
        orchestrate: false,
        ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
      },
      parts: promptParts,
    })

    // Extract detailed information from the child session
    const stepInfo = await extractStepInfo(session.id)

    // Get the final text output
    const text = result.parts.findLast((x) => x.type === "text")?.text ?? stepInfo.outputText

    // Determine phase for coding agent workflows
    const phase = getPhase(step, workflowName)
    const phaseLabel = phase ? ` - Phase: ${phase.charAt(0).toUpperCase() + phase.slice(1)}` : ""

    // Send progress update: step completed
    ctx.metadata({
      title: `Coding Agent${phaseLabel} - Completed Step ${stepIndex + 1}/${totalSteps}: ${step.id}`,
      metadata: {
        workflow: workflowName,
        phase,
        currentStep: step.id,
        stepIndex: stepIndex + 1,
        totalSteps,
        status: "completed",
        agent: step.agent,
        toolCallsCount: stepInfo.toolCalls?.length ?? 0,
        fileChangesCount: stepInfo.fileChanges?.length ?? 0,
        progress: Math.round(((stepIndex + 1) / totalSteps) * 100),
      },
    })

    return {
      success: true,
      output: text,
      sessionID: session.id,
      toolCalls: stepInfo.toolCalls,
      fileChanges: stepInfo.fileChanges,
      outputText: stepInfo.outputText || text,
    }
  } catch (error) {
    // Send progress update: step failed
    ctx.metadata({
      title: `Failed ${workflowName} - Step ${stepIndex + 1}/${totalSteps}: ${step.id}`,
      metadata: {
        workflow: workflowName,
        currentStep: step.id,
        stepIndex: stepIndex + 1,
        totalSteps,
        status: "failed",
        agent: step.agent,
        error: error instanceof Error ? error.message : String(error),
      },
    })

    return {
      success: false,
      output: `Step ${step.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      sessionID: session.id,
    }
  }
}

export const OrchestrateTool = Tool.define("orchestrate", {
  description: DESCRIPTION,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const workflow = params.workflow
    const stepResults = new Map<string, StepResult>()
    const stepMap = new Map(workflow.steps.map((step) => [step.id, step]))
    const totalSteps = workflow.steps.length

    // Build progressive output for real-time feedback
    const outputParts: string[] = []
    const startTime = Date.now()

    // Send initial metadata with output preview
    outputParts.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
    outputParts.push(`🚀 [开始] 工作流 "${workflow.name}" 执行\n`)
    outputParts.push(`   总步骤数: ${totalSteps}\n`)
    outputParts.push(`   开始时间: ${new Date(startTime).toLocaleTimeString()}\n`)
    outputParts.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`)
    ctx.metadata({
      title: `Starting workflow: ${workflow.name}`,
      metadata: {
        workflow: workflow.name,
        totalSteps,
        status: "starting",
        startTime,
        currentOutput: outputParts.join(""),
        progress: 0,
      },
    })

    let currentStepId: string | null = workflow.steps[0]?.id || null
    const executedSteps: string[] = []
    const exitConditions = getExitConditions(workflow.name)
    let consecutiveFailures = 0
    let iterationCount = 0

    while (currentStepId) {
      if (executedSteps.includes(currentStepId)) {
        // Prevent infinite loops
        break
      }
      executedSteps.push(currentStepId)
      iterationCount++

      // Check exit conditions before starting new step
      const totalDurationBeforeStep = Date.now() - startTime
      const exitCheckBeforeStep = checkExitConditions(
        exitConditions,
        0,
        totalDurationBeforeStep,
        iterationCount,
        consecutiveFailures,
      )
      if (exitCheckBeforeStep.shouldExit) {
        outputParts.push(`\n${"─".repeat(60)}\n`)
        outputParts.push(`⚠️  [退出] 工作流因退出条件而终止\n`)
        outputParts.push(`   原因: ${exitCheckBeforeStep.reason}\n`)
        outputParts.push(`   已执行步骤: ${executedSteps.length}/${totalSteps}\n`)
        outputParts.push(`   总耗时: ${(totalDurationBeforeStep / 1000 / 60).toFixed(1)} 分钟\n`)
        outputParts.push(`${"─".repeat(60)}\n`)

        ctx.metadata({
          title: `Workflow exited: ${workflow.name}`,
          metadata: {
            workflow: workflow.name,
            status: "exited",
            exitReason: exitCheckBeforeStep.reason,
            executedSteps: executedSteps.length,
            totalSteps,
            totalDuration: totalDurationBeforeStep,
            iterationCount,
            consecutiveFailures,
            currentOutput: outputParts.join(""),
            progress: Math.round((executedSteps.length / totalSteps) * 100),
          },
        })
        break
      }

      const step = stepMap.get(currentStepId)
      if (!step) {
        break
      }

      const stepIndex = executedSteps.length
      const stepStartTime = Date.now()

      // Output step start information
      // Determine phase for coding agent workflows
      const phase = getPhase(step, workflow.name)
      const phaseLabel = phase ? ` - Phase: ${phase.charAt(0).toUpperCase() + phase.slice(1)}` : ""

      outputParts.push(`\n${"─".repeat(60)}\n`)
      outputParts.push(`📋 [步骤 ${stepIndex}/${totalSteps}] 开始执行${phase ? ` (${phase})` : ""}\n`)
      outputParts.push(`   步骤ID: ${step.id}\n`)
      outputParts.push(`   执行Agent: @${step.agent}\n`)
      if (phase) {
        outputParts.push(`   阶段: ${phase.charAt(0).toUpperCase() + phase.slice(1)}\n`)
      }
      outputParts.push(`   开始时间: ${new Date(stepStartTime).toLocaleTimeString()}\n`)
      outputParts.push(`${"─".repeat(60)}\n`)
      ctx.metadata({
        title: `Coding Agent${phaseLabel} - Step ${stepIndex}/${totalSteps}: ${step.id}`,
        metadata: {
          workflow: workflow.name,
          phase,
          currentStep: step.id,
          stepIndex,
          totalSteps,
          status: "executing",
          agent: step.agent,
          progress: Math.round(((stepIndex - 1) / totalSteps) * 100),
          currentOutput: outputParts.join(""),
          executedSteps: executedSteps.length,
        },
      })

      const result = await executeStep(step, workflow.name, ctx, stepResults, stepIndex, totalSteps)
      stepResults.set(step.id, result)

      const stepDuration = Date.now() - stepStartTime
      const totalDurationAfterStep = Date.now() - startTime
      const statusIcon = result.success ? "✓" : "✗"
      const statusText = result.success ? "Success" : "Failed"

      // Update failure tracking
      if (result.success) {
        consecutiveFailures = 0
      } else if (!result.skipped) {
        consecutiveFailures++
      }

      // Check exit conditions after step completion
      const exitCheckAfterStep = checkExitConditions(
        exitConditions,
        stepDuration,
        totalDurationAfterStep,
        iterationCount,
        consecutiveFailures,
      )
      if (exitCheckAfterStep.shouldExit) {
        outputParts.push(`\n${"─".repeat(60)}\n`)
        outputParts.push(`⚠️  [退出] 工作流因退出条件而终止\n`)
        outputParts.push(`   原因: ${exitCheckAfterStep.reason}\n`)
        outputParts.push(`   当前步骤: ${step.id} (${statusText})\n`)
        outputParts.push(`   已执行步骤: ${executedSteps.length}/${totalSteps}\n`)
        outputParts.push(`   总耗时: ${(totalDurationAfterStep / 1000 / 60).toFixed(1)} 分钟\n`)
        outputParts.push(`${"─".repeat(60)}\n`)

        ctx.metadata({
          title: `Workflow exited: ${workflow.name}`,
          metadata: {
            workflow: workflow.name,
            status: "exited",
            exitReason: exitCheckAfterStep.reason,
            currentStep: step.id,
            stepStatus: result.success ? "completed" : "failed",
            executedSteps: executedSteps.length,
            totalSteps,
            totalDuration: totalDurationAfterStep,
            iterationCount,
            consecutiveFailures,
            currentOutput: outputParts.join(""),
            progress: Math.round((executedSteps.length / totalSteps) * 100),
            stepDetails: {
              success: result.success,
              skipped: result.skipped || false,
              duration: stepDuration,
            },
          },
        })
        break
      }

      // Output step completion information
      const durationSeconds = (stepDuration / 1000).toFixed(2)
      outputParts.push(`\n${statusIcon} [步骤 ${stepIndex}/${totalSteps}] 完成: ${step.id}\n`)
      outputParts.push(`   状态: ${statusText}\n`)
      outputParts.push(`   耗时: ${durationSeconds}秒 (${stepDuration}ms)\n`)
      outputParts.push(`   完成时间: ${new Date(Date.now()).toLocaleTimeString()}\n`)

      // Add tool calls summary
      if (result.toolCalls && result.toolCalls.length > 0) {
        outputParts.push(`\n   🔧 工具调用 (共 ${result.toolCalls.length} 个):\n`)
        for (const toolCall of result.toolCalls.slice(0, 5)) {
          // Limit to first 5 tool calls to avoid too much output
          const toolStatusIcon = toolCall.status === "completed" ? "✓" : toolCall.status === "running" ? "⏳" : "✗"
          outputParts.push(`      ${toolStatusIcon} ${toolCall.tool}${toolCall.title ? `: ${toolCall.title}` : ""}\n`)
        }
        if (result.toolCalls.length > 5) {
          outputParts.push(`      ... 还有 ${result.toolCalls.length - 5} 个工具调用\n`)
        }
      }

      // Add file changes summary
      if (result.fileChanges && result.fileChanges.length > 0) {
        outputParts.push(`\n   📝 文件修改:\n`)
        for (const change of result.fileChanges) {
          outputParts.push(`      - ${change.files.join(", ")}\n`)
        }
      }

      // Add session link
      if (result.sessionID) {
        outputParts.push(`\n   🔗 [查看步骤详情: session/${result.sessionID}](#session/${result.sessionID})\n`)
      }

      // Send metadata update with step completion details
      ctx.metadata({
        title: `Coding Agent${phaseLabel} - Completed Step ${stepIndex}/${totalSteps}: ${step.id}`,
        metadata: {
          workflow: workflow.name,
          phase,
          currentStep: step.id,
          stepIndex,
          totalSteps,
          status: result.success ? "completed" : "failed",
          agent: step.agent,
          progress: Math.round((stepIndex / totalSteps) * 100),
          currentOutput: outputParts.join(""),
          executedSteps: executedSteps.length,
          stepDetails: {
            success: result.success,
            skipped: result.skipped || false,
            toolCalls: result.toolCalls?.length || 0,
            fileChanges: result.fileChanges?.length || 0,
            duration: stepDuration,
            sessionID: result.sessionID,
          },
        },
      })

      // Handle skipped steps (condition not met)
      if (result.skipped) {
        // Output skipped step information
        outputParts.push(`\n${"─".repeat(60)}\n`)
        outputParts.push(`⏭  [步骤 ${stepIndex}/${totalSteps}] 跳过: ${step.id}\n`)
        outputParts.push(`   原因: ${result.output}\n`)
        outputParts.push(`   条件: ${step.condition?.type || "unknown"}\n`)
        outputParts.push(`${"─".repeat(60)}\n`)

        // Determine phase for coding agent workflows
        const phase = getPhase(step, workflow.name)
        const phaseLabel = phase ? ` - Phase: ${phase.charAt(0).toUpperCase() + phase.slice(1)}` : ""

        // Send metadata update for skipped step
        ctx.metadata({
          title: `Coding Agent${phaseLabel} - Skipped Step ${stepIndex}/${totalSteps}: ${step.id}`,
          metadata: {
            workflow: workflow.name,
            phase,
            currentStep: step.id,
            stepIndex,
            totalSteps,
            status: "skipped",
            agent: step.agent,
            progress: Math.round((stepIndex / totalSteps) * 100),
            currentOutput: outputParts.join(""),
            executedSteps: executedSteps.length,
            stepDetails: {
              skipped: true,
              reason: result.output,
            },
          },
        })

        // If step was skipped, continue to next step (or on_success if specified)
        if (step.on_success === null) {
          currentStepId = null
        } else if (step.on_success) {
          currentStepId = step.on_success
        } else {
          // No on_success specified, try to continue to next step
          const currentIndex = workflow.steps.findIndex((s) => s.id === step.id)
          if (currentIndex >= 0 && currentIndex < workflow.steps.length - 1) {
            currentStepId = workflow.steps[currentIndex + 1].id
          } else {
            currentStepId = null
          }
        }
        continue
      }

      if (result.success) {
        // Step succeeded
        if (step.on_success === null) {
          // End of workflow
          currentStepId = null
        } else if (step.on_success) {
          currentStepId = step.on_success
        } else {
          // No on_success specified, try to continue to next step
          const currentIndex = workflow.steps.findIndex((s) => s.id === step.id)
          if (currentIndex >= 0 && currentIndex < workflow.steps.length - 1) {
            currentStepId = workflow.steps[currentIndex + 1].id
          } else {
            currentStepId = null
          }
        }
      } else {
        // Step failed
        if (step.on_failure === "stop") {
          currentStepId = null
        } else if (step.on_failure === "continue") {
          // Continue to next step
          const currentIndex = workflow.steps.findIndex((s) => s.id === step.id)
          if (currentIndex >= 0 && currentIndex < workflow.steps.length - 1) {
            currentStepId = workflow.steps[currentIndex + 1].id
          } else {
            currentStepId = null
          }
        } else if (typeof step.on_failure === "string") {
          // Jump to specific step
          currentStepId = step.on_failure
        } else {
          // Default: stop on failure
          currentStepId = null
        }
      }
    }

    // Add final summary
    const totalDuration = Date.now() - startTime
    const totalDurationSeconds = (totalDuration / 1000).toFixed(2)
    const allSuccess = Array.from(stepResults.values()).every((r) => r.success)
    const successCount = Array.from(stepResults.values()).filter((r) => r.success).length
    const skippedCount = Array.from(stepResults.values()).filter((r) => r.skipped).length
    const failedCount = Array.from(stepResults.values()).filter((r) => !r.success && !r.skipped).length

    outputParts.push(`\n${"━".repeat(60)}\n`)
    outputParts.push(`${allSuccess ? "✅" : "⚠️"} [完成] 工作流执行完成\n`)
    outputParts.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
    outputParts.push(`   总耗时: ${totalDurationSeconds}秒 (${totalDuration}ms)\n`)
    outputParts.push(`   执行步骤: ${executedSteps.length}/${totalSteps}\n`)
    outputParts.push(`   ✓ 成功: ${successCount} 步骤\n`)
    if (skippedCount > 0) {
      outputParts.push(`   ⏭ 跳过: ${skippedCount} 步骤\n`)
    }
    if (failedCount > 0) {
      outputParts.push(`   ✗ 失败: ${failedCount} 步骤\n`)
    }
    outputParts.push(`   最终状态: ${allSuccess ? "✅ 全部成功" : "⚠️ 部分失败"}\n`)
    outputParts.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

    // Build detailed summary for final output
    outputParts.push(`\n\n${"═".repeat(60)}\n`)
    outputParts.push(`📊 详细摘要\n`)
    outputParts.push(`${"═".repeat(60)}\n\n`)

    for (const step of workflow.steps) {
      const result = stepResults.get(step.id)
      if (!result) {
        outputParts.push(`\n${"─".repeat(60)}\n`)
        outputParts.push(`⚠️  Step: ${step.id} (@${step.agent})\n`)
        outputParts.push(`   状态: ⚠ 未执行\n`)
        outputParts.push(`${"─".repeat(60)}\n`)
        continue
      }

      if (result.skipped) {
        outputParts.push(`\n${"─".repeat(60)}\n`)
        outputParts.push(`⏭  Step: ${step.id} (@${step.agent})\n`)
        outputParts.push(`   状态: ⏭ 跳过 (条件未满足)\n`)
        outputParts.push(`   原因: ${result.output}\n`)
        outputParts.push(`${"─".repeat(60)}\n`)
        continue
      }

      const statusIcon = result.success ? "✓" : "✗"
      const statusText = result.success ? "成功" : "失败"
      outputParts.push(`\n${"─".repeat(60)}\n`)
      outputParts.push(`${statusIcon}  Step: ${step.id} (@${step.agent})\n`)
      outputParts.push(`   状态: ${statusText}\n`)

      // Add tool calls information
      if (result.toolCalls && result.toolCalls.length > 0) {
        outputParts.push(`\n   🔧 工具调用 (${result.toolCalls.length}):\n`)
        for (const toolCall of result.toolCalls) {
          const toolStatusIcon = toolCall.status === "completed" ? "✓" : toolCall.status === "running" ? "⏳" : "✗"
          outputParts.push(`      ${toolStatusIcon} ${toolCall.tool}${toolCall.title ? `: ${toolCall.title}` : ""}\n`)
          if (toolCall.output && toolCall.output.length > 0) {
            const preview = toolCall.output.length > 200 ? toolCall.output.substring(0, 200) + "..." : toolCall.output
            outputParts.push(`         输出: ${preview.replace(/\n/g, " ")}\n`)
          }
        }
      }

      // Add file changes information
      if (result.fileChanges && result.fileChanges.length > 0) {
        outputParts.push(`\n   📝 文件修改:\n`)
        for (const change of result.fileChanges) {
          outputParts.push(`      - ${change.files.join(", ")}\n`)
        }
      }

      // Add output text
      if (result.outputText && result.outputText.trim().length > 0) {
        const outputPreview =
          result.outputText.length > 300 ? result.outputText.substring(0, 300) + "..." : result.outputText
        outputParts.push(`\n   📄 输出:\n      ${outputPreview.replace(/\n/g, "\n      ")}\n`)
      } else if (result.output && result.output.trim().length > 0) {
        const outputPreview = result.output.length > 300 ? result.output.substring(0, 300) + "..." : result.output
        outputParts.push(`\n   📄 输出:\n      ${outputPreview.replace(/\n/g, "\n      ")}\n`)
      }

      // Add session link
      if (result.sessionID) {
        outputParts.push(`\n   🔗 [查看步骤详情: session/${result.sessionID}](#session/${result.sessionID})\n`)
      }

      outputParts.push(`${"─".repeat(60)}\n`)
    }

    const output = outputParts.join("")

    // Send final metadata with complete output
    ctx.metadata({
      title: `Completed workflow: ${workflow.name}`,
      metadata: {
        workflow: workflow.name,
        totalSteps,
        status: allSuccess ? "completed" : "completed_with_failures",
        successCount,
        skippedCount,
        failedCount,
        totalDuration,
        progress: 100,
        currentOutput: output,
        executedSteps: executedSteps.length,
        completedAt: Date.now(),
      },
    })

    return {
      title: `Workflow: ${workflow.name}`,
      metadata: {
        workflow: workflow.name,
        steps: Array.from(stepResults.entries()).map(([id, result]) => {
          const step = stepMap.get(id)
          return {
            id,
            success: result.success,
            sessionID: result.sessionID,
            agent: step?.agent,
            skipped: result.skipped,
          }
        }),
      },
      output,
    }
  },
})
