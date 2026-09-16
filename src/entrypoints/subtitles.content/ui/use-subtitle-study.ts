/**
 * 视频字幕学习模式（功能路线图阶段四第 1 条）：
 * - 点字幕里的词直接查词典，整句当语境（查的时候暂停，看完释义再接着播）
 * - 每句播完自动暂停，方便跟读；单句循环；上一句 / 重播这句 / 下一句
 *
 * 暂停、循环要卡准句尾，靠 timeupdate（一秒只来四次左右）会冲进下一句，
 * 所以播放时逐帧看一眼进度（requestAnimationFrame），只在开了逐句暂停或单句循环时才跑。
 */

import type { SubtitlesFragment } from "@/utils/subtitles/types"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { use, useCallback, useEffect, useMemo, useRef } from "react"
import { storage } from "#imports"
import {
  SUBTITLE_STUDY_AUTO_PAUSE_KEY,
  SUBTITLE_WORD_LOOKUP_EVENT,
  type SubtitleWordLookupDetail,
} from "@/utils/constants/subtitle-lookup"
import {
  cueEndingBetween,
  findCurrentCue,
  findNextCue,
  findPreviousCue,
  PAUSE_LEAD_MS,
} from "@/utils/subtitles/study"
import {
  dictationModeAtom,
  dictationStatsAtom,
  sourceTrackAtom,
  studyAutoPauseAtom,
  studyLoopCueAtom,
} from "../atoms"
import { SubtitlesUIContext } from "./subtitles-ui-context"

/** 循环的时候被拖到离这句这么远，就当用户不想循环了 */
const LOOP_ESCAPE_BEFORE_MS = 1_000
const LOOP_ESCAPE_AFTER_MS = 2_000

function useSortedCues(): SubtitlesFragment[] {
  const cues = useAtomValue(sourceTrackAtom)
  return useMemo(() => [...cues].sort((a, b) => a.start - b.start), [cues])
}

function useVideoGetter() {
  const ui = use(SubtitlesUIContext)
  return useCallback(() => ui?.getVideoElement?.() ?? null, [ui])
}

/** 在字幕容器里挂一次：读回「逐句暂停」开关，播放时负责逐句暂停和单句循环 */
export function useSubtitleStudyEngine() {
  const getVideo = useVideoGetter()
  const cues = useSortedCues()
  const [autoPause, setAutoPause] = useAtom(studyAutoPauseAtom)
  const [loopCue, setLoopCue] = useAtom(studyLoopCueAtom)
  // 听写模式必须逐句暂停（每句听完要停下来打字），但不改用户「逐句暂停」开关本身的设置
  const dictation = useAtomValue(dictationModeAtom)
  const pauseEachLine = autoPause || dictation
  const latest = useRef({ cues, pauseEachLine, loopCue })
  latest.current = { cues, pauseEachLine, loopCue }

  useEffect(() => {
    let cancelled = false
    void storage.getItem<boolean>(SUBTITLE_STUDY_AUTO_PAUSE_KEY).then((value) => {
      if (!cancelled && value) {
        setAutoPause(true)
      }
    })
    // 设置页「视频字幕 → 字幕学习模式」里也能改这个开关，改了要立刻作用到正在看的视频
    const unwatch = storage.watch<boolean>(SUBTITLE_STUDY_AUTO_PAUSE_KEY, (value) => {
      setAutoPause(value ?? false)
    })
    return () => {
      cancelled = true
      unwatch()
    }
  }, [setAutoPause])

  const active = pauseEachLine || loopCue !== null
  useEffect(() => {
    const video = getVideo()
    if (!video || !active) {
      return undefined
    }
    let previousMs = video.currentTime * 1000
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const nowMs = video.currentTime * 1000
      if (video.paused || video.seeking) {
        previousMs = nowMs
        return
      }
      const { cues: currentCues, pauseEachLine: shouldPause, loopCue: looping } = latest.current
      if (looping) {
        if (
          nowMs < looping.start - LOOP_ESCAPE_BEFORE_MS ||
          nowMs > looping.end + LOOP_ESCAPE_AFTER_MS
        ) {
          setLoopCue(null)
        } else if (nowMs >= looping.end - PAUSE_LEAD_MS) {
          video.currentTime = looping.start / 1000
          previousMs = looping.start
          return
        }
      } else if (shouldPause && cueEndingBetween(currentCues, previousMs, nowMs)) {
        video.pause()
      }
      previousMs = nowMs
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, getVideo, setLoopCue])
}

/** 学习按钮、字幕里点词要用的动作 */
export function useSubtitleStudyActions() {
  const getVideo = useVideoGetter()
  const cues = useSortedCues()
  const [autoPause, setAutoPause] = useAtom(studyAutoPauseAtom)
  const [loopCue, setLoopCue] = useAtom(studyLoopCueAtom)
  const [dictation, setDictation] = useAtom(dictationModeAtom)
  const setDictationStats = useSetAtom(dictationStatsAtom)

  const playFrom = useCallback(
    (cue: SubtitlesFragment | null) => {
      const video = getVideo()
      if (!video || !cue) {
        return
      }
      video.currentTime = cue.start / 1000
      if (video.paused) {
        void video.play().catch(() => {})
      }
    },
    [getVideo],
  )

  const nowMs = useCallback(() => (getVideo()?.currentTime ?? 0) * 1000, [getVideo])

  return {
    autoPause,
    looping: loopCue !== null,
    hasVideo: () => getVideo() !== null,
    previous: () => playFrom(findPreviousCue(cues, nowMs())),
    replay: () => playFrom(findCurrentCue(cues, nowMs())),
    next: () => playFrom(findNextCue(cues, nowMs())),
    toggleAutoPause: () => {
      const next = !autoPause
      setAutoPause(next)
      void storage.setItem(SUBTITLE_STUDY_AUTO_PAUSE_KEY, next)
    },
    dictation,
    toggleDictation: () => {
      const next = !dictation
      setDictation(next)
      // 每次开始听写都重新计数；听写和单句循环不能同时开（循环会让同一句反复播，没法作答）
      setDictationStats({ lines: 0, accuracySum: 0 })
      if (next) {
        setLoopCue(null)
      }
    },
    /** 从某句开头播放（听写里的「重听本句」「下一句」用） */
    playCue: (cue: SubtitlesFragment | null) => playFrom(cue),
    /** 视频当前停在哪一句 */
    currentCue: () => findCurrentCue(cues, nowMs()),
    nextCue: () => findNextCue(cues, nowMs()),
    toggleLoop: () => {
      if (loopCue) {
        setLoopCue(null)
        return
      }
      const cue = findCurrentCue(cues, nowMs())
      if (cue) {
        setLoopCue(cue)
        playFrom(cue)
      }
    },
    /** 点了字幕里的一个词：先暂停（看释义时视频别跑远），再请划词脚本用词典查 */
    lookupWord: (word: string, sentence: string, element: HTMLElement) => {
      getVideo()?.pause()
      const rect = element.getBoundingClientRect()
      const time = nowMs()
      const detail: SubtitleWordLookupDetail = {
        text: word,
        sentence,
        anchor: { x: rect.left, y: rect.bottom + 4 },
        // 记这句的开头而不是点的那一刻：复习时回去听，从整句开头放才听得完整
        videoTimeMs: findCurrentCue(cues, time)?.start ?? time,
      }
      window.dispatchEvent(new CustomEvent(SUBTITLE_WORD_LOOKUP_EVENT, { detail }))
    },
  }
}
