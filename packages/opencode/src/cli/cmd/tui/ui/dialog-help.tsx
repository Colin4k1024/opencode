import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { useSync } from "@tui/context/sync"
import { For, createMemo } from "solid-js"

const SUBAGENT_DOC_ORDER = [
  "planner",
  "architect",
  "code-reviewer",
  "security-reviewer",
  "tdd-guide",
  "e2e-runner",
  "refactor-cleaner",
  "doc-updater",
] as const

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const sync = useSync()

  const subagentDocs = createMemo(() => {
    const byName = new Map(sync.data.agent.map((a) => [a.name, a]))
    return SUBAGENT_DOC_ORDER.map((name) => byName.get(name)).filter(Boolean)
  })

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Help
        </text>
        <text fg={theme.textMuted}>esc/enter</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          Press {keybind.print("command_list")} to see all available actions and commands in any context.
        </text>
      </box>

      <box flexDirection="column" gap={1} paddingBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Subagents (use with @agent-name)
        </text>
        <text fg={theme.textMuted}>
          In your prompt, type something like:{" "}
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            @planner
          </text>{" "}
          then describe what you want it to do.
        </text>
        <box flexDirection="column" paddingLeft={1}>
          <For each={subagentDocs()}>
            {(a) => (
              <text fg={theme.textMuted}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  @{a!.name}
                </text>{" "}
                - {a!.description ?? "No description provided."}
              </text>
            )}
          </For>
        </box>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
