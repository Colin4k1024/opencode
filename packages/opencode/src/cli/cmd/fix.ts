import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { EOL } from "os"
import { select, confirm } from "@clack/prompts"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  sql: ["SQL", UI.Style.TEXT_INFO_BOLD],
  "config-reader": ["Config", UI.Style.TEXT_INFO_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

interface FixProposal {
  problem_summary: string
  root_cause: string
  fix_proposals: Array<{
    solution: string
    code_changes: string
    pros: string[]
    cons: string[]
    risk_level: "low" | "medium" | "high"
    estimated_impact: string
  }>
  verification_steps: string[]
  rollback_instructions: string
}

function fixJsonFormat(text: string): string {
  // 修复常见的 JSON 格式问题：
  // 1. 键名缺少引号：{ key: value } -> { "key": value }
  // 2. 处理嵌套对象和数组
  // 3. 保留已有的引号
  
  let fixed = text
  
  // 修复键名（字母、数字、下划线，可能包含点，但不包括已加引号的）
  // 匹配模式：在 { 或 , 之后，可选空白，然后是标识符，然后是 :
  // 注意：需要避免匹配已有引号的键名
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, (match, prefix, key) => {
    // 检查前面是否已经有引号（避免重复处理）
    const beforeMatch = fixed.substring(0, fixed.indexOf(match))
    if (beforeMatch.endsWith('"')) {
      return match // 已经有引号，不处理
    }
    return `${prefix}"${key}":`
  })
  
  // 修复数组中的键名（在数组中也可能有对象）
  fixed = fixed.replace(/(\[\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
  
  // 对于字符串值的修复，我们采用更保守的策略
  // 只处理简单的单行值，复杂值（包含换行、逗号等）让 JSON.parse 的错误信息来提示
  // 匹配简单的字符串值：": 值, 或 ": 值} 或 ": 值] 其中值不包含逗号、换行、大括号等
  fixed = fixed.replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_$\s-]*?)(\s*[,}\]])/g, (match, value, suffix) => {
    const trimmed = value.trim()
    // 如果值看起来像简单字符串（不包含特殊字符），且不是数字、布尔、null，则添加引号
    if (
      trimmed &&
      !trimmed.includes(',') &&
      !trimmed.includes('\n') &&
      !trimmed.includes('{') &&
      !trimmed.includes('[') &&
      !/^(true|false|null|\d+\.?\d*)$/.test(trimmed) &&
      !trimmed.startsWith('"') &&
      !trimmed.endsWith('"')
    ) {
      // 转义内部的双引号和反斜杠
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `: "${escaped}"${suffix}`
    }
    return match
  })
  
  return fixed
}

function parseRelaxedJson(text: string): any | null {
  try {
    // 先尝试标准解析
    return JSON.parse(text)
  } catch (e) {
    // 尝试修复格式
    try {
      const fixed = fixJsonFormat(text)
      return JSON.parse(fixed)
    } catch (e2) {
      // 如果还是失败，记录调试信息（仅在开发模式下）
      if (process.env.DEBUG) {
        console.error("Failed to parse JSON:", e2)
        console.error("Original text:", text.substring(0, 500))
        console.error("Fixed text:", fixJsonFormat(text).substring(0, 500))
      }
      return null
    }
  }
}

