import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import path from "path"
import { WebSearchTool } from "../../src/tool/websearch"
import { Instance } from "../../src/project/instance"
import type { PermissionNext } from "../../src/permission/next"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.websearch", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("throws error when env vars not configured", async () => {
    delete process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_SEARCH_ENGINE_ID

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        await expect(
          websearch.execute(
            {
              query: "test query",
            },
            ctx,
          ),
        ).rejects.toThrow("WebSearch is not configured")
      },
    })
  })

  test("description indicates not configured when env vars missing", async () => {
    delete process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_SEARCH_ENGINE_ID

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        expect(websearch.description).toContain("not configured")
        expect(websearch.description).toContain("GOOGLE_API_KEY")
      },
    })
  })

  test("asks for websearch permission with query pattern", async () => {
    process.env.GOOGLE_API_KEY = "test-key"
    process.env.GOOGLE_SEARCH_ENGINE_ID = "test-cx"

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []

        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
            // Simulate rejection to prevent actual API call
            throw new Error("Permission denied for test")
          },
        }

        await expect(
          websearch.execute(
            {
              query: "test search query",
            },
            testCtx,
          ),
        ).rejects.toThrow("Permission denied for test")

        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("websearch")
        expect(requests[0].patterns).toContain("test search query")
        expect(requests[0].always).toContain("*")
      },
    })
  })
})


describe("tool.websearch response formatting", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("formats search results correctly", async () => {
    process.env.GOOGLE_API_KEY = "test-key"
    process.env.GOOGLE_SEARCH_ENGINE_ID = "test-cx"

    const mockResponse = {
      items: [
        {
          title: "Test Result 1",
          link: "https://example.com/1",
          snippet: "This is the first result snippet",
        },
        {
          title: "Test Result 2",
          link: "https://example.com/2",
          snippet: "This is the second result snippet",
        },
      ],
      searchInformation: {
        totalResults: "100",
        searchTime: 0.25,
      },
    }

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response),
    ) as unknown as typeof fetch

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const result = await websearch.execute(
          {
            query: "test query",
          },
          ctx,
        )

        expect(result.output).toContain("Test Result 1")
        expect(result.output).toContain("https://example.com/1")
        expect(result.output).toContain("first result snippet")
        expect(result.output).toContain("Test Result 2")
        expect(result.output).toContain("100 results")
        expect(result.output).toContain("0.25 seconds")
      },
    })
  })

  test("handles no results", async () => {
    process.env.GOOGLE_API_KEY = "test-key"
    process.env.GOOGLE_SEARCH_ENGINE_ID = "test-cx"

    const mockResponse = {
      searchInformation: {
        totalResults: "0",
        searchTime: 0.1,
      },
    }

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response),
    ) as unknown as typeof fetch

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const result = await websearch.execute(
          {
            query: "xyznonexistentquery123",
          },
          ctx,
        )

        expect(result.output).toContain("No search results found")
      },
    })
  })

  test("handles API errors", async () => {
    process.env.GOOGLE_API_KEY = "test-key"
    process.env.GOOGLE_SEARCH_ENGINE_ID = "test-cx"

    const mockErrorResponse = {
      error: {
        code: 403,
        message: "API key invalid",
      },
    }

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockErrorResponse),
      } as Response),
    ) as unknown as typeof fetch

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        await expect(
          websearch.execute(
            {
              query: "test",
            },
            ctx,
          ),
        ).rejects.toThrow("API key invalid")
      },
    })
  })

  test("handles HTTP errors", async () => {
    process.env.GOOGLE_API_KEY = "test-key"
    process.env.GOOGLE_SEARCH_ENGINE_ID = "test-cx"

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      } as Response),
    ) as unknown as typeof fetch

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        await expect(
          websearch.execute(
            {
              query: "test",
            },
            ctx,
          ),
        ).rejects.toThrow("Google Search API error (500)")
      },
    })
  })
})
