/**
 * 阅读辅助页：读网页时顺便记单词的那几个开关。
 *
 * 这两个开关原来挤在「生词本」页的表头里——那是个表格页，开关藏在标题旁边，
 * 没人找得到。它们管的都是「网页读起来是什么样」，和生词本里存了哪些词是两回事，
 * 所以单独成页，每个开关配一句说明，说清楚它到底会把网页改成什么样。
 *
 * 两个开关都存在自己的键里（不进 Config），改完内容脚本会马上跟着变，不用刷新网页。
 */

import type { MixDensity } from "@/utils/chinese-mix/mixer"
import type { EnglishLevel, HintRange } from "@/utils/word-wise/level"
import type { ResolvedEnglishLevel } from "@/utils/word-wise/settings"
import { useEffect, useState } from "react"
import { storage } from "#imports"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { Switch } from "@/components/ui/base-ui/switch"
import { ConfigItem } from "@/entrypoints/options/components/config-item"
import { ConfigSection } from "@/entrypoints/options/components/config-section"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import {
  CHINESE_MIX_BAND_KEY,
  CHINESE_MIX_DEFAULT_DENSITY,
  CHINESE_MIX_DEFAULT_ENABLED,
  CHINESE_MIX_DENSITY_KEY,
  CHINESE_MIX_DENSITY_LABEL,
  CHINESE_MIX_ENABLED_KEY,
} from "@/utils/constants/chinese-mix"
import {
  VOCAB_HIGHLIGHT_DEFAULT_ENABLED,
  VOCAB_HIGHLIGHT_DEFAULT_SHOW_MASTERED,
  VOCAB_HIGHLIGHT_ENABLED_KEY,
  VOCAB_HIGHLIGHT_SHOW_MASTERED_KEY,
} from "@/utils/constants/vocab-highlight"
import {
  ENGLISH_LEVEL_KEY,
  PAGE_DIFFICULTY_BADGE_DEFAULT,
  PAGE_DIFFICULTY_BADGE_KEY,
  WORD_WISE_DEFAULT_ENABLED,
  WORD_WISE_ENABLED_KEY,
  WORD_WISE_RANGE_KEY,
} from "@/utils/constants/word-wise"
import { i18n } from "@/utils/i18n"
import {
  DEFAULT_HINT_RANGE,
  ENGLISH_LEVEL_OPTIONS,
  HINT_RANGE_OPTIONS,
} from "@/utils/word-wise/level"
import { readEnglishLevel } from "@/utils/word-wise/settings"
import { LEVELS } from "@/utils/wordlist/ecdict"
import { bandRange, DEFAULT_MIX_BAND, isMixBand, MIX_BAND_OPTIONS } from "@/utils/wordlist/reverse"

/** 读一个存储里的开关值；null = 还在读，避免先闪成「关」再跳成「开」 */
function useStoredValue<T>(key: `local:${string}`, fallback: T) {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let cancelled = false
    void storage.getItem<T>(key).then((stored) => {
      if (!cancelled) setValue(stored ?? fallback)
    })
    return () => {
      cancelled = true
    }
    // fallback 是常量，不进依赖：放进去会让每次渲染都重读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = (next: T) => {
    setValue(next)
    void storage.setItem(key, next)
  }
  return [value, update] as const
}

