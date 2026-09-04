import { Field, FieldLabel } from "@/components/ui/base-ui/field"
import { Textarea } from "@/components/ui/base-ui/textarea"

export interface PreviewTextControlsProps {
  originalText: string
  onOriginalTextChange: (text: string) => void
  translationText: string
  onTranslationTextChange: (text: string) => void
}

/**
 * 预览区一直是那句写死的"神谷先生"，样式调好了也没法拿自己实际会遇到的文本
 * （比如很长的句子、带标点的句子）去试效果。这里让原文/译文都能自己填，
 * 不填就还是原来那句默认样例——不改变旧有行为。
 */
export function PreviewTextControls({
  originalText,
  onOriginalTextChange,
  translationText,
  onTranslationTextChange,
}: PreviewTextControlsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="subtitles-preview-original">预览原文</FieldLabel>
        <Textarea
          id="subtitles-preview-original"
          value={originalText}
          onChange={(e) => onOriginalTextChange(e.target.value)}
          className="min-h-16"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="subtitles-preview-translation">预览译文</FieldLabel>
        <Textarea
          id="subtitles-preview-translation"
          value={translationText}
          onChange={(e) => onTranslationTextChange(e.target.value)}
          className="min-h-16"
        />
      </Field>
    </div>
  )
}
