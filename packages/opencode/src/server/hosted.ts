import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "@/session/status"

/** Session IDs for hosted (background) runs; when session goes idle we show Toast and remove. */
export const hostedSessionIDs = new Set<string>()

/** Permission ruleset for hosted sessions: all allow so no TUI permission dialogs. */
export const hostedPermissionRuleset = PermissionNext.fromConfig({
  "*": "allow",
  skill: "allow",
  doom_loop: "allow",
  question: "allow",
  plan_enter: "allow",
  plan_exit: "allow",
  read: "allow",
  edit: "allow",
  write: "allow",
  bash: "allow",
  grep: "allow",
  glob: "allow",
  list: "allow",
  todoread: "allow",
  todowrite: "allow",
  task: "allow",
  webfetch: "allow",
  sql: "allow",
  config_reader: "allow",
  sequential_thinking: "allow",
  external_directory: { "*": "allow" },
})

let subscribed = false
/** Call once when handling a request so subscription runs with Instance context. */
export function ensureHostedIdleSubscription() {
  if (subscribed) return
  subscribed = true
  Bus.subscribe(SessionStatus.Event.Idle, (event) => {
    const { sessionID } = event.properties
    if (!hostedSessionIDs.has(sessionID)) return
    hostedSessionIDs.delete(sessionID)
    Bus.publish(TuiEvent.ToastShow, {
      message: "托管任务已完成",
      variant: "success",
    })
  })
}
