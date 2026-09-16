import { describe, expect, it } from "vitest"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { isSiteEnabled } from "../site-control"
import { isSiteEnabledBySnapshot, pickSiteControl } from "../site-control-light"

const BLACKLIST = {
  mode: "blacklist" as const,
  blacklistPatterns: ["example.com"],
  whitelistPatterns: [],
}
const WHITELIST = {
  mode: "whitelist" as const,
  blacklistPatterns: [],
  whitelistPatterns: ["example.com"],
}

describe("轻量读网站控制", () => {
  it("存储里的键和常量保持一致（写死了字面量，漂了要在这里被发现）", () => {
    expect(`local:${CONFIG_STORAGE_KEY}`).toBe("local:config")
  })

  it("从整份配置里只取网站控制那几项", () => {
    expect(pickSiteControl({ siteControl: BLACKLIST, providersConfig: [] })).toEqual(BLACKLIST)
  })

  it("没配置、格式不对都返回 null（当作启用）", () => {
    expect(pickSiteControl(null)).toBeNull()
    expect(pickSiteControl({})).toBeNull()
    expect(pickSiteControl({ siteControl: { mode: "unknown" } })).toBeNull()
    expect(pickSiteControl({ siteControl: { ...BLACKLIST, blacklistPatterns: [1] } })).toBeNull()
  })
})

describe("和 isSiteEnabled 判断一致", () => {
  const cases = [
    { url: "https://example.com/a", snapshot: BLACKLIST },
    { url: "https://sub.example.com/a", snapshot: BLACKLIST },
    { url: "https://other.com/a", snapshot: BLACKLIST },
    { url: "https://example.com/a", snapshot: WHITELIST },
    { url: "https://other.com/a", snapshot: WHITELIST },
    { url: "not a url", snapshot: BLACKLIST },
  ]

  it.each(cases)("$url ($snapshot.mode)", ({ url, snapshot }) => {
    const full = { siteControl: snapshot } as unknown as Parameters<typeof isSiteEnabled>[1]
    expect(isSiteEnabledBySnapshot(url, snapshot)).toBe(isSiteEnabled(url, full))
  })

  it("读不到配置就当启用", () => {
    expect(isSiteEnabledBySnapshot("https://example.com", null)).toBe(true)
  })
})