function detectNaturalLanguageProposal(text: string): FixProposal | null {
  // 检测自然语言格式的修复提案
  // 检测关键词：Problem、Root Cause、Risk Assessment、Solution、需要用户确认等
  
  const problemMatch = text.match(/\*\*Problem\*\*[:\s]*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i)
  const rootCauseMatch = text.match(/\*\*Root Cause\*\*[:\s]*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i)
  const riskMatch = text.match(/\*\*Risk Assessment\*\*[:\s]*([^\n]+)/i)
  
  // 检测是否需要用户确认
  const needsConfirmation = 
    /需要用户确认/i.test(text) || 
    /This fix requires user confirmation/i.test(text) ||
    /requires user confirmation/i.test(text)
  
  // 检测风险级别
  let riskLevel: "low" | "medium" | "high" = "medium"
  if (riskMatch) {
    const riskText = riskMatch[1].toLowerCase()
    if (/low-risk|低风险/.test(riskText)) {
      riskLevel = "low"
    } else if (/high-risk|高风险/.test(riskText)) {
      riskLevel = "high"
    } else if (/medium-risk|中风险|medium|high/.test(riskText)) {
      riskLevel = /high-risk|高风险/.test(riskText) ? "high" : "medium"
    }
  }
  
  // 如果检测到问题描述和根本原因，或者检测到需要确认的标记
  if ((problemMatch || rootCauseMatch) && (needsConfirmation || riskLevel !== "low")) {
    const problemSummary = problemMatch?.[1]?.trim() || "Code fix required"
    const rootCause = rootCauseMatch?.[1]?.trim() || "Root cause analysis provided"
    
    // 提取解决方案
    const solutionMatches: Array<{ 
      solution: string
      risk: "low" | "medium" | "high"
      pros: string[]
      cons: string[]
      impact: string
    }> = []
    
    // 检测单个解决方案
    const singleSolutionMatch = text.match(/\*\*Solution\*\*[:\s]*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i)
    if (singleSolutionMatch) {
      const solutionText = singleSolutionMatch[1].trim()
      solutionMatches.push({
        solution: solutionText,
        risk: riskLevel,
        pros: [],
        cons: [],
        impact: riskLevel === "low" ? "Minimal impact" : "Requires assessment",
      })
    }
    
    // 检测多个解决方案（Option 1, Option 2等）
    // 改进：匹配整个 Option 块，从 **Option N** 到下一个 **Option** 或文本结尾
    const optionPattern = /\*\*Option (\d+)\*\*[:\s]*([\s\S]*?)(?=\*\*Option \d+\*\*|$)/gi
    let optionMatch
    while ((optionMatch = optionPattern.exec(text)) !== null) {
      const optionNumber = optionMatch[1]
      const optionBlock = optionMatch[2].trim()
      
      // 提取解决方案描述（第一行，直到遇到 - Pros、- Cons、- Risk Level 或 - Impact）
      const solutionDescMatch = optionBlock.match(/^([^\n]+(?:\n(?![-*]\s*(Pros|Cons|Risk Level|Impact))[^\n]+)*)/)
      const solutionDesc = solutionDescMatch 
        ? solutionDescMatch[1].trim() 
        : optionBlock.split(/\n/)[0].trim()
      
      // 提取风险级别（从 Option 块中）
      const optionRiskMatch = optionBlock.match(/[-*]\s*Risk Level[:\s]*(low|medium|high)/i)
      const optionRisk = optionRiskMatch 
        ? (optionRiskMatch[1].toLowerCase() as "low" | "medium" | "high")
        : riskLevel
      
      // 提取 Pros
      // 匹配 - Pros: 或 - Pros: 后的内容，直到遇到 - Cons、- Risk Level、- Impact 或下一个 Option
      const prosMatch = optionBlock.match(/[-*]\s*Pros[:\s]*([\s\S]*?)(?=\n[-*]\s*(Cons|Risk Level|Impact)|$)/i)
      const prosText = prosMatch ? prosMatch[1].trim() : ""
      const pros: string[] = []
      if (prosText) {
        // 支持逗号分隔的多个 pros，或换行分隔
        if (prosText.includes(",") && !prosText.includes("\n")) {
          // 逗号分隔（单行）
          pros.push(...prosText.split(",").map(p => p.trim()).filter(p => p))
        } else {
          // 换行分隔或多行文本
          const lines = prosText.split(/\n/).map(p => p.trim()).filter(p => p && !p.match(/^[-*]\s*$/))
          if (lines.length > 0) {
            // 如果第一行包含逗号，可能是逗号分隔的列表
            if (lines.length === 1 && lines[0].includes(",")) {
              pros.push(...lines[0].split(",").map(p => p.trim()).filter(p => p))
            } else {
              pros.push(...lines)
            }
          }
        }
      }
      
      // 提取 Cons
      // 匹配 - Cons: 或 - Cons: 后的内容，直到遇到 - Pros、- Risk Level、- Impact 或下一个 Option
      const consMatch = optionBlock.match(/[-*]\s*Cons[:\s]*([\s\S]*?)(?=\n[-*]\s*(Pros|Risk Level|Impact)|$)/i)
      const consText = consMatch ? consMatch[1].trim() : ""
      const cons: string[] = []
      if (consText) {
        // 支持逗号分隔的多个 cons，或换行分隔
        if (consText.includes(",") && !consText.includes("\n")) {
          // 逗号分隔（单行）
          cons.push(...consText.split(",").map(c => c.trim()).filter(c => c))
        } else {
          // 换行分隔或多行文本
          const lines = consText.split(/\n/).map(c => c.trim()).filter(c => c && !c.match(/^[-*]\s*$/))
          if (lines.length > 0) {
            // 如果第一行包含逗号，可能是逗号分隔的列表
            if (lines.length === 1 && lines[0].includes(",")) {
              cons.push(...lines[0].split(",").map(c => c.trim()).filter(c => c))
            } else {
              cons.push(...lines)
            }
          }
        }
      }
      
      // 提取 Impact
      // 匹配 - Impact: 后的内容，直到遇到 - Pros、- Cons、- Risk Level 或下一个 Option
      const impactMatch = optionBlock.match(/[-*]\s*Impact[:\s]*([\s\S]*?)(?=\n[-*]\s*(Pros|Cons|Risk Level)|$)/i)
      const impact = impactMatch 
        ? impactMatch[1].trim() 
        : (optionRisk === "low" ? "Minimal impact" : "Requires assessment")
      
      solutionMatches.push({
        solution: solutionDesc,
        risk: optionRisk,
        pros,
        cons,
        impact,
      })
    }
    
    // 如果没有找到解决方案，创建一个默认的
    if (solutionMatches.length === 0) {
      solutionMatches.push({
        solution: "Fix based on root cause analysis",
        risk: riskLevel,
        pros: [],
        cons: [],
        impact: riskLevel === "low" ? "Minimal impact" : "Requires assessment",
      })
    }
    
    return {
      problem_summary: problemSummary.substring(0, 100), // 限制长度
      root_cause: rootCause.substring(0, 500), // 限制长度
      fix_proposals: solutionMatches.map((sol) => ({
        solution: sol.solution,
        code_changes: "", // 自然语言格式不包含代码变更详情
        pros: sol.pros,
        cons: sol.cons,
        risk_level: sol.risk,
        estimated_impact: sol.impact,
      })),
      verification_steps: [],
      rollback_instructions: "Review git diff to rollback if needed",
    }
  }
  
  return null
}

