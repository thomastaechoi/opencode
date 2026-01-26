import { Component, Show, createMemo } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getProviderGroup, popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { IconName } from "@opencode-ai/ui/icons/provider"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"

const groupOrder = { Popular: 0, Local: 1, Other: 2 } as const
type GroupKey = keyof typeof groupOrder

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()
  type ProviderInfo = ReturnType<typeof providers.all>[number]
  const connectedIDs = createMemo(() => new Set(providers.connected().map((provider) => provider.id)))
  const isDisabled = (provider: ProviderInfo) =>
    getProviderGroup(provider) === "Local" && !connectedIDs().has(provider.id)

  return (
    <Dialog title={language.t("command.provider.connect")}>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return providers.all()
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => getProviderGroup(x)}
        sortBy={(a, b) => {
          const aGroup = getProviderGroup(a)
          const bGroup = getProviderGroup(b)
          if (aGroup !== bGroup) return groupOrder[aGroup] - groupOrder[bGroup]
          if (aGroup === "Popular") return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          if (aGroup === "Local") {
            const aDisabled = isDisabled(a)
            const bDisabled = isDisabled(b)
            if (aDisabled !== bDisabled) return aDisabled ? 1 : -1
          }
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const aOrder = groupOrder[(a.category ?? "Other") as GroupKey] ?? 99
          const bOrder = groupOrder[(b.category ?? "Other") as GroupKey] ?? 99
          return aOrder - bOrder
        }}
        onSelect={(x) => {
          if (!x) return
          if (isDisabled(x)) return
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => {
          const disabled = isDisabled(i)
          return (
            <div class="px-1.25 w-full flex items-center gap-x-3" classList={{ "opacity-50": disabled }}>
              <ProviderIcon data-slot="list-item-extra-icon" id={i.id as IconName} />
              <span>
                {i.name}
                <Show when={disabled}>
                  <span class="ml-1 text-14-regular text-text-weak">(disabled)</span>
                </Show>
              </span>
              <Show when={i.id === "opencode"}>
                <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
              </Show>
              <Show when={i.id === "anthropic"}>
                <div class="text-14-regular text-text-weak">{language.t("dialog.provider.anthropic.note")}</div>
              </Show>
              <Show when={i.id === "openai"}>
                <div class="text-14-regular text-text-weak">{language.t("dialog.provider.openai.note")}</div>
              </Show>
              <Show when={i.id.startsWith("github-copilot")}> 
                <div class="text-14-regular text-text-weak">{language.t("dialog.provider.copilot.note")}</div>
              </Show>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
