/**
 * 闪卡复习页
 *
 * 上游把复习放在网页端，本项目改为完全在扩展内完成 —— 不用开网页、不用登录。
 * 调度由本地 FSRS 计算（见 utils/local-notebase/srs-scheduler.ts）。
 *
 * 拼写测验的设计取舍（参考百词斩等 App 被验证有效的机制，但按听力优先重构）：
 *   - 不显示英文例句，改为朗读：显示英文等于把字母数和上下文全暴露了。
 *   - 不显示音标：音标和原词长得太像（/ˈpiːs.waɪz/ 基本就是 piecewise 的音译），
 *     等于直接给答案。答错之后才显示音标，这时它变成有用的纠音信息。
 *   - 只保留不泄题的线索：词性、中文释义、中文句意、难度。
 * 有意跳过的：图片联想（需图库或按词生图，要联网且成本高）；社交排行榜（需服务器）。
 */

import { useAtomValue } from "jotai"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconLoader2, IconPlayerStopFilled, IconVolume } from "@tabler/icons-react"
import { Button } from "@/components/ui/base-ui/button"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { ANALYTICS_SURFACE } from "@/types/analytics"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { detectLanguage } from "@/utils/content/language"
import { orpcClient } from "@/utils/orpc/client"

type Rating = "again" | "hard" | "good" | "easy"

/** 慢速朗读用的语速（rate 取值范围 -100 ~ 100） */
const SLOW_RATE = -45

interface ReviewCard {
  id: string
  notebaseRowId: string
  front: string
  back: string
  state: string
  dueAt: string | Date
  reps: number
  lapses: number
}

/** 默认卡片模板生成的列名，用于结构化取字段 */
const FIELD = {
  phonetic: "音标",
  partOfSpeech: "词性",
  definition: "释义",
  sentence: "句子",
  sentenceTranslation: "句子翻译",
  difficulty: "难度",
} as const

const RATING_META: { key: Rating, label: string, hint: string, cls: string, keyCap: string }[] = [
  { key: "again", label: "忘了", hint: "重新学", cls: "bg-red-500/90 hover:bg-red-500 text-white", keyCap: "1" },
  { key: "hard", label: "有点难", hint: "缩短间隔", cls: "bg-amber-500/90 hover:bg-amber-500 text-white", keyCap: "2" },
  { key: "good", label: "记得", hint: "正常间隔", cls: "bg-emerald-600/90 hover:bg-emerald-600 text-white", keyCap: "3" },
  { key: "easy", label: "太简单", hint: "拉长间隔", cls: "bg-sky-600/90 hover:bg-sky-600 text-white", keyCap: "4" },
]

function isDue(c: ReviewCard) {
  if (c.state === "new") return true
  return new Date(c.dueAt).getTime() <= Date.now()
}