function detectFixProposal(text: string): FixProposal | null {
  // 优先检测自然语言格式（新格式）
  const naturalLanguageProposal = detectNaturalLanguageProposal(text)
  if (naturalLanguageProposal) {
    return naturalLanguageProposal
  }
  
  // 方法1: 检测特殊标记（保留向后兼容）
  const markerMatch = text.match(/<!--FIX_PROPOSAL-->\s*([\s\S]*?)\s*<!--\/FIX_PROPOSAL-->/)
  if (markerMatch) {
    const content = markerMatch[1].trim()
    // 移除可能的代码块标记
    const jsonContent = content.replace(/^```json\s*|\s*```$/g, "").trim()

    const parsed = parseRelaxedJson(jsonContent)
    if (parsed && parsed.problem_summary && parsed.fix_proposals) {
      return parsed
    } else if (process.env.DEBUG) {
      // 检测到标记但解析失败，记录调试信息
      console.warn("Detected FIX_PROPOSAL marker but parsing failed")
      console.warn("Content preview:", jsonContent.substring(0, 200))
    }
  }

  // 方法2: 检测 JSON 代码块（保留向后兼容）
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonBlockMatch) {
    const parsed = parseRelaxedJson(jsonBlockMatch[1])
    if (parsed && parsed.problem_summary && parsed.fix_proposals) {
      return parsed
    }
  }

  // 方法3: 检测内联 JSON 对象（保留向后兼容）
  // 使用更宽松的匹配，因为 JSON 可能跨多行，且键名可能没有引号
  const jsonObjectPattern = /\{[\s\S]*?problem_summary[\s\S]*?fix_proposals[\s\S]*?\}/
  const jsonObjectMatch = text.match(jsonObjectPattern)
  if (jsonObjectMatch) {
    const parsed = parseRelaxedJson(jsonObjectMatch[0])
    if (parsed && parsed.problem_summary && parsed.fix_proposals) {
      return parsed
    }
  }

  return null
}

