/**
 * 字幕听写面板（阶段五实现方案 · 步骤 3，参考每日英语听力、Daily Dictation）。
 *
 * 开启听写后，这个面板替换掉字幕框里的原文和译文：
 *   播放中  原文遮住（只露出词数和长短），译文不显示——看得到就不是听写了
 *   暂停时  出现输入框：打出听到的内容，回车对答案
 *   对完后  逐词标出：听对的正常显示，漏听的红底标出正确写法，多写的划掉；回车播下一句
 *
 * 键盘：输入框里的按键一律不往外冒泡。字幕挂在播放器里面，YouTube 的 k（暂停）、
 * j / l（快退快进）、f（全屏）、m（静音）会在打字时被误触发。
 */

import type { KeyboardEvent, Ref, SyntheticEvent } from "react"
import type { DictationResult } from "@/utils/subtitles/dictation"
import { useAtom, useAtomValue } from "jotai"
import { use, useEffect, useRef, useState } from "react"
import { addToStats, diffWords, maskSentence } from "@/utils/subtitles/dictation"
import { currentTimeMsAtom, dictationStatsAtom } from "../atoms"
import { SubtitlesUIContext } from "./subtitles-ui-context"
import { useSubtitleStudyActions } from "./use-subtitle-study"

const stop = (event: SyntheticEvent) => event.stopPropagation()

/** 视频现在是不是暂停着（跟着 play / pause 事件走） */
function useVideoPaused(): boolean {
  const ui = use(SubtitlesUIContext)
  const [paused, setPaused] = useState(() => ui?.getVideoElement?.()?.paused ?? true)
  useEffect(() => {
    const video = ui?.getVideoElement?.()
    if (!video) {
      return undefined
    }
    const update = () => setPaused(video.paused)
    update()
    video.addEventListener("play", update)
    video.addEventListener("pause", update)
    return () => {
      video.removeEventListener("play", update)
      video.removeEventListener("pause", update)
    }
  }, [ui])
  return paused
}

function DiffView({ result }: { result: DictationResult }) {
  return (
    <span className="leading-relaxed">
      {result.ops.map((op, index) => (
        // eslint-disable-next-line react/no-array-index-key -- 一次比对结果里顺序固定
        <span key={index}>
          {index > 0 && " "}
          {op.type === "match" && <span>{op.word}</span>}
          {op.type === "missing" && (
            <span className="rounded bg-red-500/75 px-1" title="漏听或听错的词">
              {op.word}
            </span>
          )}
          {op.type === "extra" && (
            <span className="text-white/50 line-through" title="多写或写错的词">
              {op.word}
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

function PanelButton({
  onClick,
  children,
  primary,
  ref,
}: {
  onClick: () => void
  children: string
  primary?: boolean
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onDoubleClick={stop}
      className={
        primary
          ? "rounded bg-white/90 px-2.5 py-1 text-sm text-black transition hover:bg-white"
          : "rounded bg-white/15 px-2.5 py-1 text-sm text-white transition hover:bg-white/25"
      }
    >
      {children}
    </button>
  )
}

export function DictationPanel() {
  const study = useSubtitleStudyActions()
  const paused = useVideoPaused()
  // 时间变了要重新判断现在是哪一句；暂停时时间不动，句子也就不变
  useAtomValue(currentTimeMsAtom)
  const cue = study.currentCue()
  const [stats, setStats] = useAtom(dictationStatsAtom)

  const [typed, setTyped] = useState("")
  const [result, setResult] = useState<DictationResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)

  // 换到下一句：清空上一句的作答
  const cueStart = cue?.start
  useEffect(() => {
    setTyped("")
    setResult(null)
    setRevealed(false)
  }, [cueStart])

  // 一暂停就把光标放进输入框，不用再拿鼠标点；对完答案后输入框收起，
  // 焦点移到「下一句」按钮上——按钮获得焦点时回车会直接触发它，整个过程不用碰鼠标
  useEffect(() => {
    if (!paused) {
      return
    }
    if (result) {
      nextButtonRef.current?.focus()
    } else {
      inputRef.current?.focus()
    }
  }, [paused, result, cueStart])

  if (!cue) {
    return <div className="text-base text-white/70">等待下一句字幕……</div>
  }

  const submit = () => {
    const next = diffWords(cue.text, typed)
    setResult(next)
    setStats(addToStats(stats, next))
  }

  const replay = () => {
    // 保留已经打的内容，方便对照着改；清掉比对结果，重新作答
    setResult(null)
    setRevealed(false)
    study.playCue(cue)
  }

  const next = () => study.playCue(study.nextCue())

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      if (result) {
        next()
      } else {
        submit()
      }
    }
  }

  return (
    <div
      className="flex flex-col items-center gap-2 px-1 py-0.5"
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      // 面板里任何按键都不往播放器冒泡：在按钮上按空格也会被 YouTube 当成暂停 / 播放
      onKeyDown={stop}
      onKeyUp={stop}
    >
      <div className="text-xl leading-snug">
        {result ? (
          <DiffView result={result} />
        ) : revealed ? (
          cue.text
        ) : (
          <span className="tracking-wider text-white/80">{maskSentence(cue.text)}</span>
        )}
      </div>

      {result && (
        <div className="text-sm text-white/80">
          本句正确率 {Math.round(result.accuracy * 100)}%（{result.matched} / {result.total}）
        </div>
      )}

      {paused ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {!result && (
            <input
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={onKeyDown}
              onKeyUp={stop}
              onKeyPress={stop}
              placeholder="输入听到的内容，回车提交"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-72 max-w-full rounded bg-white/10 px-2 py-1 text-base text-white outline-none placeholder:text-white/50 focus:bg-white/15"
            />
          )}
          {result ? (
            <PanelButton ref={nextButtonRef} primary onClick={next}>
              下一句（回车）
            </PanelButton>
          ) : (
            <PanelButton primary onClick={submit}>
              提交
            </PanelButton>
          )}
          <PanelButton onClick={replay}>重听本句</PanelButton>
          {!result && !revealed && (
            <PanelButton onClick={() => setRevealed(true)}>显示原文</PanelButton>
          )}
        </div>
      ) : (
        <div className="text-xs text-white/70">本句播放完毕后会自动暂停，届时输入你听到的内容</div>
      )}
    </div>
  )
}