export function ReadingAssistPage() {
  const [highlightEnabled, setHighlightEnabled] = useStoredValue<boolean>(
    VOCAB_HIGHLIGHT_ENABLED_KEY,
    VOCAB_HIGHLIGHT_DEFAULT_ENABLED,
  )
  const [showMastered, setShowMastered] = useStoredValue<boolean>(
    VOCAB_HIGHLIGHT_SHOW_MASTERED_KEY,
    VOCAB_HIGHLIGHT_DEFAULT_SHOW_MASTERED,
  )
  const [hintsEnabled, setHintsEnabled] = useStoredValue<boolean>(
    WORD_WISE_ENABLED_KEY,
    WORD_WISE_DEFAULT_ENABLED,
  )
  const [hintRange, setHintRange] = useStoredValue<HintRange>(
    WORD_WISE_RANGE_KEY,
    DEFAULT_HINT_RANGE,
  )
  const [badgeEnabled, setBadgeEnabled] = useStoredValue<boolean>(
    PAGE_DIFFICULTY_BADGE_KEY,
    PAGE_DIFFICULTY_BADGE_DEFAULT,
  )
  // 我的水平：手动选的 > 词汇量测试推算 > 默认高中；来源要显示出来，免得用户不知道这个值是怎么来的
  const [englishLevel, setEnglishLevel] = useState<ResolvedEnglishLevel | null>(null)
  useEffect(() => {
    let cancelled = false
    void readEnglishLevel().then((value) => {
      if (!cancelled) setEnglishLevel(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const chooseLevel = (level: EnglishLevel) => {
    setEnglishLevel({ level, source: "manual" })
    void storage.setItem(ENGLISH_LEVEL_KEY, level)
  }

  const [mixEnabled, setMixEnabled] = useStoredValue<boolean>(
    CHINESE_MIX_ENABLED_KEY,
    CHINESE_MIX_DEFAULT_ENABLED,
  )
  const [density, setDensity] = useStoredValue<MixDensity>(
    CHINESE_MIX_DENSITY_KEY,
    CHINESE_MIX_DEFAULT_DENSITY,
  )
  const [storedBand, setMixBand] = useStoredValue<unknown>(CHINESE_MIX_BAND_KEY, DEFAULT_MIX_BAND)
  const mixBand = storedBand === null ? null : isMixBand(storedBand) ? storedBand : DEFAULT_MIX_BAND
  // 选中的难度范围实际是哪几档，跟着「我的英语水平」变：「提升（四级~六级）」
  const mixRangeLabel = (() => {
    if (!englishLevel || !mixBand) {
      return ""
    }
    const [low, high] = bandRange(englishLevel.level, mixBand)
    return low === high ? LEVELS[low - 1] : `${LEVELS[low - 1]}~${LEVELS[high - 1]}`
  })()

  return (
    <PageLayout
      title={i18n.t("options.readingAssist.title")}
      description={i18n.t("options.readingAssist.pageDescription")}
      innerClassName="flex flex-col gap-10"
    >
      {/* 水平放最上面：「按水平提示生词」和「中文网页混入英文词」共用这一个设置 */}
      <ConfigSection id="english-level" title={i18n.t("options.readingAssist.level.title")}>
        <ConfigItem
          id="english-level-select"
          title={i18n.t("options.readingAssist.level.title")}
          description={
            <>
              {i18n.t("options.readingAssist.level.description")}
              {englishLevel?.source === "vocabTest" && (
                <span className="block">{i18n.t("options.readingAssist.level.fromVocabTest")}</span>
              )}
              {englishLevel?.source === "default" && (
                <span className="block">{i18n.t("options.readingAssist.level.fromDefault")}</span>
              )}
            </>
          }
        >
          <Select
            value={englishLevel ? String(englishLevel.level) : ""}
            disabled={englishLevel === null}
            onValueChange={(value) => chooseLevel(Number(value) as EnglishLevel)}
          >
            <SelectTrigger className="w-44">
              <SelectValue render={<span />}>
                {
                  ENGLISH_LEVEL_OPTIONS.find((option) => option.value === englishLevel?.level)
                    ?.label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {ENGLISH_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ConfigItem>
      </ConfigSection>

      <ConfigSection id="vocab-highlight" title={i18n.t("options.readingAssist.highlight.title")}>
        <ConfigItem
          id="vocab-highlight-enabled"
          title={i18n.t("options.readingAssist.highlight.title")}
          description={i18n.t("options.readingAssist.highlight.description")}
        >
          <Switch
            checked={highlightEnabled ?? false}
            disabled={highlightEnabled === null}
            onCheckedChange={setHighlightEnabled}
          />
        </ConfigItem>

        <ConfigItem
          id="vocab-highlight-show-mastered"
          title={i18n.t("options.readingAssist.highlight.showMastered.title")}
          description={i18n.t("options.readingAssist.highlight.showMastered.description")}
        >
          <Switch
            checked={showMastered ?? false}
            disabled={showMastered === null || !highlightEnabled}
            onCheckedChange={setShowMastered}
          />
        </ConfigItem>

        {/* 三种颜色是什么意思，直接在设置页讲清楚，不让用户去猜 */}
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {i18n.t("options.readingAssist.highlight.legend")}
        </p>
      </ConfigSection>

      <ConfigSection id="word-wise" title={i18n.t("options.readingAssist.wordWise.title")}>
        <ConfigItem
          id="word-wise-hints"
          title={i18n.t("options.readingAssist.wordWise.hints.title")}
          description={i18n.t("options.readingAssist.wordWise.hints.description")}
        >
          <Switch
            checked={hintsEnabled ?? false}
            disabled={hintsEnabled === null}
            onCheckedChange={setHintsEnabled}
          />
        </ConfigItem>

        <ConfigItem
          id="word-wise-range"
          title={i18n.t("options.readingAssist.wordWise.range.title")}
          description={i18n.t("options.readingAssist.wordWise.range.description")}
        >
          <Select
            value={hintRange ?? DEFAULT_HINT_RANGE}
            disabled={!hintsEnabled}
            onValueChange={(value) => setHintRange(value as HintRange)}
          >
            <SelectTrigger className="w-60">
              <SelectValue render={<span />}>
                {
                  HINT_RANGE_OPTIONS.find(
                    (option) => option.value === (hintRange ?? DEFAULT_HINT_RANGE),
                  )?.label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {HINT_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ConfigItem>

        <ConfigItem
          id="word-wise-badge"
          title={i18n.t("options.readingAssist.wordWise.badge.title")}
          description={i18n.t("options.readingAssist.wordWise.badge.description")}
        >
          <Switch
            checked={badgeEnabled ?? false}
            disabled={badgeEnabled === null}
            onCheckedChange={setBadgeEnabled}
          />
        </ConfigItem>

        <p className="rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {i18n.t("options.readingAssist.wordWise.source")}
        </p>
      </ConfigSection>

      <ConfigSection id="chinese-mix" title={i18n.t("options.readingAssist.chineseMix.title")}>
        <ConfigItem
          id="chinese-mix-enabled"
          title={i18n.t("options.readingAssist.chineseMix.title")}
          description={i18n.t("options.readingAssist.chineseMix.description")}
        >
          <Switch
            checked={mixEnabled ?? false}
            disabled={mixEnabled === null}
            onCheckedChange={setMixEnabled}
          />
        </ConfigItem>

        <ConfigItem
          id="chinese-mix-band"
          title={i18n.t("options.readingAssist.chineseMix.band.title")}
          description={i18n.t("options.readingAssist.chineseMix.band.description")}
        >
          <Select
            value={mixBand ?? DEFAULT_MIX_BAND}
            disabled={!mixEnabled}
            onValueChange={setMixBand}
          >
            <SelectTrigger className="w-56">
              <SelectValue render={<span />}>
                {MIX_BAND_OPTIONS.find((option) => option.value === (mixBand ?? DEFAULT_MIX_BAND))
                  ?.label ?? ""}
                {mixRangeLabel && (
                  <span className="text-muted-foreground">（{mixRangeLabel}）</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {MIX_BAND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} · {option.description}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ConfigItem>

        <ConfigItem
          id="chinese-mix-density"
          title={i18n.t("options.readingAssist.chineseMix.density.title")}
          description={i18n.t("options.readingAssist.chineseMix.density.description")}
        >
          <Select
            value={density ?? CHINESE_MIX_DEFAULT_DENSITY}
            disabled={!mixEnabled}
            onValueChange={(value) => setDensity(value as MixDensity)}
          >
            <SelectTrigger className="w-44">
              <SelectValue render={<span />}>
                {CHINESE_MIX_DENSITY_LABEL[density ?? CHINESE_MIX_DEFAULT_DENSITY]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {(Object.keys(CHINESE_MIX_DENSITY_LABEL) as MixDensity[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {CHINESE_MIX_DENSITY_LABEL[key]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ConfigItem>

        {/* 把已知的毛病直说：用户自己撞见「大student」时会以为是 bug */}
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {i18n.t("options.readingAssist.chineseMix.limitation")}
        </p>
      </ConfigSection>
    </PageLayout>
  )
}
