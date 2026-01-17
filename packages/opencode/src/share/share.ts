import { Bus } from "../bus"
import { Config } from "../config/config"
import { Installation } from "../installation"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Log } from "../util/log"
import { Privacy } from "../util/privacy"

export namespace Share {
  const log = Log.create({ service: "share" })

  let queue: Promise<void> = Promise.resolve()
  const pending = new Map<string, any>()

  export async function sync(key: string, content: any) {
    if (disabled) return
    const [root, ...splits] = key.split("/")
    if (root !== "session") return
    const [sub, sessionID] = splits
    if (sub === "share") return
    const share = await Session.getShare(sessionID).catch(() => {})
    if (!share) return
    const { secret } = share
    pending.set(key, content)
    queue = queue
      .then(async () => {
        const content = pending.get(key)
        if (content === undefined) return
        pending.delete(key)
        const cfg = await Config.get().catch(() => undefined)
        Privacy.assertOpencodeCloudAllowed({ feature: "legacy share sync", url: URL, config: cfg })

        return fetch(`${URL}/share_sync`, {
          method: "POST",
          body: JSON.stringify({
            sessionID: sessionID,
            secret,
            key: key,
            content,
          }),
        })
      })
      .then((x) => {
        if (x) {
          log.info("synced", {
            key: key,
            status: x.status,
          })
        }
      })
  }

  export function init() {
    Bus.subscribe(Session.Event.Updated, async (evt) => {
      await sync("session/info/" + evt.properties.info.id, evt.properties.info)
    })
    Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      await sync("session/message/" + evt.properties.info.sessionID + "/" + evt.properties.info.id, evt.properties.info)
    })
    Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      await sync(
        "session/part/" +
          evt.properties.part.sessionID +
          "/" +
          evt.properties.part.messageID +
          "/" +
          evt.properties.part.id,
        evt.properties.part,
      )
    })
  }

  export const URL =
    process.env["OPENCODE_API"] ??
    (Installation.isPreview() || Installation.isLocal() ? "https://api.dev.opencode.ai" : "https://api.opencode.ai")

  const disabled = process.env["OPENCODE_DISABLE_SHARE"] === "true" || process.env["OPENCODE_DISABLE_SHARE"] === "1"

  export async function create(sessionID: string) {
    if (disabled) return { url: "", secret: "" }
    const cfg = await Config.get().catch(() => undefined)
    Privacy.assertOpencodeCloudAllowed({ feature: "legacy share create", url: URL, config: cfg })
    return fetch(`${URL}/share_create`, {
      method: "POST",
      body: JSON.stringify({ sessionID: sessionID }),
    })
      .then((x) => x.json())
      .then((x) => x as { url: string; secret: string })
  }

  export async function remove(sessionID: string, secret: string) {
    if (disabled) return {}
    const cfg = await Config.get().catch(() => undefined)
    Privacy.assertOpencodeCloudAllowed({ feature: "legacy share delete", url: URL, config: cfg })
    return fetch(`${URL}/share_delete`, {
      method: "POST",
      body: JSON.stringify({ sessionID, secret }),
    }).then((x) => x.json())
  }
}
