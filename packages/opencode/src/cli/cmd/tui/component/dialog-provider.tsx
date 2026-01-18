import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderListResponse } from "@opencode-ai/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { useLocal } from "@tui/context/local"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"])
type ProviderInfo = ProviderListResponse["all"][number]

function normalizeUrl(input: string) {
  if (/^[a-z]+:\/\//i.test(input)) return input
  return `http://${input}`
}

function isLocalUrl(input?: string) {
  if (!input) return false
  try {
    const url = new URL(normalizeUrl(input))
    return LOCAL_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function isLocalProvider(provider: ProviderInfo) {
  const options = provider.options ?? {}
  const candidates: string[] = []
  if (typeof options.baseURL === "string") candidates.push(options.baseURL)
  if (typeof options.endpoint === "string") candidates.push(options.endpoint)
  for (const model of Object.values(provider.models ?? {})) {
    if (typeof model.api?.url === "string") candidates.push(model.api.url)
  }
  return candidates.some(isLocalUrl)
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const local = useLocal()
  const connected = createMemo(() => new Set(sync.data.provider_next.connected))
  const activeProviderID = createMemo(() => local.model.current()?.providerID)
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      map((provider) => {
        const isPopular = provider.id in PROVIDER_PRIORITY
        const isLocal = !isPopular && isLocalProvider(provider)
        const isConnected = connected().has(provider.id)
        const isDisabled = isLocal && !isConnected
        const isActive = isConnected && activeProviderID() === provider.id
        const descriptionParts = [
          {
            opencode: "(Recommended)",
            anthropic: "(Claude Max or API key)",
            openai: "(ChatGPT Plus/Pro or API key)",
          }[provider.id],
          isDisabled ? "(disabled)" : undefined,
        ].filter(Boolean)
        return {
          provider,
          category: isPopular ? "Popular" : isLocal ? "Local" : "Other",
          groupRank: isPopular ? 0 : isLocal ? 1 : 2,
          priority: PROVIDER_PRIORITY[provider.id] ?? 99,
          isConnected,
          isLocal,
          isDisabled,
          isActive,
          description: descriptionParts.join(" "),
        }
      }),
      sortBy(
        (item) => item.groupRank,
        (item) => (item.groupRank === 1 ? (item.isDisabled ? 1 : 0) : 0),
        (item) => (item.groupRank === 0 ? item.priority : 0),
        (item) => item.provider.name,
      ),
      map((item) => {
        const provider = item.provider
        return {
          title: provider.name,
          value: provider.id,
          description: item.description || undefined,
          category: item.category,
          footer: item.isActive ? "Active" : item.isConnected ? "Configured" : undefined,
          disabled: item.isDisabled,
          async onSelect() {
            if (item.isConnected) {
              return dialog.replace(() => <DialogModel providerID={provider.id} />)
            }
            const methods = sync.data.provider_auth[provider.id] ?? [
              {
                type: "api",
                label: "API key",
              },
            ]
            let index: number | null = 0
            if (methods.length > 1) {
              index = await new Promise<number | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title="Select auth method"
                      options={methods.map((x, index) => ({
                        title: x.label,
                        value: index,
                      }))}
                      onSelect={(option) => resolve(option.value)}
                    />
                  ),
                  () => resolve(null),
                )
              })
            }
            if (index == null) return
            const method = methods[index]
            if (method.type === "oauth") {
              const result = await sdk.client.provider.oauth.authorize({
                providerID: provider.id,
                method: index,
              })
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod
                    providerID={provider.id}
                    title={method.label}
                    index={index}
                    authorization={result.data!}
                  />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod
                    providerID={provider.id}
                    title={method.label}
                    index={index}
                    authorization={result.data!}
                  />
                ))
              }
            }
            if (method.type === "api") {
              return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
            }
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} showDisabled />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "opencode" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>
              OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API key.
            </text>
            <text fg={theme.text}>
              Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
            </text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
