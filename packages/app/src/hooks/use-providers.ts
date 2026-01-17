import { useGlobalSync } from "@/context/global-sync"
import { base64Decode } from "@opencode-ai/util/encode"
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]
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

export function isLocalProvider(provider: ProviderInfo) {
  const options = provider.options ?? {}
  const candidates: string[] = []
  if (typeof options.baseURL === "string") candidates.push(options.baseURL)
  if (typeof options.endpoint === "string") candidates.push(options.endpoint)
  for (const model of Object.values(provider.models ?? {})) {
    if (typeof model.api?.url === "string") candidates.push(model.api.url)
  }
  return candidates.some(isLocalUrl)
}

export function getProviderGroup(provider: ProviderInfo) {
  if (popularProviders.includes(provider.id)) return "Popular"
  if (isLocalProvider(provider)) return "Local"
  return "Other"
}

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const currentDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const providers = createMemo(() => {
    if (currentDirectory()) {
      const [projectStore] = globalSync.child(currentDirectory())
      return projectStore.provider
    }
    return globalSync.data.provider
  })
  const connected = createMemo(() => providers().all.filter((p) => providers().connected.includes(p.id)))
  const paid = createMemo(() =>
    connected().filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input)),
  )
  const popular = createMemo(() => providers().all.filter((p) => popularProviders.includes(p.id)))
  return {
    all: createMemo(() => providers().all),
    default: createMemo(() => providers().default),
    popular,
    connected,
    paid,
  }
}
