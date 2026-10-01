// @vitest-environment jsdom
import type { ProviderConfig } from "@/types/config/provider"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ProviderSelector from "@/components/llm-providers/provider-selector"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}))

function getProviders(): ProviderConfig[] {
  return DEFAULT_CONFIG.providersConfig.filter((provider) => provider.enabled)
}

describe("providerSelector", () => {
  // 词典默认挂的是免费的微软翻译，它不在大模型候选列表里：当前供应商找不到时，
  // Select 会把 null 交给渲染函数。以前这里直接读 null 的字段，整个划词弹窗崩溃，
  // 表现为"点了词典按钮什么都没发生"
  it("does not crash when the current provider is not in the candidate list", () => {
    const providers = getProviders()
    expect(() =>
      render(
        <ProviderSelector providers={providers} value="not-in-the-list" onChange={() => {}} />,
      ),
    ).not.toThrow()
  })

  it("shows the placeholder instead of the provider when nothing matches", () => {
    const { container } = render(
      <ProviderSelector
        providers={getProviders()}
        value="not-in-the-list"
        onChange={() => {}}
        placeholder="选择供应商"
      />,
    )
    expect(container.textContent).toContain("选择供应商")
  })
})