/** 复习过至少一次的卡片才考拼写——第一次见到这个词，直接考拼写没有意义。 */
function isSpellingEligible(c: ReviewCard) {
  return c.state !== "new" && c.reps > 0
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

export function ReviewPage() {
  const qc = useQueryClient()
  const ttsConfig = useAtomValue(configFieldsAtomMap.tts)
  const language = useAtomValue(configFieldsAtomMap.language)
  const { play, stop, isFetching, isPlaying } = useTextToSpeech(ANALYTICS_SURFACE.FLASHCARD_REVIEW)

  const [revealed, setRevealed] = useState(false)
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(0)
  const [slow, setSlow] = useState(false)
  const shownAtRef = useRef<number>(Date.now())

  const [typedAnswer, setTypedAnswer] = useState("")
  const [checked, setChecked] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoPlayedRef = useRef<string | null>(null)

  const { data: notebases } = useQuery({
    queryKey: ["local-notebases"],
    queryFn: () => orpcClient.notebase.list({}),
  })
  const notebaseId = notebases?.[0]?.id

  const { data: cards, isPending } = useQuery({
    queryKey: ["review-cards", notebaseId],
    queryFn: () => orpcClient.card.list({ notebaseId: notebaseId! }),
    enabled: !!notebaseId,
  })

  // 卡片接口只返回渲染好的一整块文本，拆不出单个字段。
  // 这里直接读生词本原始数据，按列名取值——上游契约的返回格式锁死了，
  // 往里加字段会被 schema 过滤掉，绕过去反而更简单。
  const { data: notebase } = useQuery({
    queryKey: ["local-notebase-detail", notebaseId],
    queryFn: () => orpcClient.notebase.get({ id: notebaseId! }),
    enabled: !!notebaseId,
  })

  const fieldsByRowId = useMemo(() => {
    const map = new Map<string, Record<string, string>>()
    if (!notebase) return map
    const nameById = new Map(notebase.notebaseColumns.map((c) => [c.id, c.name]))
    for (const row of notebase.notebaseRows) {
      const fields: Record<string, string> = {}
      for (const [colId, value] of Object.entries(row.cells ?? {})) {
        const name = nameById.get(colId)
        if (name && value != null) fields[name] = String(value)
      }
      map.set(row.id, fields)
    }
    return map
  }, [notebase])

  const queue = useMemo(() => (cards ?? []).filter(isDue) as ReviewCard[], [cards])
  const current = queue[idx]
  const spellingMode = current ? isSpellingEligible(current) : false
  const fields = current ? fieldsByRowId.get(current.notebaseRowId) : undefined
  const sentence = fields?.[FIELD.sentence]?.trim() || ""

  // 锁定音色，不让 TTS 自己按文本猜语言。
  // hook 内部是 detectLanguage(text, { minLength: 0, enableLLM }) 决定音色的：
  // 单个单词太短，检测极不可靠（comedian 可能被判成荷兰语/印尼语，于是用外语
  // 音色念英文，听着就"不标准"）；开了 LLM 检测时同一个词两次结果还可能不同，
  // 于是"第一次和第二次发音不一样"。这里改为：优先用配置里的学习语言，
  // 「自动」时退而用整句（长文本，检测可靠）来判定，并对整句和单词复用同一个音色。
  const [voice, setVoice] = useState<string | undefined>()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let lang = language.sourceCode !== "auto" ? language.sourceCode : null
      if (!lang && sentence) {
        // 拿整句去检测，而不是单词；关掉 LLM 保证同一文本每次结果一致
        lang = await detectLanguage(sentence, { minLength: 0, enableLLM: false })
      }
      if (cancelled) return
      setVoice(
        (lang && ttsConfig.languageVoices[lang]) || ttsConfig.defaultVoice || undefined,
      )
    })()
    return () => { cancelled = true }
  }, [language.sourceCode, sentence, ttsConfig])

  const speak = useCallback(
    (text: string) => {
      if (!text) return Promise.resolve()
      return play(
        text,
        slow ? { ...ttsConfig, rate: SLOW_RATE } : ttsConfig,
        voice ? { forcedVoice: voice } : undefined,
      )
    },
    [play, slow, ttsConfig, voice],
  )

  useEffect(() => {
    shownAtRef.current = Date.now()
    setTypedAnswer("")
    setChecked(false)
    setIsCorrect(false)
    setRevealed(false)
    if (spellingMode) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换卡时重置
  }, [current?.id])

  // 进入拼写题自动播放：先整句，再报出要拼的词。
  // 用 ref 记住播过哪张卡，避免 React 重渲染时重复播放。
  useEffect(() => {
    if (!current || !spellingMode) return
    // 生词本是异步加载的。数据没到之前 sentence 还是空字符串，此时若先把这张卡
    // 标记为"已播过"，整句就永远补不上了（依赖变化后会被下面的 ref 判断拦掉），
    // 结果只念了 "Spell the word: xxx"。所以必须等数据到齐再开播。
    if (!notebase) return
    if (autoPlayedRef.current === current.id) return
    autoPlayedRef.current = current.id

    let cancelled = false
    void (async () => {
      try {
        if (sentence) await speak(sentence)
        if (cancelled) return
        await speak(`Spell the word: ${current.front}`)
      } catch {
        // 朗读失败不该打断答题（断网、服务不可用等），静默跳过
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换卡时自动播放一次
  }, [current?.id, spellingMode, sentence, notebase])

  // 离开页面时停掉还在播的音频。
  // stop 没有被 useCallback 包住，每次渲染都是新引用；直接写进依赖会导致
  // cleanup 在每次重渲染时触发，音频刚播就被掐断。用 ref 存最新引用，
  // 让这个 effect 只在卸载时跑一次。
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => () => stopRef.current(), [])

  const { mutate: submit, isPending: isSubmitting } = useMutation({
    mutationFn: async (rating: Rating) => {
      if (!current) return
      await orpcClient.srs.review({
        cardId: current.id,
        rating,
        durationMs: Math.min(Date.now() - shownAtRef.current, 180_000),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    },
    onSuccess: () => {
      stop()
      setDone((n) => n + 1)
      setIdx((i) => i + 1)
    },
  })

  const finished = !isPending && queue.length > 0 && idx >= queue.length

  const handleRate = useCallback((r: Rating) => {
    if (!revealed || isSubmitting) return
    submit(r)
  }, [revealed, isSubmitting, submit])

  const checkSpelling = useCallback(() => {
    if (!current || checked) return
    const correct = normalize(typedAnswer) === normalize(current.front)
    setIsCorrect(correct)
    setChecked(true)
    setRevealed(true)
    if (!correct) void speak(current.front)
  }, [current, checked, typedAnswer, speak])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === inputRef.current
      if (e.code === "Space" && !typing) {
        e.preventDefault()
        if (!spellingMode && !revealed) setRevealed(true)
        return
      }
      if (typing) return
      const m = RATING_META.find((x) => x.keyCap === e.key)
      if (m) { e.preventDefault(); handleRate(m.key) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [revealed, spellingMode, handleRate])

  const restart = () => {
    setIdx(0); setDone(0); setRevealed(false)
    autoPlayedRef.current = null
    void qc.invalidateQueries({ queryKey: ["review-cards"] })
  }

  const audioBusy = isFetching || isPlaying

  return (
    <PageLayout title="闪卡复习" description="按记忆规律安排复习，快忘的词优先出现">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {isPending && <div className="py-16 text-center text-muted-foreground">加载中…</div>}

        {!isPending && queue.length === 0 && <EmptyState onRefresh={restart} />}

        {!isPending && finished && (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <div className="text-4xl">🎉</div>
            <div className="mt-3 text-lg font-medium">今天的复习完成了</div>
            <div className="mt-1 text-sm text-muted-foreground">本轮复习 {done} 张卡片</div>
            <Button variant="outline" size="sm" className="mt-5" onClick={restart}>再看一轮</Button>
          </div>
        )}

        {!isPending && current && !finished && (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>剩余 {queue.length - idx} 张</span>
              <span>已完成 {done} 张</span>
            </div>

            <div className="h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(idx / Math.max(queue.length, 1)) * 100}%` }}
              />
            </div>

            {spellingMode
              ? (
                  <div className="flex min-h-72 flex-col justify-center gap-5 rounded-xl border bg-card p-8">
                    <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">拼写测验</span>
                      <span>听发音，打出这个词</span>
                    </div>

                    {/* 语音条：整句 / 单词 / 慢速 */}
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {sentence && (
                        <AudioChip
                          label="听整句"
                          busy={audioBusy}
                          onClick={() => void speak(sentence)}
                        />
                      )}
                      <AudioChip
                        label="听单词"
                        busy={audioBusy}
                        onClick={() => void speak(current.front)}
                      />
                      <button
                        type="button"
                        onClick={() => setSlow((s) => !s)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          slow ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        🐢 慢速{slow ? "开" : "关"}
                      </button>
                    </div>

                    {/* 答题阶段是纯听力：上下文靠听英文原句获得，不给任何中文。
                        中文释义 = 直接给答案；中文句意 = 变相给答案；
                        音标 = 原词音译；英文原句 = 暴露字母数。全部留到答完再显示。
                        只保留词性——它是语法线索，不泄露词义。*/}
                    {fields?.[FIELD.partOfSpeech] && (
                      <div className="text-center text-sm italic text-muted-foreground">
                        {fields[FIELD.partOfSpeech]}
                      </div>
                    )}

                    {!checked
                      ? (
                          <div className="flex justify-center gap-2">
                            <input
                              ref={inputRef}
                              value={typedAnswer}
                              onChange={(e) => setTypedAnswer(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") checkSpelling() }}
                              placeholder="输入你听到的单词…"
                              autoComplete="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              className="w-64 rounded-lg border bg-background px-4 py-2.5
                                         text-center text-lg outline-none focus:ring-2 focus:ring-primary"
                            />
                            <Button onClick={checkSpelling} disabled={!typedAnswer.trim()}>提交</Button>
                          </div>
                        )
                      : (
                          <div className="flex flex-col items-center gap-3 border-t pt-5">
                            <div
                              className={`rounded-lg px-4 py-2 text-lg font-semibold ${
                                isCorrect ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                              }`}
                            >
                              {isCorrect ? "✓ 拼对了" : "✗ 拼错了"}
                            </div>

                            <div className="text-2xl font-semibold">{current.front}</div>

                            {/* 答完才显示音标——此时它是纠音信息，不再是提示 */}
                            {fields?.[FIELD.phonetic] && (
                              <div className="text-sm text-muted-foreground">{fields[FIELD.phonetic]}</div>
                            )}

                            {/* 释义答题时藏着（等于直接给答案），答完必须显示，
                                否则整道题做完还是不知道这词什么意思 */}
                            {fields?.[FIELD.definition] && (
                              <div className="max-w-lg text-center text-[15px]">
                                {fields[FIELD.definition]}
                              </div>
                            )}

                            {fields?.[FIELD.difficulty] && (
                              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {fields[FIELD.difficulty]}
                              </span>
                            )}

                            {!isCorrect && (
                              <div className="text-sm text-muted-foreground">
                                你输入的是「{typedAnswer}」
                              </div>
                            )}

                            {/* 英文原句 + 中文句意都留到这里：答题时靠听，
                                答完给出文本对照，才能确认自己是真听懂了还是蒙对了 */}
                            {sentence && (
                              <div className="mt-1 max-w-lg text-center text-[15px] leading-relaxed">
                                {sentence}
                              </div>
                            )}

                            {fields?.[FIELD.sentenceTranslation] && (
                              <div className="max-w-lg text-center text-sm text-muted-foreground">
                                {fields[FIELD.sentenceTranslation]}
                              </div>
                            )}

                            <div className="flex gap-2">
                              <AudioChip label="再听单词" busy={audioBusy} onClick={() => void speak(current.front)} />
                              {sentence && (
                                <AudioChip label="再听整句" busy={audioBusy} onClick={() => void speak(sentence)} />
                              )}
                            </div>
                          </div>
                        )}
                  </div>
                )
              : (
                  <div
                    className="flex min-h-64 cursor-pointer flex-col items-center justify-center gap-5
                               rounded-xl border bg-card p-8 text-center"
                    onClick={() => !revealed && setRevealed(true)}
                  >
                    <div className="flex items-center gap-2 text-3xl font-semibold">
                      <span>{current.front}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void speak(current.front) }}
                        aria-label="朗读发音"
                        className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        {audioBusy
                          ? <IconLoader2 className="size-5 animate-spin" />
                          : <IconVolume className="size-5" />}
                      </button>
                    </div>

                    {revealed
                      ? (
                          <div className="w-full whitespace-pre-line border-t pt-5 text-left text-[15px] leading-relaxed">
                            {current.back}
                          </div>
                        )
                      : (
                          <div className="text-sm text-muted-foreground">
                            点击卡片或按 <kbd className="rounded border px-1.5 py-0.5 text-xs">空格</kbd> 显示答案
                          </div>
                        )}
                  </div>
                )}

            {revealed && (
              <div className="grid grid-cols-4 gap-2">
                {RATING_META.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleRate(m.key)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-3
                                text-sm font-medium transition disabled:opacity-50 ${m.cls}`}
                  >
                    <span>{m.label}</span>
                    <span className="text-[11px] opacity-80">{m.hint}</span>
                    <span className="mt-0.5 rounded bg-black/20 px-1.5 text-[10px]">{m.keyCap}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="text-center text-xs text-muted-foreground">
              复习 {current.reps} 次 · 忘记 {current.lapses} 次
            </div>
          </>
        )}
      </div>
    </PageLayout>
  )
}

function AudioChip({
  label, busy, onClick,
}: { label: string, busy: boolean, onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm
                 transition hover:bg-muted disabled:opacity-50"
    >
      {busy
        ? <IconPlayerStopFilled className="size-4 text-primary" />
        : <IconVolume className="size-4" />}
      {label}
    </button>
  )
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="rounded-xl border border-dashed py-16 text-center">
      <div className="text-4xl">📚</div>
      <div className="mt-3 text-lg font-medium">暂时没有要复习的卡片</div>
      <div className="mt-1 text-sm text-muted-foreground">
        划词保存生词后会自动生成卡片；已复习的卡片会按记忆规律在之后的日子里再次出现
      </div>
      <Button variant="outline" size="sm" className="mt-5" onClick={onRefresh}>刷新</Button>
    </div>
  )
}
