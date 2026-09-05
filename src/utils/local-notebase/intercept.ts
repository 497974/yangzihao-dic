/**
 * 本地笔记库 · 请求拦截层
 *
 * 所有本该发往远端 API 的请求，在后台被截下来就地处理：
 *   - /api/rpc/*      → 内嵌的 ORPC 路由（笔记库 + 闪卡，数据存 chrome.storage）
 *   - /api/identity/* → 本地身份，永远处于已登录状态
 *
 * 因此本扩展不需要任何服务器，也不需要联网账号。
 */

import type { ProxyRequest, ProxyResponse } from "@/types/proxy-fetch"
import { RPCHandler } from "@orpc/server/fetch"
import { AUTH_BASE_PATH, ORPC_PREFIX } from "@read-frog/definitions"
import { localNotebaseRouter } from "./router"
import { localSrsRouter } from "./srs-router"

// 笔记库 + 闪卡/间隔重复，合并成一个本地路由树
const rpcHandler = new RPCHandler({
  ...localNotebaseRouter,
  ...localSrsRouter,
})

/** 本地用户 —— 不对应任何真实账号，仅用于满足界面上的登录态判断。 */
export const LOCAL_ACCOUNT = {
  id: "local-user",
  name: "本地用户",
  email: "local@localhost",
  image: null as string | null,
  emailVerified: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function jsonResponse(data: unknown, status = 200): ProxyResponse {
  return {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: [["content-type", "application/json"]],
    body: JSON.stringify(data),
  }
}

/**
 * 判断一个 URL 是否该由本地接管。
 * 只认路径，不认域名 —— 构建时 API 地址可能被配成任何值。
 */
export function isLocalApiRequest(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    return pathname.startsWith(ORPC_PREFIX) || pathname.startsWith(AUTH_BASE_PATH)
  } catch {
    return false
  }
}

export async function handleLocalApiRequest(input: ProxyRequest): Promise<ProxyResponse> {
  const { pathname } = new URL(input.url)

  // ── 身份：永远已登录 ──────────────────────────────────
  if (pathname.startsWith(AUTH_BASE_PATH)) {
    // 登出：界面允许点，但本地身份不会真的消失，返回空对象即可。
    if (pathname.endsWith("/sign-out")) return jsonResponse({ success: true })

    return jsonResponse({
      user: LOCAL_ACCOUNT,
      session: {
        id: "local-session",
        userId: LOCAL_ACCOUNT.id,
        // 一个远期过期时间，避免界面判定会话过期后反复弹登录框
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        token: "local",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    })
  }

  // ── 笔记库 RPC ────────────────────────────────────────
  const request = new Request(input.url, {
    method: input.method ?? "POST",
    headers: input.headers,
    body: input.body,
  })

  const { matched, response } = await rpcHandler.handle(request, { prefix: ORPC_PREFIX })

  if (!matched || !response) {
    return jsonResponse({ message: "Not found" }, 404)
  }

  // ProxyResponse.headers 的契约是键值对数组（见 types/proxy-fetch.ts），
  // 跟 proxy-fetch.ts 里真实网络分支的产出保持同一形状
  const headers: [string, string][] = [...response.headers.entries()]

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.text(),
  }
}
