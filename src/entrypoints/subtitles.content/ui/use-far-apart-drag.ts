import type { RefObject } from "react"
import { useAtom, useSetAtom } from "jotai"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getContainingShadowRoot } from "@/utils/host/dom/node"
import { farApartTranslationPercentAtom } from "../atoms"

/**
 * 顶部译文的垂直拖拽。
 *
 * 比底部字幕的 useVerticalDrag 简单一档，因为这一行永远锚在顶部：
 * 「拉开距离」的全部意义就是它待在上面、离原文足够远，允许它锚到底部
 * 等于把这个模式本身取消掉。所以这里只有一个"距顶百分比"，
 * 没有 anchor 切换，也不用避让底部控件栏。
 */

/** 留出余量，别让人把译文拖到完全看不见或者贴死在原文上 */
const MIN_PERCENT = 0
const MAX_PERCENT = 60

function getVideoContainer(element: HTMLElement): HTMLElement | null {
  const rootNode = getContainingShadowRoot(element)
  const shadowHost = rootNode?.host as HTMLElement | undefined
  return shadowHost?.parentElement ?? null
}

export function useFarApartDrag(): {
  refs: { container: RefObject<HTMLDivElement | null>; handle: RefObject<HTMLDivElement | null> }
  topPercent: number
  isDragging: boolean
} {
  const setVideoSubtitles = useSetAtom(configFieldsAtomMap.videoSubtitles)
  const [percent, setPercent] = useAtom(farApartTranslationPercentAtom)
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startPercentRef = useRef(percent)
  const [isDragging, setIsDragging] = useState(false)

  const onMouseDown = useEffectEvent((e: MouseEvent) => {
    if (e.button !== 0) return
    isDraggingRef.current = true
    setIsDragging(true)
    startYRef.current = e.clientY
    startPercentRef.current = percent
    e.preventDefault()
    e.stopPropagation()
  })

  const onMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!isDraggingRef.current) return
    const container = containerRef.current
    if (!container) return

    const videoContainer = getVideoContainer(container)
    if (!videoContainer) return

    const videoHeight = videoContainer.getBoundingClientRect().height
    if (videoHeight <= 0) return

    const deltaPercent = ((e.clientY - startYRef.current) / videoHeight) * 100
    const next = startPercentRef.current + deltaPercent
    setPercent(Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, next)))
  })

  const onMouseUp = useEffectEvent(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)
    // 只在松手时落盘：拖动过程中每帧都写配置会把 storage 打爆
    void setVideoSubtitles({ farApartTranslationPercent: percent })
  })

  const setupListeners = useEffectEvent(() => {
    const handle = handleRef.current
    if (!handle) return undefined

    handle.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)

    return () => {
      handle.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  })

  useEffect(() => {
    return setupListeners()
  }, [])

  return {
    refs: { container: containerRef, handle: handleRef },
    topPercent: percent,
    isDragging,
  }
}
