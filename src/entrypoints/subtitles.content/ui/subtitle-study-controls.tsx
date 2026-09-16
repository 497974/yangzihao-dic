import type { ReactNode } from "react"
import {
  IconKeyboard,
  IconPlayerPause,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconRepeat,
  IconRotate,
} from "@tabler/icons-react"
import { useAtomValue } from "jotai"
import { cn } from "@/utils/styles/utils"
import { averageAccuracy } from "@/utils/subtitles/dictation"
import { dictationStatsAtom } from "../atoms"
import { useSubtitleStudyActions } from "./use-subtitle-study"

function StudyButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      // 按钮在播放器里面：点击、双击冒上去会被播放器当成「暂停/播放」「全屏」
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "rounded px-1.5 py-1 transition-colors",
        active
          ? "bg-white/90 text-black hover:bg-white"
          : "bg-black/75 text-white hover:bg-black/90",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  )
}

/**
 * 字幕学习模式的按钮，放在悬停字幕时出现的小工具条上：
 * 上一句 · 重播这句 · 下一句 · 逐句暂停 · 单句循环。
 * 开着的开关是白底，一眼能看出现在是不是在逐句暂停 / 循环。
 */
export function SubtitleStudyControls() {
  const study = useSubtitleStudyActions()
  const dictationStats = useAtomValue(dictationStatsAtom)

  return (
    <div className="ml-1 flex items-center gap-0.5">
      <StudyButton label="上一句" onClick={study.previous}>
        <IconPlayerTrackPrev className="size-4" />
      </StudyButton>
      <StudyButton label="重播这句" onClick={study.replay}>
        <IconRotate className="size-4" />
      </StudyButton>
      <StudyButton label="下一句" onClick={study.next}>
        <IconPlayerTrackNext className="size-4" />
      </StudyButton>
      <StudyButton
        label={study.autoPause ? "逐句暂停：开（每句播完停下，方便跟读）" : "逐句暂停：关"}
        active={study.autoPause}
        onClick={study.toggleAutoPause}
      >
        <IconPlayerPause className="size-4" />
      </StudyButton>
      <StudyButton
        label={
          study.dictation
            ? "听写时不能单句循环"
            : study.looping
              ? "单句循环：开（再点一下取消）"
              : "单句循环：反复播这一句"
        }
        active={study.looping}
        disabled={study.dictation}
        onClick={study.toggleLoop}
      >
        <IconRepeat className="size-4" />
      </StudyButton>
      <StudyButton
        label={
          study.dictation ? "听写：开（再点一下退出）" : "听写：遮住字幕，每句播完打出听到的内容"
        }
        active={study.dictation}
        onClick={study.toggleDictation}
      >
        <IconKeyboard className="size-4" />
      </StudyButton>
      {study.dictation && dictationStats.lines > 0 && (
        <span className="ml-1 rounded bg-black/75 px-1.5 py-1 text-[11px] text-white tabular-nums">
          已听写 {dictationStats.lines} 句 · 平均{" "}
          {Math.round(averageAccuracy(dictationStats) * 100)}%
        </span>
      )}
    </div>
  )
}