function findBestProposal(proposal: FixProposal): number | null {
  // 优先选择低风险方案
  const lowRiskIndex = proposal.fix_proposals.findIndex((fp) => fp.risk_level === "low")
  if (lowRiskIndex >= 0) {
    return lowRiskIndex
  }

  // 如果没有低风险，选择第一个
  return 0
}

function showProposalDetails(proposal: FixProposal["fix_proposals"][0]) {
  UI.println()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Fix Details:")
  UI.println(UI.Style.TEXT_NORMAL + "Solution: " + proposal.solution)
  UI.println()
  
  // 显示代码变更（如果有）
  if (proposal.code_changes && proposal.code_changes.trim()) {
    UI.println(UI.Style.TEXT_NORMAL + "Code Changes:")
    UI.println(UI.Style.TEXT_DIM + proposal.code_changes)
    UI.println()
  }
  
  // 显示 Pros（如果有）
  if (proposal.pros && proposal.pros.length > 0) {
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Pros: " + proposal.pros.join(", "))
  } else {
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Pros: None")
  }
  
  // 显示 Cons（如果有）
  if (proposal.cons && proposal.cons.length > 0) {
    UI.println(UI.Style.TEXT_WARNING_BOLD + "Cons: " + proposal.cons.join(", "))
  } else {
    UI.println(UI.Style.TEXT_WARNING_BOLD + "Cons: None")
  }
  
  UI.println(UI.Style.TEXT_NORMAL + "Risk Level: " + proposal.risk_level)
  UI.println(UI.Style.TEXT_NORMAL + "Impact: " + proposal.estimated_impact)
  UI.println()
}

