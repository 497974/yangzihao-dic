/** 一条改错：原文 → 改法 · 类型，下面是中文讲解。写作纠错和对话练习的点评共用 */

import type { WritingCorrection } from "@/utils/writing/parse"

export function CorrectionRow({ correction }: { correction: WritingCorrection }) {
  return (
    <div className="rounded-lg border p-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[15px]">
        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 line-through">
          {correction.original}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
          {correction.corrected}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {correction.type}
        </span>
      </div>
      {correction.explanation && (
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {correction.explanation}
        </div>
      )}
    </div>
  )
}
