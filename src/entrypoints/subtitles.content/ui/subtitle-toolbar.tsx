import type { RefObject } from "react"
import { IconGripHorizontal, IconMinus, IconPlus } from "@tabler/icons-react"
import { useAtomValue, useSetAtom } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { MAX_FONT_SCALE, MIN_FONT_SCALE } from "@/utils/constants/subtitles"
import { SubtitleStudyControls } from "./subtitle-study-controls"

/** 每次点 +/- 调整的档位。5 太碎要点很多下，20 又跨得太狠，10 一档刚好 */
const FONT_SCALE_STEP = 10

/** 这个工具条管哪几行的字号 */
export type ToolbarTarget = "main" | "translation" | "both"

interface SubtitleToolbarProps {
  /** 拖拽手柄的 ref，交给对应的拖拽 hook */
  handleRef: RefObject<HTMLDivElement | null>
  target: ToolbarTarget
  /** 带上字幕学习模式的按钮（上一句、下一句、逐句暂停、单句循环） */
  study?: boolean
}

/**
 * 悬停在字幕上才出现的小工具条：拖拽手柄 + 放大/缩小。
 *
 * 看视频时想调整，不该逼人退出全屏、翻进设置页找滑块。字号用 +/- 按钮而不是
 * 在字幕上滚轮：滚轮在 YouTube 上本来就有事做（滚页面、调音量），
 * 抢过来必然误触。
 */
export function SubtitleToolbar({ handleRef, target, study }: SubtitleToolbarProps) {
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  const setVideoSubtitles = useSetAtom(configFieldsAtomMap.videoSubtitles)

  // 一个框里可能同时有两行（普通模式），那就一起调，
  // 否则用户得分别调两次才能把整块字幕改大
  const targets: ("main" | "translation")[] = target === "both" ? ["main", "translation"] : [target]

  const currentScale = Math.round(
    targets.reduce((sum, key) => sum + style[key].fontScale, 0) / targets.length,
  )

  const adjust = (delta: number) => {
    const next = Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, currentScale + delta))
    if (next === currentScale) return
    // 展开原 style 再覆盖目标行：这个 setter 要的是完整的 style，
    // 只传改动的那一部分会把没传的字段抹掉
    const nextStyle = { ...style }
    for (const key of targets) {
      nextStyle[key] = { ...style[key], fontScale: next }
    }
    void setVideoSubtitles({ style: nextStyle })
  }

  const atMin = currentScale <= MIN_FONT_SCALE
  const atMax = currentScale >= MAX_FONT_SCALE

  return (
    <div className="pointer-events-auto mb-0.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 has-[:active]:opacity-100">
      <div
        ref={handleRef}
        className="cursor-grab rounded bg-black/75 px-2 py-1 active:cursor-grabbing active:opacity-100"
        title="拖动调整位置"
      >
        <IconGripHorizontal className="size-4 text-white" />
      </div>

      <button
        type="button"
        onClick={() => adjust(-FONT_SCALE_STEP)}
        disabled={atMin}
        aria-label="缩小字幕"
        title="缩小字幕"
        className="rounded bg-black/75 px-1.5 py-1 text-white transition-opacity hover:bg-black/90 disabled:opacity-40"
      >
        <IconMinus className="size-4" />
      </button>

      <span className="rounded bg-black/75 px-1.5 py-1 text-[11px] text-white tabular-nums">
        {currentScale}%
      </span>

      <button
        type="button"
        onClick={() => adjust(FONT_SCALE_STEP)}
        disabled={atMax}
        aria-label="放大字幕"
        title="放大字幕"
        className="rounded bg-black/75 px-1.5 py-1 text-white transition-opacity hover:bg-black/90 disabled:opacity-40"
      >
        <IconPlus className="size-4" />
      </button>

      {study && <SubtitleStudyControls />}
    </div>
  )
}
