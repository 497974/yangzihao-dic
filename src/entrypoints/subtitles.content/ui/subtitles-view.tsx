import { useAtomValue } from "jotai"
import { Activity } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { SUBTITLES_BOX_CLASS, SUBTITLES_VIEW_CLASS } from "@/utils/constants/subtitles"
import { cn } from "@/utils/styles/utils"
import { dictationModeAtom, displaySubtitleAtom } from "../atoms"
import { DictationPanel } from "./subtitle-dictation"
import { MainSubtitle, TranslationSubtitle } from "./subtitle-lines"
import { SubtitleToolbar } from "./subtitle-toolbar"
import { useFarApartDrag } from "./use-far-apart-drag"
import { useVerticalDrag } from "./use-vertical-drag"

interface SubtitlesViewProps {
  showContent: boolean
}

/** 这一帧该显示哪几行——三种展示模式与"译文和原文重复"的去重都收在这里 */
function useVisibleLines() {
  const subtitle = useAtomValue(displaySubtitleAtom)
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  const { displayMode } = style

  const isDuplicateTranslation = !!subtitle?.translation && subtitle.translation === subtitle.text
  return {
    showMain: displayMode !== "translationOnly",
    // Bilingual: keep translation row for pending indicator when original is shown without translation.
    showTranslation:
      displayMode !== "originalOnly" && !(displayMode === "bilingual" && isDuplicateTranslation),
  }
}

function useContainerStyle() {
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  return {
    backgroundColor: `rgba(0, 0, 0, ${style.container.backgroundOpacity / 100})`,
  }
}

function SubtitlesContent() {
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  const { translationPosition } = style
  const { showMain, showTranslation } = useVisibleLines()
  const containerStyle = useContainerStyle()

  const farApart = translationPosition === "farApart"
  const translationAbove = translationPosition === "above"
  const dictation = useAtomValue(dictationModeAtom)

  return (
    <div
      className={`${SUBTITLES_VIEW_CLASS} pointer-events-none flex w-full flex-col items-center justify-end pb-3`}
    >
      <div
        className={`${SUBTITLES_BOX_CLASS} pointer-events-auto mx-auto flex w-fit max-w-[90%] cursor-text flex-col gap-2 rounded px-2 py-1.5 text-center text-white select-text`}
        style={containerStyle}
      >
        {/* 听写时原文和译文都换成听写面板：看得到字幕就不是听写了 */}
        {dictation && <DictationPanel />}

        <Activity mode={showMain && !dictation ? "visible" : "hidden"}>
          <MainSubtitle className={translationAbove ? "order-2" : "order-1"} />
        </Activity>

        {/* 拉开距离时译文不在这个框里，它由 FarApartTranslation 渲染到画面顶端 */}
        <Activity mode={showTranslation && !farApart && !dictation ? "visible" : "hidden"}>
          <TranslationSubtitle className={translationAbove ? "order-1" : "order-2"} />
        </Activity>
      </div>
    </div>
  )
}

/**
 * 「拉开距离」模式下贴在画面顶端的译文。
 *
 * 单独定位、不跟着下面那个可拖拽的框走——整个卖点就是两行离得足够远，
 * 让人没法一眼把中英文一起扫进去。
 */
function FarApartTranslation() {
  const { showTranslation } = useVisibleLines()
  const containerStyle = useContainerStyle()
  const { refs, topPercent, isDragging } = useFarApartDrag()

  return (
    <div
      ref={refs.container}
      className={cn(
        "group pointer-events-none absolute right-0 left-0 flex flex-col items-center",
        !isDragging && "transition-[top] duration-200",
      )}
      style={{ top: `${topPercent}%` }}
    >
      <Activity mode={showTranslation ? "visible" : "hidden"}>
        <SubtitleToolbar handleRef={refs.handle} target="translation" />

        <div
          className={`${SUBTITLES_BOX_CLASS} pointer-events-auto mx-auto w-fit max-w-[90%] cursor-text rounded px-2 py-1.5 text-center text-white select-text`}
          style={containerStyle}
        >
          <TranslationSubtitle />
        </div>
      </Activity>
    </div>
  )
}

export function SubtitlesView({ showContent }: SubtitlesViewProps) {
  const { refs, windowStyle, positionStyle, isDragging } = useVerticalDrag()
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  const farApart = style.translationPosition === "farApart"
  const dictation = useAtomValue(dictationModeAtom)

  return (
    <div
      ref={refs.window}
      style={{
        width: windowStyle.width,
        height: windowStyle.height,
        fontSize: windowStyle.fontSize,
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        ref={refs.container}
        className={cn(
          "group absolute right-0 left-0 flex w-full flex-col items-center",
          !isDragging && "transition-[top,bottom] duration-200",
          !showContent && "invisible",
        )}
        style={positionStyle}
      >
        {/* 拉开距离模式下，这个框里只剩原文，字号就只调原文；
            其余模式下两行都在这个框里，一起调才符合直觉 */}
        <SubtitleToolbar handleRef={refs.handle} target={farApart ? "main" : "both"} study />

        <Activity mode={showContent ? "visible" : "hidden"}>
          <SubtitlesContent />
        </Activity>
      </div>

      {/* 挂在覆盖整个画面的这一层里，top% 才是相对画面高度；
          主字幕那层是可拖拽的，位置会变，不能挂在它下面 */}
      {farApart && showContent && !dictation && <FarApartTranslation />}
    </div>
  )
}
