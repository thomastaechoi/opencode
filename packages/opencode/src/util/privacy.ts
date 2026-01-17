import type { Config } from "@/config/config"
import { Flag } from "@/flag/flag"

export namespace Privacy {
  export function opencodeCloudDisabled(config?: Config.Info): boolean {
    return Flag.OPENCODE_DISABLE_OPENCODE_CLOUD || config?.privacy?.disableOpencodeCloud === true
  }

  export function isOpenCodeHostedUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return isOpenCodeHostedHostname(hostname)
    } catch {
      return false
    }
  }

  export function isOpenCodeHostedHostname(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return host === "opencode.ai" || host.endsWith(".opencode.ai") || host === "opncd.ai" || host.endsWith(".opncd.ai")
  }

  export function assertOpencodeCloudAllowed(input: {
    feature: string
    url: string
    config?: Config.Info
  }) {
    if (!opencodeCloudDisabled(input.config)) return
    if (!isOpenCodeHostedUrl(input.url)) return
    throw new Error(
      `Blocked ${input.feature} request to ${input.url} (OpenCode cloud disabled). ` +
        `Set OPENCODE_DISABLE_OPENCODE_CLOUD=0 (or remove OPENCODE_PRIVACY) / config privacy.disableOpencodeCloud=false to allow.`,
    )
  }
}

