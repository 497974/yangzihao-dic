import type { SubtitlesDisplayMode, SubtitlesTranslationPosition } from "@/types/config/subtitles"
import { Icon } from "@iconify/react"
import { deepmerge } from "deepmerge-ts"
import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Card } from "@/components/ui/base-ui/card"
import { Field, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/base-ui/field"
import { Label } from "@/components/ui/base-ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { SliderComfortable } from "@/components/ui/base-ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/base-ui/tooltip"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  DEFAULT_BACKGROUND_OPACITY,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_TRANSLATION_POSITION,
  FAR_APART_TRANSLATION_TOP_PERCENT,
  MAX_BACKGROUND_OPACITY,
  MAX_FAR_APART_TRANSLATION_PERCENT,
  MIN_BACKGROUND_OPACITY,
} from "@/utils/constants/subtitles"
import { i18n } from "@/utils/i18n"

export function GeneralSettings() {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )
  const { displayMode, translationPosition, container } = videoSubtitlesConfig.style
  const displayModeId = "video-subtitles-display-mode"
  const translationPositionId = "video-subtitles-translation-position"
  const [draftBackgroundOpacity, setDraftBackgroundOpacity] = useState(container.backgroundOpacity)
  const [draftFarApartPercent, setDraftFarApartPercent] = useState(
    videoSubtitlesConfig.farApartTranslationPercent,
  )

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setDraftBackgroundOpacity(container.backgroundOpacity)
  }, [container.backgroundOpacity])

  useEffect(() => {
    // 视频上拖动译文也会改这个值，设置页开着的话要跟着动
    // eslint-disable-next-line react/set-state-in-effect
    setDraftFarApartPercent(videoSubtitlesConfig.farApartTranslationPercent)
  }, [videoSubtitlesConfig.farApartTranslationPercent])

  const handleDisplayModeChange = (value: SubtitlesDisplayMode | null) => {
    if (!value) return
    void setVideoSubtitlesConfig(deepmerge(videoSubtitlesConfig, { style: { displayMode: value } }))
  }

  const handleTranslationPositionChange = (value: SubtitlesTranslationPosition | null) => {
    if (!value) return
    void setVideoSubtitlesConfig(
      deepmerge(videoSubtitlesConfig, { style: { translationPosition: value } }),
    )
  }

  const handleFarApartPercentCommit = (value: number) => {
    void setVideoSubtitlesConfig(
      deepmerge(videoSubtitlesConfig, { farApartTranslationPercent: value }),
    )
  }

  const handleContainerChange = (style: Partial<typeof container>) => {
    void setVideoSubtitlesConfig(deepmerge(videoSubtitlesConfig, { style: { container: style } }))
  }

  const resetGeneralConfig = () => {
    void setVideoSubtitlesConfig(
      deepmerge(videoSubtitlesConfig, {
        style: {
          displayMode: DEFAULT_DISPLAY_MODE,
          translationPosition: DEFAULT_TRANSLATION_POSITION,
          container: {
            backgroundOpacity: DEFAULT_BACKGROUND_OPACITY,
          },
        },
        farApartTranslationPercent: FAR_APART_TRANSLATION_TOP_PERCENT,
      }),
    )
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon icon="tabler:settings" className="size-4" />
          <Label className="text-sm font-semibold">
            {i18n.t("options.videoSubtitles.style.generalSettings")}
          </Label>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="sm" className="-mr-2" onClick={resetGeneralConfig} />
            }
          >
            <Icon icon="tabler:refresh" />
          </TooltipTrigger>
          <TooltipContent>{i18n.t("options.videoSubtitles.style.reset")}</TooltipContent>
        </Tooltip>
      </div>

      <FieldGroup>
        <Field orientation="responsive">
          <FieldLabel htmlFor={displayModeId}>
            {i18n.t("options.videoSubtitles.style.displayMode.title")}
          </FieldLabel>
          <Select value={displayMode} onValueChange={handleDisplayModeChange}>
            <SelectTrigger id={displayModeId}>
              <SelectValue>
                {i18n.t(`options.videoSubtitles.style.displayMode.${displayMode}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="bilingual">
                  {i18n.t("options.videoSubtitles.style.displayMode.bilingual")}
                </SelectItem>
                <SelectItem value="originalOnly">
                  {i18n.t("options.videoSubtitles.style.displayMode.originalOnly")}
                </SelectItem>
                <SelectItem value="translationOnly">
                  {i18n.t("options.videoSubtitles.style.displayMode.translationOnly")}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {displayMode === "bilingual" && (
          <Field orientation="responsive">
            <FieldLabel htmlFor={translationPositionId}>
              {i18n.t("options.videoSubtitles.style.translationPosition.title")}
            </FieldLabel>
            <Select value={translationPosition} onValueChange={handleTranslationPositionChange}>
              <SelectTrigger id={translationPositionId}>
                <SelectValue>
                  {i18n.t(
                    `options.videoSubtitles.style.translationPosition.${translationPosition}`,
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="above">
                    {i18n.t("options.videoSubtitles.style.translationPosition.above")}
                  </SelectItem>
                  <SelectItem value="below">
                    {i18n.t("options.videoSubtitles.style.translationPosition.below")}
                  </SelectItem>
                  <SelectItem value="farApart">
                    {i18n.t("options.videoSubtitles.style.translationPosition.farApart")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}

        {displayMode === "bilingual" && translationPosition === "farApart" && (
          <Field orientation="responsive">
            <FieldTitle>
              {i18n.t("options.videoSubtitles.style.farApartTranslationPercent")}
            </FieldTitle>
            <SliderComfortable
              variant="scrubber"
              aria-label={i18n.t("options.videoSubtitles.style.farApartTranslationPercent")}
              min={0}
              max={MAX_FAR_APART_TRANSLATION_PERCENT}
              step={1}
              value={draftFarApartPercent}
              onChange={setDraftFarApartPercent}
              onCommit={handleFarApartPercentCommit}
              formatValue={(v) => `${v}%`}
            />
          </Field>
        )}

        <Field orientation="responsive">
          <FieldTitle>{i18n.t("options.videoSubtitles.style.backgroundOpacity")}</FieldTitle>
          <SliderComfortable
            variant="scrubber"
            aria-label={i18n.t("options.videoSubtitles.style.backgroundOpacity")}
            min={MIN_BACKGROUND_OPACITY}
            max={MAX_BACKGROUND_OPACITY}
            step={5}
            value={draftBackgroundOpacity}
            onChange={setDraftBackgroundOpacity}
            onCommit={(value) => handleContainerChange({ backgroundOpacity: value })}
            formatValue={(v) => `${v}%`}
          />
        </Field>
      </FieldGroup>
    </Card>
  )
}
