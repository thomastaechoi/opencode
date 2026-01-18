import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"
import type { Provider as ProviderInfo } from "@opencode-ai/sdk/v2"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"])

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

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => {
    if (!connected()) return false
    if (props.providerID) return false
    return true
  })

  const options = createMemo(() => {
    const q = query()
    const needle = q.trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const isFavorite = (value: { providerID: string; modelID: string }) =>
      favorites.some((item) => item.providerID === value.providerID && item.modelID === value.modelID)

    const recentList = showSections
      ? recents.filter((item) => !isFavorite(item))
      : []
    const isRecent = (value: { providerID: string; modelID: string }) =>
      recentList.some((item) => item.providerID === value.providerID && item.modelID === value.modelID)

    const favoriteOptions = showSections
      ? favorites.flatMap((item) => {
          const provider = sync.data.provider.find((x) => x.id === item.providerID)
          if (!provider) return []
          const model = provider.models[item.modelID]
          if (!model) return []
          return [
            {
              key: item,
              value: {
                providerID: provider.id,
                modelID: model.id,
              },
              title: model.name ?? item.modelID,
              description: provider.name,
              category: "Favorites",
              disabled: provider.id === "opencode" && model.id.includes("-nano"),
              footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
              onSelect: () => {
                dialog.clear()
                local.model.set(
                  {
                    providerID: provider.id,
                    modelID: model.id,
                  },
                  { recent: true },
                )
              },
            },
          ]
        })
      : []

    const recentOptions = showSections
      ? recentList.flatMap((item) => {
          const provider = sync.data.provider.find((x) => x.id === item.providerID)
          if (!provider) return []
          const model = provider.models[item.modelID]
          if (!model) return []
          return [
            {
              key: item,
              value: {
                providerID: provider.id,
                modelID: model.id,
              },
              title: model.name ?? item.modelID,
              description: provider.name,
              category: "Recent",
              disabled: provider.id === "opencode" && model.id.includes("-nano"),
              footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
              onSelect: () => {
                dialog.clear()
                local.model.set(
                  {
                    providerID: provider.id,
                    modelID: model.id,
                  },
                  { recent: true },
                )
              },
            },
          ]
        })
      : []

    const localOptions = showSections
      ? pipe(
          sync.data.provider,
          filter((provider) => isLocalProvider(provider)),
          flatMap((provider) =>
            pipe(
              provider.models,
              entries(),
              filter(([_, info]) => info.status !== "deprecated"),
              filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
              map(([model, info]) => {
                const value = {
                  providerID: provider.id,
                  modelID: model,
                }
                return {
                  value,
                  title: info.name ?? model,
                  description: provider.name,
                  category: "Local Models",
                  disabled: provider.id === "opencode" && model.includes("-nano"),
                  footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
                  onSelect() {
                    dialog.clear()
                    local.model.set(
                      {
                        providerID: provider.id,
                        modelID: model,
                      },
                      { recent: true },
                    )
                  },
                }
              }),
              filter((x) => {
                if (!showSections) return true
                const value = x.value
                return !isFavorite(value)
              }),
              sortBy(
                (x) => x.footer !== "Free",
                (x) => x.title,
              ),
            ),
          ),
        )
      : []

    const providerOptions = pipe(
      sync.data.provider,
      filter((provider) => (!showSections ? true : !isLocalProvider(provider))),
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const value = {
              providerID: provider.id,
              modelID: model,
            }
            return {
              value,
              title: info.name ?? model,
              description: isFavorite(value) ? "(Favorite)" : undefined,
              category: connected() ? provider.name : undefined,
              disabled: provider.id === "opencode" && model.includes("-nano"),
              footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
              onSelect() {
                dialog.clear()
                local.model.set(
                  {
                    providerID: provider.id,
                    modelID: model,
                  },
                  { recent: true },
                )
              },
            }
          }),
          filter((x) => {
            if (!showSections) return true
            const value = x.value
            if (isFavorite(value)) return false
            if (isRecent(value)) return false
            return true
          }),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => {
            return {
              ...option,
              category: "Popular providers",
            }
          }),
          take(6),
        )
      : []

    // Search shows a single merged list (favorites inline)
    if (needle) {
      const filteredProviders = fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
      const filteredPopular = fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj)
      return [...filteredProviders, ...filteredPopular]
    }

    return [...favoriteOptions, ...recentOptions, ...localOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (provider()) return provider()!.name
    return "Select model"
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      ref={setRef}
      onFilter={setQuery}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      options={options()}
    />
  )
}
