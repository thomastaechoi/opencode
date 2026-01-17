import { Privacy } from "@/util/privacy"

test("isOpenCodeHostedUrl detects opencode-hosted domains", () => {
  expect(Privacy.isOpenCodeHostedUrl("https://opncd.ai/share/abc")).toBe(true)
  expect(Privacy.isOpenCodeHostedUrl("https://api.opencode.ai/share_create")).toBe(true)
  expect(Privacy.isOpenCodeHostedUrl("https://app.opencode.ai/")).toBe(true)
  expect(Privacy.isOpenCodeHostedUrl("https://example.com/")).toBe(false)
})

test("assertOpencodeCloudAllowed blocks opencode-hosted URLs when configured", () => {
  expect(() =>
    Privacy.assertOpencodeCloudAllowed({
      feature: "share",
      url: "https://opncd.ai/api/share",
      config: { privacy: { disableOpencodeCloud: true } },
    }),
  ).toThrow()

  expect(() =>
    Privacy.assertOpencodeCloudAllowed({
      feature: "share",
      url: "https://example.com/api/share",
      config: { privacy: { disableOpencodeCloud: true } },
    }),
  ).not.toThrow()
})

