import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { createMemo, onMount } from "solid-js"

/** Mode label → command names for hosted run. Order: DDD → G6-parser → Spec-kit → Coding 子智能体. */
const HOSTED_MODES: { category: string; commands: string[] }[] = [
  {
    category: "DDD 模式",
    commands: [
      "ddd.implement",
      "ddd.vibe",
      "ddd.ingest",
      "ddd.strategic",
      "ddd.tactical",
      "ddd.services",
      "ddd.design",
      "ddd.init",
    ],
  },
  {
    category: "G6-parser 模式",
    commands: ["g6.implement", "g6.scenario-tests"],
  },
  {
    category: "Spec-kit 模式",
    commands: [
      "speckit.implement",
      "speckit.vibe",
      "speckit.ingest",
      "speckit.plan",
      "speckit.tasks",
      "speckit.init",
      "speckit.specify",
      "speckit.constitution",
    ],
  },
  {
    category: "Coding 子智能体",
    commands: ["build-fix", "plan", "tdd", "code-review", "review", "init"],
  },
]

export function DialogHosted() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()

  const options = createMemo(() => {
    const commands = sync.data.command
    return HOSTED_MODES.flatMap((mode) =>
      mode.commands.flatMap((name) => {
        const cmd = commands.find((c) => c.name === name)
        if (!cmd) return []
        return [
          {
            title: `/${cmd.name}`,
            value: cmd.name,
            description: cmd.description ?? "",
            category: mode.category,
          },
        ]
      }),
    )
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  const handleSelect = async (option: { value: string }) => {
    const model = local.model.current()
    if (!model) {
      toast.show({ variant: "warning", message: "Select a model first (/models)" })
      return
    }
    const agent = local.agent.current()
    try {
      const res = await sdk.client.session.hosted.run(
        {
          command: option.value,
          arguments: "",
          agent: agent.name,
          model: `${model.providerID}/${model.modelID}`,
        },
        { throwOnError: true },
      )
      const sessionID = res.data?.sessionID
      if (sessionID) {
        toast.show({ variant: "success", message: "托管任务已启动" })
        route.navigate({ type: "session", sessionID })
      }
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "启动托管任务失败",
      })
    }
    dialog.clear()
  }

  return (
    <DialogSelect
      title="托管模式 - 选择命令"
      options={options()}
      skipFilter={false}
      onSelect={(opt) => handleSelect(opt)}
      placeholder="Filter commands..."
    />
  )
}
