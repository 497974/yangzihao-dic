import type { CSSProperties } from "react"
import type { SubtitleTextStyle } from "@/types/config/subtitles"
import { useAtomValue } from "jotai"
import { use, useEffect, useMemo, useRef } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { SUBTITLE_FONT_FAMILIES } from "@/utils/constants/subtitles"
import { getLanguageDirectionAndLang } from "@/utils/content/language-direction"
import { cn } from "@/utils/styles/utils"
import { isTranslationPending } from "@/utils/subtitles/display-rules"
import { tokenizeSubtitle } from "@/utils/subtitles/study"
import { displaySubtitleAtom } from "../atoms"
import { SubtitlePendingLabel } from "./subtitle-pending-label"
import { SubtitlesUIContext } from "./subtitles-ui-context"
import { useSubtitleStudyActions } from "./use-subtitle-study"

interface SubtitleLineProps {
  content?: string
  className?: string
}

/**
 * The picked style, as custom properties rather than the properties themselves. `subtitle-lines.css`
 * turns them into real declarations; going through a variable is what lets custom CSS override a
 * colour or size without `!important`, since an inline `color` would outrank every stylesheet rule.
 */
function getTextStyleVars(textStyle: SubtitleTextStyle): CSSProperties {
  return {
    "--rf-subtitle-font-family":
      SUBTITLE_FONT_FAMILIES[textStyle.fontFamily] || SUBTITLE_FONT_FAMILIES.system,
    "--rf-subtitle-font-size": `${textStyle.fontScale / 100}em`,
    "--rf-subtitle-color": textStyle.color,
    "--rf-subtitle-font-weight": String(textStyle.fontWeight),
  } as CSSProperties
}

/**
 * 字幕原文，每个英文词都能点：点一下直接查词典（整句当语境，查的时候暂停视频）。
 * 拖着选一段照旧弹划词工具栏——刚拖选完松手也会触发一次 click，那时有选中的文字，不当成点词。
 */
function ClickableWords({ text }: { text: string }) {
  const study = useSubtitleStudyActions()
  const tokens = useMemo(() => tokenizeSubtitle(text), [text])

  return tokens.map((token, index) =>
    token.word ? (
      <span
        // oxlint-disable-next-line no-array-index-key -- 同一句里的词顺序固定，下标就是它的身份
        key={index}
        className="subtitles-word"
        title="点一下查词典"
        // 字幕挂在播放器里面：点击、双击冒上去会被播放器当成「暂停/播放」「全屏」
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (window.getSelection()?.toString().trim()) {
            return
          }
          study.lookupWord(token.text, text, event.currentTarget)
        }}
      >
        {token.text}
      </span>
    ) : (
      token.text
    ),
  )
}

export function MainSubtitle({ content, className }: SubtitleLineProps) {
  const subtitle = useAtomValue(displaySubtitleAtom)
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  const ui = use(SubtitlesUIContext)
  const text = content ?? subtitle?.text ?? ""
  // 设置里的样式预览传的是固定文字、不在播放器里，不用点词
  const clickable = content === undefined && !!ui

  return (
    <div
      className={cn("subtitles-main text-xl leading-tight", className)}
      style={getTextStyleVars(style.main)}
    >
      {clickable ? <ClickableWords text={text} /> : text}
    </div>
  )
}

export function TranslationSubtitle({ content, className }: SubtitleLineProps) {
  const subtitle = useAtomValue(displaySubtitleAtom)
  const { style } = useAtomValue(configFieldsAtomMap.videoSubtitles)
  const language = useAtomValue(configFieldsAtomMap.language)
  const pending = content === undefined && isTranslationPending(subtitle)
  const text = content ?? subtitle?.translation ?? ""
  const { dir, lang } = getLanguageDirectionAndLang(language.targetCode)
  const textStyleVars = getTextStyleVars(style.translation)
  const lastFrameRef = useRef<{ start?: number; pending: boolean }>({
    start: undefined,
    pending: false,
  })
  const justResolved =
    !pending &&
    !!text &&
    lastFrameRef.current.pending &&
    lastFrameRef.current.start === subtitle?.start

  useEffect(() => {
    lastFrameRef.current = { start: subtitle?.start, pending }
  })

  if (pending) {
    return (
      <div
        className={cn(
          "subtitles-translation flex min-h-[1.25em] items-center justify-center leading-tight",
          className,
        )}
        // The pending label deliberately does not take the picked weight: it is a placeholder, not
        // the translation, and inherits whatever the box uses.
        style={{ ...textStyleVars, "--rf-subtitle-font-weight": undefined } as CSSProperties}
        dir={dir}
        lang={lang}
        data-pending="true"
        aria-busy="true"
      >
        <SubtitlePendingLabel key={subtitle?.start} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "subtitles-translation text-xl leading-tight",
        justResolved && "animate-subtitle-fade-in",
        className,
      )}
      style={textStyleVars}
      dir={dir}
      lang={lang}
    >
      {text}
    </div>
  )
}
