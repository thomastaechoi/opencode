import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"

const API_CONFIG = {
  BASE_URL: "https://www.googleapis.com/customsearch/v1",
  DEFAULT_NUM_RESULTS: 10,
  TIMEOUT_MS: 30000,
} as const

interface GoogleSearchResult {
  title: string
  link: string
  snippet: string
  displayLink?: string
}

interface GoogleSearchResponse {
  items?: GoogleSearchResult[]
  searchInformation?: {
    totalResults: string
    searchTime: number
  }
  error?: {
    code: number
    message: string
  }
}

export const WebSearchTool = Tool.define("websearch", async () => {
  const apiKey = process.env.GOOGLE_API_KEY
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID

  return {
    get description() {
      if (!apiKey || !searchEngineId) {
        return `${DESCRIPTION.replace("{{date}}", new Date().toISOString().slice(0, 10))}\n\n**NOTE:** WebSearch is not configured. Set GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.`
      }
      return DESCRIPTION.replace("{{date}}", new Date().toISOString().slice(0, 10))
    },
    parameters: z.object({
      query: z.string().describe("The search query to use"),
      numResults: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Number of search results to return (1-10, default: 10)"),
    }),
    async execute(params, ctx) {
      if (!apiKey || !searchEngineId) {
        throw new Error(
          "WebSearch is not configured. Set GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.\n\n" +
            "Setup instructions:\n" +
            "1. Create a search engine at https://programmablesearchengine.google.com/\n" +
            "2. Enable 'Search the entire web' in settings\n" +
            "3. Get your API key from https://console.cloud.google.com/apis/credentials\n" +
            "4. Set GOOGLE_API_KEY=<your-api-key>\n" +
            "5. Set GOOGLE_SEARCH_ENGINE_ID=<your-search-engine-id>",
        )
      }

      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
        },
      })

      const numResults = params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS

      const url = new URL(API_CONFIG.BASE_URL)
      url.searchParams.set("key", apiKey)
      url.searchParams.set("cx", searchEngineId)
      url.searchParams.set("q", params.query)
      url.searchParams.set("num", numResults.toString())

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS)

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal: AbortSignal.any([controller.signal, ctx.abort]),
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Google Search API error (${response.status}): ${errorText}`)
        }

        const data: GoogleSearchResponse = await response.json()

        if (data.error) {
          throw new Error(`Google Search API error: ${data.error.message}`)
        }

        if (!data.items || data.items.length === 0) {
          return {
            output: "No search results found. Please try a different query.",
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }

        // Format results for LLM consumption
        const formattedResults = data.items
          .map((item, index) => {
            return `${index + 1}. **${item.title}**\n   URL: ${item.link}\n   ${item.snippet}`
          })
          .join("\n\n")

        const output = `Web search results for: "${params.query}"\n\n${formattedResults}\n\n---\nFound ${data.searchInformation?.totalResults || data.items.length} results in ${data.searchInformation?.searchTime || "N/A"} seconds.`

        return {
          output,
          title: `Web search: ${params.query}`,
          metadata: {},
        }
      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Search request timed out")
        }

        throw error
      }
    },
  }
})
