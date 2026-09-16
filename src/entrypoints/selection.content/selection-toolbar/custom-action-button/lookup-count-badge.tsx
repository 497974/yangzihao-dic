import type { DictionaryLookupRecord } from "@/types/lookup-history"
import { i18n } from "@/utils/i18n"

/**
 * 词典弹窗底栏上的「第 3 次查」：查了好几次还记不住的词，提醒一下。
 * 存过的词又查了，扩展会把它提前到今天复习，也在这里说一声。
 */
export function LookupCountBadge({ record }: { record: DictionaryLookupRecord | null }) {
  if (!record || record.count < 2) {
    return null
  }
  const label = i18n.t("action.lookupCount", [String(record.count)])
  const bumped = record.reviewBumped ? i18n.t("action.lookupCountReviewBumped") : null
  return (
    <span
      className="px-1 text-xs whitespace-nowrap text-muted-foreground"
      title={bumped ?? label}
      data-slot="lookup-count"
    >
      {bumped ? `${label} · ${bumped}` : label}
    </span>
  )
}