async function showFixProposalConfirmation(
  proposal: FixProposal,
  autoSelect: boolean = false,
): Promise<{
  approved: boolean
  selectedIndex?: number
}> {
  UI.println()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Fix Proposal Detected")
  UI.println()

  // 显示问题摘要和根本原因
  UI.println(UI.Style.TEXT_NORMAL + "Problem: " + proposal.problem_summary)
  UI.println()
  UI.println(UI.Style.TEXT_NORMAL + "Root Cause:")
  UI.println(UI.Style.TEXT_DIM + proposal.root_cause)
  UI.println()

  // 自动选择逻辑
  if (autoSelect) {
    const bestIndex = findBestProposal(proposal)
    if (bestIndex !== null) {
      const selectedProposal = proposal.fix_proposals[bestIndex]
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Auto-selected: ${selectedProposal.solution} (Risk: ${selectedProposal.risk_level})`,
      )
      UI.println()
      showProposalDetails(selectedProposal)

      // 仍然需要用户确认
      const confirmed = await confirm({
        message: "Apply this auto-selected fix?",
        initialValue: true, // 默认选中
      })

      return {
        approved: confirmed === true,
        selectedIndex: bestIndex,
      }
    }
  }

  // 如果有多个方案，使用 select
  if (proposal.fix_proposals.length > 1) {
    const options = proposal.fix_proposals.map((fp, idx) => ({
      value: idx.toString(),
      label: `${fp.solution} (Risk: ${fp.risk_level})`,
      hint: fp.pros.join(", "),
    }))

    const selected = await select({
      message: "Select a fix proposal to apply:",
      options,
    })

    if (selected && typeof selected === "string") {
      const selectedIndex = parseInt(selected, 10)
      // 显示选中方案的详细信息
      showProposalDetails(proposal.fix_proposals[selectedIndex])

      const confirmed = await confirm({
        message: "Apply this fix?",
        initialValue: false,
      })

      return {
        approved: confirmed === true,
        selectedIndex,
      }
    }

    return { approved: false }
  } else {
    // 只有一个方案，直接显示详情并确认
    showProposalDetails(proposal.fix_proposals[0])

    const confirmed = await confirm({
      message: "Apply this fix?",
      initialValue: false,
    })

    return {
      approved: confirmed === true,
      selectedIndex: 0,
    }
  }
}

async function sendConfirmationToAgent(
  sdk: OpencodeClient,
  sessionID: string,
  proposal: FixProposal,
  selectedIndex: number,
  approved: boolean,
) {
  if (!approved) {
    await sdk.session.prompt({
      sessionID,
      agent: "fix",
      parts: [
        {
          type: "text",
          text: "The user has rejected the fix proposal. Please provide alternative solutions or ask for clarification.",
        },
      ],
    })
    return
  }

  const selectedProposal = proposal.fix_proposals[selectedIndex]

  const confirmationMessage = `The user has approved the following fix proposal:

**Selected Solution**: ${selectedProposal.solution}
**Risk Level**: ${selectedProposal.risk_level}

Please proceed to execute this fix using the appropriate tools (edit/write/bash):
1. Apply the code changes as specified in the proposal
2. Verify the fix resolves the error
3. Run any verification steps: ${proposal.verification_steps.join(", ")}

**CRITICAL**: You MUST actually execute the fix using tools, not just describe it. Use the edit tool to modify files or write tool to create new files as needed.`

  await sdk.session.prompt({
    sessionID,
    agent: "fix",
    parts: [{ type: "text", text: confirmationMessage }],
  })
}

export const FixCommand = cmd({
  command: "fix [error-message..]",
  describe: "analyze and fix code errors, compilation issues, and runtime problems",
  builder: (yargs: Argv) => {
    return yargs
      .positional("error-message", {
        describe: "error message or description of the issue to fix",
        type: "string",
        array: true,
        default: [],
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "error log file(s) to attach",
      })
      .option("auto", {
        type: "boolean",
        describe: "automatically apply fixes without confirmation (use with caution)",
        default: false,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("title", {
        type: "string",
        describe: "title for the session",
      })
      .option("auto-select", {
        type: "boolean",
        describe: "automatically select the first low-risk fix proposal",
        default: true,
      })
  },
  handler: async (args) => {
    let errorMessage = [...args["error-message"], ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const fileParts: any[] = []
    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)
        const stats = await file.stat().catch(() => {})
        if (!stats) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        if (!(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        const stat = await file.stat()
        const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    // Read from stdin if no message provided
    if (!process.stdin.isTTY && errorMessage.trim().length === 0) {
      errorMessage = await Bun.stdin.text()
    }

    if (errorMessage.trim().length === 0 && fileParts.length === 0) {
      UI.error("You must provide an error message or error log file")
      process.exit(1)
    }

    const execute = async (sdk: OpencodeClient, sessionID: string) => {
      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      const events = await sdk.event.subscribe()
      let errorMsg: string | undefined
      let pendingProposal: FixProposal | null = null
      let processedProposals = new Set<string>()
      let proposalDetected = false
      let lastTextUpdate = Date.now()
      let toolCallCount = 0
      let hasToolCallsAfterProposal = false // 跟踪提案后是否有工具调用
      const ANALYSIS_TIMEOUT = 10 * 60 * 1000 // 10 分钟超时
      const MAX_TOOL_CALLS_BEFORE_REMINDER = 20 // 20 次工具调用后提醒
      let timeoutCheckInterval: NodeJS.Timeout | null = null
      let lastReminderTime = 0
      const REMINDER_COOLDOWN = 5 * 60 * 1000 // 5 分钟冷却时间

      const eventProcessor = (async () => {
        // 设置超时检测
        timeoutCheckInterval = setInterval(async () => {
          const timeSinceLastUpdate = Date.now() - lastTextUpdate
          const timeSinceLastReminder = Date.now() - lastReminderTime
          
          if (timeSinceLastUpdate > ANALYSIS_TIMEOUT && !proposalDetected && timeSinceLastReminder > REMINDER_COOLDOWN) {
            lastReminderTime = Date.now()
            // 发送提醒消息
            await sdk.session.prompt({
              sessionID,
              agent: "fix",
              parts: [
                {
                  type: "text",
                  text: "You have been analyzing for a while. Please provide a fix proposal based on your current analysis, even if you are not 100% certain. It is better to propose a solution that may need refinement than to continue analyzing indefinitely. Please describe the problem, root cause, and proposed solution in natural language. For low-risk issues, execute the fix immediately. For medium/high-risk issues, explicitly state that user confirmation is required.",
                },
              ],
            })
          }
        }, 60000) // 每分钟检查一次

        for await (const event of events.stream) {
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.sessionID !== sessionID) continue

            if (part.type === "tool" && part.state.status === "completed") {
              toolCallCount++
              
              // 如果已经有提案，标记为有工具调用（可能是自动执行修复）
              if (proposalDetected && (part.tool === "edit" || part.tool === "write" || part.tool === "bash")) {
                hasToolCallsAfterProposal = true
              }
              
              // 工具调用计数提醒
              if (toolCallCount >= MAX_TOOL_CALLS_BEFORE_REMINDER && !proposalDetected) {
                const timeSinceLastReminder = Date.now() - lastReminderTime
                if (timeSinceLastReminder > REMINDER_COOLDOWN) {
                  lastReminderTime = Date.now()
                  // 发送提醒
                  await sdk.session.prompt({
                    sessionID,
                    agent: "fix",
                    parts: [
                      {
                        type: "text",
                        text: `You have made ${toolCallCount} tool calls. Please provide a fix proposal based on your current analysis. Describe the problem, root cause, and solution in natural language. For low-risk issues, execute the fix immediately. For medium/high-risk issues, explicitly state that user confirmation is required. You can continue investigating after proposing an initial solution.`,
                      },
                    ],
                  })
                  toolCallCount = 0 // 重置计数器
                }
              }
              
              if (outputJsonEvent("tool_use", { part })) continue
              const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
              const title =
                part.state.title ||
                (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
              printEvent(color, tool, title)
              if (part.tool === "bash" && part.state.output?.trim()) {
                UI.println()
                UI.println(part.state.output)
              }
            }

            if (part.type === "step-start") {
              if (outputJsonEvent("step_start", { part })) continue
            }

            if (part.type === "step-finish") {
              if (outputJsonEvent("step_finish", { part })) continue
            }

            if (part.type === "text") {
              lastTextUpdate = Date.now()
              
              // 检测修复提案（仅在非 JSON 输出模式和非管道模式下）
              if (args.format !== "json" && process.stdout.isTTY && !args.auto) {
                const proposal = detectFixProposal(part.text)
                if (proposal && !pendingProposal) {
                  proposalDetected = true
                  // 使用 problem_summary 作为唯一标识，避免重复处理
                  const proposalId = proposal.problem_summary
                  if (!processedProposals.has(proposalId)) {
                    processedProposals.add(proposalId)
                    
                    // 检查风险级别
                    const isLowRisk = proposal.fix_proposals.every(fp => fp.risk_level === "low")
                    const isMediumRisk = proposal.fix_proposals.some(fp => fp.risk_level === "medium") && 
                                        !proposal.fix_proposals.some(fp => fp.risk_level === "high")
                    const isHighRisk = proposal.fix_proposals.some(fp => fp.risk_level === "high")
                    
                    // 检测是否需要用户确认
                    const needsConfirmation = 
                      /需要用户确认/i.test(part.text) || 
                      /This fix requires user confirmation/i.test(part.text) ||
                      /requires user confirmation/i.test(part.text)
                    
                    // 检测智能体是否已经选择了方案
                    const hasSelectedSolution = 
                      /Selected Solution/i.test(part.text) ||
                      /I will proceed with/i.test(part.text) ||
                      /我将采用/i.test(part.text) ||
                      /选择方案/i.test(part.text) ||
                      /proceeding with/i.test(part.text)
                    
                    // 检查文本中是否表明正在执行修复
                    const isExecuting = 
                      /Executing fix now/i.test(part.text) ||
                      /正在执行修复/i.test(part.text) ||
                      /Applying fix/i.test(part.text) ||
                      /executing.*fix/i.test(part.text)
                    
                    // 低风险：完全跳过确认（如果正在执行）
                    if (isLowRisk && !needsConfirmation && isExecuting) {
                      // 低风险问题，智能体正在自动执行，不需要确认
                      proposalDetected = true
                      hasToolCallsAfterProposal = false // 重置标志
                    } 
                    // 中等风险：如果智能体已经选择方案并开始执行，跳过确认
                    else if (isMediumRisk && !needsConfirmation && (hasSelectedSolution || isExecuting)) {
                      // 中等风险问题，智能体已经自主选择并开始执行，不需要确认
                      proposalDetected = true
                      hasToolCallsAfterProposal = false // 重置标志
                    }
                    // 低风险但没有执行标记：显示确认（但可以自动选择）
                    else if (isLowRisk && !needsConfirmation) {
                      pendingProposal = proposal
                      const autoSelect = args["auto-select"] !== false
                      const confirmation = await showFixProposalConfirmation(proposal, autoSelect)
                      
                      if (confirmation.approved) {
                        await sendConfirmationToAgent(
                          sdk,
                          sessionID,
                          proposal,
                          confirmation.selectedIndex || 0,
                          confirmation.approved,
                        )
                      }
                      
                      pendingProposal = null
                      hasToolCallsAfterProposal = false
                    }
                    // 高风险或明确要求确认：显示确认界面
                    else {
                      pendingProposal = proposal
                      const autoSelect = args["auto-select"] !== false
                      const confirmation = await showFixProposalConfirmation(proposal, autoSelect)

                      // 发送确认消息给 agent
                      await sendConfirmationToAgent(
                        sdk,
                        sessionID,
                        proposal,
                        confirmation.selectedIndex || 0,
                        confirmation.approved,
                      )

                      pendingProposal = null
                      hasToolCallsAfterProposal = false // 重置标志
                    }
                  }
                }
              } else {
                // 即使不在交互模式下，也检测提案以停止提醒
                const proposal = detectFixProposal(part.text)
                if (proposal) {
                  proposalDetected = true
                }
              }

              // 继续正常处理文本输出
              if (part.time?.end) {
                if (outputJsonEvent("text", { part })) continue
                const isPiped = !process.stdout.isTTY
                if (!isPiped) UI.println()
                process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
                if (!isPiped) UI.println()
              }
            }
          }

          if (event.type === "session.error") {
            const props = event.properties
            if (props.sessionID !== sessionID || !props.error) continue
            let err = String(props.error.name)
            if ("data" in props.error && props.error.data && "message" in props.error.data) {
              err = String(props.error.data.message)
            }
            errorMsg = errorMsg ? errorMsg + EOL + err : err
            if (outputJsonEvent("error", { error: props.error })) continue
            UI.error(err)
          }

          if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
            if (timeoutCheckInterval) {
              clearInterval(timeoutCheckInterval)
            }
            break
          }

          if (event.type === "permission.asked") {
            const permission = event.properties
            if (permission.sessionID !== sessionID) continue
            const result = await select({
              message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
              options: [
                { value: "once", label: "Allow once" },
                { value: "always", label: "Always allow: " + permission.always.join(", ") },
                { value: "reject", label: "Reject" },
              ],
              initialValue: "once",
            }).catch(() => "reject")
            const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
            await sdk.permission.respond({
              sessionID,
              permissionID: permission.id,
              response,
            })
          }
        }
      })()

      // Validate fix agent exists
      const fixAgent = await Agent.get("fix")
      if (!fixAgent) {
        UI.error('Fix agent not found. Please ensure the "fix" agent is properly configured.')
        process.exit(1)
      }

      if (fixAgent.mode !== "primary") {
        UI.error('Fix agent must be a primary agent, but it is configured as "' + fixAgent.mode + '"')
        process.exit(1)
      }

      // Build the prompt for the fix agent
      // First, trigger initialization steps as per the agent prompt requirements
      let prompt = ""
      
      // Add initialization instruction if this is the first message in the session
      // The agent prompt requires initialization: project scanning, config loading, dependency analysis, etc.
      prompt += "Before analyzing the error, please perform the initialization steps:\n"
      prompt += "1. Use glob tools to scan the project root directory to identify the main tech stack and project structure\n"
      prompt += "2. Use config-reader tool to automatically load core configuration files (package.json, tsconfig.json, .eslintrc, etc.)\n"
      prompt += "3. Analyze project dependencies and build a dependency graph\n"
      prompt += "4. Detect current environment (development/test/production) and available toolchain\n"
      prompt += "5. Report initialization completion status, including identified tech stack, project type, and available tools\n\n"
      
      // Then provide the error to fix
      prompt += "After initialization, please analyze and fix the following error:\n\n"
      if (errorMessage.trim()) {
        prompt += errorMessage
      }
      if (fileParts.length > 0) {
        prompt += `\n\nError log files have been attached.`
      }
      
      // Add instructions based on mode
      if (args.auto) {
        prompt += "\n\nNote: Auto-fix mode is enabled. For low-risk issues (syntax errors, clear type errors, spelling errors, formatting issues), apply fixes directly using edit/write tools without waiting for confirmation. For medium-risk issues, autonomously select the best solution and apply it. For high-risk issues, provide a detailed fix proposal in natural language and explicitly state that user confirmation is required."
        prompt += "\n\nCRITICAL: After proposing a fix, you MUST actually execute it using edit/write/bash tools. Do NOT just describe the fix - you must call the tools to implement it. For low-risk and medium-risk issues, execute immediately after selecting the solution. For high-risk issues, wait for user confirmation then execute."
        prompt += "\n\nCRITICAL OUTPUT REQUIREMENT:\n"
        prompt += "After completing your analysis, you MUST describe the problem, root cause, and solution in natural language (NOT JSON format).\n"
        prompt += "For medium-risk issues with multiple solutions, you MUST autonomously select the best one and explain your choice.\n"
        prompt += "Do NOT continue analyzing indefinitely. Once you have identified the most likely root cause, propose a solution immediately.\n"
        prompt += "Even if you are not 100% certain, provide your best assessment and proposed fix.\n"
        prompt += "A fix proposal that may need refinement is better than no proposal at all.\n"
      } else {
        prompt +=
          "\n\nPlease follow the standardized workflow:\n"
        prompt += "1. Parse the error (extract type, location, message)\n"
        prompt += "2. Gather context:\n"
        prompt += "   - Read relevant source files mentioned in the error\n"
        prompt += "   - Use config-reader to load project configuration files\n"
        prompt += "   - **For database-related errors**: First identify project type. For Spring Boot, read application.yml/application.properties from src/main/resources/. Extract database connection info and use sql tool to query the database\n"
        prompt += "   - Examine related files and dependencies\n"
        prompt += "3. Analyze root cause\n"
        prompt += "4. **AUTONOMOUSLY select and apply fixes** in natural language format:\n"
        prompt += "   - For LOW-RISK issues: Describe problem, root cause, and solution, then IMMEDIATELY execute the fix using edit/write/bash tools\n"
        prompt += "   - For MEDIUM-RISK issues: If multiple solutions exist, analyze each with pros/cons, then AUTONOMOUSLY SELECT the best solution based on risk, impact, complexity, and compatibility. Explicitly state \"I will proceed with [Solution X] because [reason]\", then IMMEDIATELY execute the selected fix using edit/write/bash tools\n"
        prompt += "   - For HIGH-RISK issues: Describe problem, root cause, and proposed solutions with pros/cons. Explicitly state \"需要用户确认\" (This fix requires user confirmation), then wait for confirmation before executing\n"
        prompt += "5. **CRITICAL - Fix Execution**: For low-risk and medium-risk issues, execute immediately after selecting the solution. For high-risk issues, wait for user confirmation then execute using edit/write/bash tools. Do NOT stop after proposing - you must call the appropriate tools to implement the changes. Verify the fix resolves the error.\n"
        prompt += "\nImportant: Create a backup point before any fix operation to ensure full rollback is possible. If a fix fails, immediately roll back and provide detailed failure analysis with alternative solutions."
        prompt += "\n\nCRITICAL OUTPUT REQUIREMENT:\n"
        prompt += "After completing your analysis, you MUST describe the problem, root cause, and solution in natural language (NOT JSON format).\n"
        prompt += "For medium-risk issues with multiple solutions, you MUST autonomously select the best one and explain your choice.\n"
        prompt += "Do NOT continue analyzing indefinitely. Once you have identified the most likely root cause, propose a solution immediately.\n"
        prompt += "Even if you are not 100% certain, provide your best assessment and proposed fix.\n"
        prompt += "A fix proposal that may need refinement is better than no proposal at all.\n"
        prompt += "NEVER terminate your response after just describing a fix - you MUST continue to execute it (for low/medium-risk) or wait for confirmation (for high-risk).\n"
      }

      const modelParam = args.model ? Provider.parseModel(args.model) : undefined
      await sdk.session.prompt({
        sessionID,
        agent: "fix",
        model: modelParam,
        parts: [...fileParts, { type: "text", text: prompt }],
      })

      await eventProcessor
      if (errorMsg) process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

      const sessionID = await (async () => {
        const title = args.title || (errorMessage ? errorMessage.slice(0, 50) + (errorMessage.length > 50 ? "..." : "") : "Fix Error")

        const result = await sdk.session.create({ title })
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      await execute(sdk, sessionID)
    })
  },
})
