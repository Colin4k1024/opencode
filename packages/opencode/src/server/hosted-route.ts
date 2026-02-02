import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import z from "zod"
import { errors } from "./error"
import { ensureHostedIdleSubscription, hostedPermissionRuleset, hostedSessionIDs } from "./hosted"
import { Log } from "@/util/log"

const log = Log.create({ service: "server.hosted" })

export const HostedRoute = new Hono().post(
  "/hosted/run",
  describeRoute({
    summary: "Run hosted (background) command",
    description:
      "Create a session with full permissions and run a command in the background. When the session completes, a TUI toast is shown. No user interaction is required during execution.",
    operationId: "session.hosted.run",
    responses: {
      200: {
        description: "Hosted run started",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                sessionID: z.string().describe("Session ID for the hosted run"),
              }),
            ),
          },
        },
      },
      ...errors(400, 404),
    },
  }),
  validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
  async (c) => {
    ensureHostedIdleSubscription()
    const body = c.req.valid("json")
    const session = await Session.create({
      permission: hostedPermissionRuleset,
      title: `Hosted: ${body.command} ${body.arguments || ""}`.trim(),
    })
    hostedSessionIDs.add(session.id)
    void SessionPrompt.command({ ...body, sessionID: session.id }).catch((err) => {
      log.error("hosted run failed", { sessionID: session.id, error: err })
      if (hostedSessionIDs.has(session.id)) {
        hostedSessionIDs.delete(session.id)
        Bus.publish(TuiEvent.ToastShow, {
          message: "托管任务执行失败",
          variant: "error",
        })
      }
    })
    return c.json({ sessionID: session.id })
  },
)
