export function getPageTranslationOriginScope(url: string): string | null {
  try {
    const urlObj = new URL(url)

    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") return null

    return urlObj.origin
  } catch {
    return null
  }
}

export function areSamePageTranslationOrigin(from: string, to: string): boolean {
  const fromScope = getPageTranslationOriginScope(from)
  const toScope = getPageTranslationOriginScope(to)

  return fromScope !== null && fromScope === toScope
}

export function matchDomainPattern(url: string, pattern: string): boolean {
  // 用 URL 构造函数判断能不能解析，而不是 z.url()：这个函数被只需要判断
  // 「这个网站启不启用」的内容脚本用到，为这一句把整个 zod 拖进 bundle 不值当
  // （生词高亮、中文夹词两个脚本因此各胖了 0.9 MB）。行为一致：解析不了的一律不匹配。
  let urlObj: URL
  try {
    urlObj = new URL(url)
  } catch {
    return false
  }

  const hostname = urlObj.hostname.toLowerCase()
  const patternLower = pattern.toLowerCase().trim()

  if (hostname === patternLower) {
    return true
  }

  if (hostname.endsWith(`.${patternLower}`)) {
    return true
  }

  return false
}
