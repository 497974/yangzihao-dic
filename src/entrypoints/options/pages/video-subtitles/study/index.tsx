/**
 * 字幕学习模式的设置（功能路线图阶段四第 1 条）。
 *
 * 这些开关本来只在视频画面里那排悬浮按钮上——不看视频的时候根本不知道有这功能。
 * 这里把它写明白：说清楚有哪几个按钮、点字幕里的词会发生什么，
 * 并且把「逐句暂停」这个会一直生效的开关放出来（和播放器里那个是同一个设置）。
 */

import { useEffect, useState } from "react"
import { storage } from "#imports"
import { Switch } from "@/components/ui/base-ui/switch"
import { ConfigItem } from "@/entrypoints/options/components/config-item"
import { ConfigSection } from "@/entrypoints/options/components/config-section"
import { SUBTITLE_STUDY_AUTO_PAUSE_KEY } from "@/utils/constants/subtitle-lookup"
import { i18n } from "@/utils/i18n"

export function StudySection() {
  const [autoPause, setAutoPause] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void storage.getItem<boolean>(SUBTITLE_STUDY_AUTO_PAUSE_KEY).then((value) => {
      if (!cancelled) setAutoPause(value ?? false)
    })
    // 在视频里那排按钮上改了，这边也要跟着变（同一个设置的两个入口）
    const unwatch = storage.watch<boolean>(SUBTITLE_STUDY_AUTO_PAUSE_KEY, (value) => {
      setAutoPause(value ?? false)
    })
    return () => {
      cancelled = true
      unwatch()
    }
  }, [])

  return (
    <ConfigSection id="subtitles-study" title={i18n.t("options.videoSubtitles.study.title")}>
      <ConfigItem
        id="subtitles-study-auto-pause"
        title={i18n.t("options.videoSubtitles.study.autoPause.title")}
        description={i18n.t("options.videoSubtitles.study.autoPause.description")}
      >
        <Switch
          checked={autoPause ?? false}
          disabled={autoPause === null}
          onCheckedChange={(checked) => {
            setAutoPause(checked)
            void storage.setItem(SUBTITLE_STUDY_AUTO_PAUSE_KEY, checked)
          }}
        />
      </ConfigItem>

      <p className="rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
        {i18n.t("options.videoSubtitles.study.description")}
      </p>
    </ConfigSection>
  )
}
