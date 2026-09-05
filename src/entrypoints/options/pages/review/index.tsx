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

import {
  IconLoader2,
  IconPencilQuestion,
  IconPlayerStopFilled,
  IconVolume,
} from "@tabler/icons-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { FreeProductBadge } from "@/components/free-product-badge"
import { Button } from "@/components/ui/base-ui/button"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { ANALYTICS_SURFACE } from "@/types/analytics"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { detectLanguage } from "@/utils/content/language"
import { cellToText } from "@/utils/notebase/cell-text"
import { orpcClient } from "@/utils/orpc/client"
import { ClozeCard } from "./cloze-card"

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
  mnemonic: "助记",
} as const

const RATING_META: { key: Rating; label: string; hint: string; cls: string; keyCap: string }[] = [
  {
    key: "again",
    label: "忘了",
    hint: "重新学",
    cls: "bg-red-500/90 hover:bg-red-500 text-white",
    keyCap: "1",
  },
  {
    key: "hard",
    label: "有点难",
    hint: "缩短间隔",
    cls: "bg-amber-500/90 hover:bg-amber-500 text-white",
    keyCap: "2",
  },
  {
    key: "good",
    label: "记得",
    hint: "正常间隔",
    cls: "bg-emerald-600/90 hover:bg-emerald-600 text-white",
    keyCap: "3",
  },
  {
    key: "easy",
    label: "太简单",
    hint: "拉长间隔",
    cls: "bg-sky-600/90 hover:bg-sky-600 text-white",
    keyCap: "4",
  },
]

function isDue(c: ReviewCard) {
  if (c.state === "new") return true
  return new Date(c.dueAt).getTime() <= Date.now()
}

/**
 * 题型：
 *   recognition —— 首次见到这个词，直接翻卡认识一下，考拼写没有意义
 *   listening   —— 只给英文语音，不给任何中文（音 → 形 + 听力理解）
 *   translation —— 只给中文，不给任何语音（义 → 形 + 表达能力）
 *
 * 两种测试互为镜像：任一种的应试策略在另一种上都会露馅。
 * 按「这张卡自己复习过几次」轮换，而不是全局随机——随机不保证覆盖，
 * 某个词可能连续多次都抽到听力，就永远验证不了你到底懂不懂它的意思。
 */
/**
 *   recognition —— 首次见到这个词，直接翻卡认识一下
 *   listening   —— 只给英文语音（音 → 形）
 *   translation —— 只给中文释义（义 → 形）
 *   cloze       —— 给例句的中文和留了骨架的句子，把缺的实词补上（词 → 用法）
 *
 * cloze 考的是"这个位置该填哪个词"，是词汇题，所以放在闪卡这边；
 * 造句练习那个页面是整句全挖、零骨架，考的是从零表达，两者刻意分开。
 */
/**
 * 焦点是不是落在"正在打字"的地方。
 *
 * 全局快捷键必须先问这一句：复习页同时存在拼写输入框和语境填空的一排输入框，
 * 只比对某一个 ref 会漏掉其余的，结果就是在填空里打字被当成快捷键吞掉。
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  // 只读/禁用的框打不进字，不该算在"正在输入"里。这一条很关键：
  // 语境填空揭晓后每个空都变成 readOnly，而 readOnly 的输入框在真实浏览器里
  // **仍然保留焦点**（不像 disabled）。不排除的话，答案刚露脸、评分按钮刚出来，
  // 1/2/3/4 却被当成"正在打字"吞掉，键盘评分整个失效。
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled
  }
  return el.tagName === "SELECT"
}

/**
 * 空格能不能直接揭晓答案。
 *
 * 只有正反面题型可以——它就是"想一下，然后翻面"。其余题型都得先真正作答：
 * 听写/中译英要提交拼写，语境填空要提交或点显示答案。
 *
 * 这条边界很要紧：评分按钮是跟着"已揭晓"出现的，一旦让空格在填空题里也能
 * 置位，答案没露脸评分按钮就冒出来了，等于可以盲按 1/2/3/4 打分并跳下一题，
 * 复习记录就成了假的。
 */
export function canSpaceReveal(quizMode: QuizMode): boolean {
  return quizMode === "recognition"
}

type QuizMode = "recognition" | "listening" | "translation" | "cloze"
type ModePreference = "auto" | "listening" | "translation" | "cloze"

function resolveQuizMode(c: ReviewCard, pref: ModePreference, hasSentence: boolean): QuizMode {
  if (c.state === "new" || c.reps === 0) return "recognition"
  if (pref !== "auto") {
    // 没有例句就出不了填空题，退回中译英，不然会卡在空白卡片上
    return pref === "cloze" && !hasSentence ? "translation" : pref
  }
  // 三种题型轮着来，保证同一个词被从不同方向考到
  const rotation: QuizMode[] = hasSentence
    ? ["listening", "translation", "cloze"]
    : ["listening", "translation"]
  return rotation[(c.reps - 1) % rotation.length]!
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

export function ReviewPage() {
  const qc = useQueryClient()
  const ttsConfig = useAtomValue(configFieldsAtomMap.tts)
  const language = useAtomValue(configFieldsAtomMap.language)
  const { play, prefetch, stop, isFetching, isPlaying } = useTextToSpeech(
    ANALYTICS_SURFACE.FLASHCARD_REVIEW,
  )

  const [revealed, setRevealed] = useState(false)
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(0)
  const [slow, setSlow] = useState(false)
  // 默认自动轮换。留手动覆盖是为了专项训练，但不设成默认——
  // 让人自己选的话，通常会一直选简单的那种，反而失去互相印证的作用。
  const [modePref, setModePref] = useState<ModePreference>("auto")
  const shownAtRef = useRef<number>(Date.now())

  const [typedAnswer, setTypedAnswer] = useState("")
  const [checked, setChecked] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoPlayedRef = useRef<string | null>(null)
  const ratingsRef = useRef<HTMLDivElement>(null)

  const { data: notebases, isPending: notebasesPending } = useQuery({
    queryKey: ["local-notebases"],
    queryFn: () => orpcClient.notebase.list({}),
  })
  const notebaseId = notebases?.[0]?.id

  const { data: cards, isPending: cardsPending } = useQuery({
    queryKey: ["review-cards", notebaseId],
    queryFn: () => orpcClient.card.list({ notebaseId: notebaseId! }),
    enabled: !!notebaseId,
  })

  /**
   * react-query v5 里 `enabled: false` 的查询 isPending 恒为 true。新装机的用户
   * 还没有笔记库，卡片查询被禁用 —— 直接用 isPending 当加载态，页面会永远卡在
   * "加载中…"，连"还没有卡片，去划词吧"这个引导都看不到。没有笔记库时不算加载中，
   * 让它落到空状态分支。
   */
  const isPending = notebasesPending || (!!notebaseId && cardsPending)

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
        if (name) fields[name] = cellToText(value)
      }
      map.set(row.id, fields)
    }
    return map
  }, [notebase])

  const queue = useMemo(() => (cards ?? []).filter(isDue) as ReviewCard[], [cards])
  const current = queue[idx]
  // 例句要先取出来：题型轮换要知道这张卡有没有例句——没有例句就出不了填空题
  const fields = current ? fieldsByRowId.get(current.notebaseRowId) : undefined
  const sentence = fields?.[FIELD.sentence]?.trim() || ""
  const sentenceTranslation = fields?.[FIELD.sentenceTranslation]?.trim() || ""
  const canCloze = !!sentence && !!sentenceTranslation
  const quizMode = current ? resolveQuizMode(current, modePref, canCloze) : "recognition"
  const spellingMode = quizMode === "listening" || quizMode === "translation"

  // 下一张卡——换题前趁用户还在答当前这题，先把它的语音悄悄合成好（见下面
  // 的预取 effect）。只在切到 idx+1 时才用得上，提前算好放这里方便复用。
  const nextCard = queue[idx + 1]
  const nextFields = nextCard ? fieldsByRowId.get(nextCard.notebaseRowId) : undefined
  const nextSentence = nextFields?.[FIELD.sentence]?.trim() || ""
  const nextQuizMode = nextCard
    ? resolveQuizMode(
        nextCard,
        modePref,
        !!nextSentence && !!nextFields?.[FIELD.sentenceTranslation]?.trim(),
      )
    : undefined

  // 锁定音色，不让 TTS 自己按文本猜语言。
  // hook 内部是 detectLanguage(text, { minLength: 0, enableLLM }) 决定音色的：
  // 单个单词太短，检测极不可靠（comedian 可能被判成荷兰语/印尼语，于是用外语
  // 音色念英文，听着就"不标准"）；开了 LLM 检测时同一个词两次结果还可能不同，
  // 于是"第一次和第二次发音不一样"。这里改为：优先用配置里的学习语言，
  // 「自动」时退而用整句（长文本，检测可靠）来判定，并对整句和单词复用同一个音色。
  // 抽成函数是因为下面预取下一张卡的语音时要用同一套逻辑算它的音色。
  const resolveVoiceForSentence = useCallback(
    async (sentenceText: string) => {
      let lang = language.sourceCode !== "auto" ? language.sourceCode : null
      if (!lang && sentenceText) {
        // 拿整句去检测，而不是单词；关掉 LLM 保证同一文本每次结果一致
        lang = await detectLanguage(sentenceText, { minLength: 0, enableLLM: false })
      }
      return (lang && ttsConfig.languageVoices[lang]) || ttsConfig.defaultVoice || undefined
    },
    [language.sourceCode, ttsConfig],
  )

  const [voice, setVoice] = useState<string | undefined>()
  useEffect(() => {
    let cancelled = false
    void resolveVoiceForSentence(sentence).then((v) => {
      if (!cancelled) setVoice(v)
    })
    return () => {
      cancelled = true
    }
  }, [sentence, resolveVoiceForSentence])

  // 预取下一张听力卡的语音——换题时最影响体验的等待，是"整句 + Spell the word"
  // 这两次语音合成的网络往返。等切过去了才现发根本来不及。这里趁用户还在答
  // 当前这题（通常够合成两段短音频了）就把下一张的音频悄悄拉好存进缓存，真
  // 正切过去时 speak() 走的是同一把缓存 key，直接命中，不用再等网络。
  useEffect(() => {
    if (!nextCard || nextQuizMode !== "listening" || !notebase) return undefined
    let cancelled = false
    // 慢速开关是跨卡片持续生效的（不会随换卡重置），所以下一张卡大概率沿用
    // 当前这个 slow 值——预取时必须按同一个速率合成，否则缓存 key 对不上，
    // 真正播放时还是得重新等一次网络。
    const nextTtsConfig = slow ? { ...ttsConfig, rate: SLOW_RATE } : ttsConfig
    void (async () => {
      try {
        const nextVoice = await resolveVoiceForSentence(nextSentence)
        if (cancelled) return
        const opts = nextVoice ? { forcedVoice: nextVoice } : undefined
        if (nextSentence) await prefetch(nextSentence, nextTtsConfig, opts)
        if (cancelled) return
        await prefetch(`Spell the word: ${nextCard.front}`, nextTtsConfig, opts)
      } catch {
        // 预取失败不影响使用——真正切到那张卡时会照常发起一次正常请求
      }
    })()
    return () => {
      cancelled = true
    }
    // exhaustive-deps 会提示"缺少 nextCard"——这里是刻意只依赖用到的两个字段。
    // 把整个 nextCard 放进来的话，每次查询重新取数都会换一个对象引用，
    // effect 就会反复重跑、重复预取同一张卡的语音。
  }, [
    nextCard?.id,
    nextCard?.front,
    nextQuizMode,
    nextSentence,
    notebase,
    ttsConfig,
    slow,
    resolveVoiceForSentence,
    prefetch,
  ])

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

  // 进入听力题自动播放：先整句，再报出要拼的词。
  // 中译英模式绝不能播——一出声就等于直接告诉你答案了。
  // 用 ref 记住播过哪张卡，避免 React 重渲染时重复播放。
  useEffect(() => {
    if (!current || quizMode !== "listening") return undefined
    // 生词本是异步加载的。数据没到之前 sentence 还是空字符串，此时若先把这张卡
    // 标记为"已播过"，整句就永远补不上了（依赖变化后会被下面的 ref 判断拦掉），
    // 结果只念了 "Spell the word: xxx"。所以必须等数据到齐再开播。
    if (!notebase) return undefined
    if (autoPlayedRef.current === current.id) return undefined
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
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换卡时自动播放一次
  }, [current?.id, quizMode, sentence, notebase])

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

  const handleRate = useCallback(
    (r: Rating) => {
      if (!revealed || isSubmitting) return
      submit(r)
    },
    [revealed, isSubmitting, submit],
  )

  const checkSpelling = useCallback(() => {
    if (!current || checked) return
    const correct = normalize(typedAnswer) === normalize(current.front)
    setIsCorrect(correct)
    setChecked(true)
    setRevealed(true)
    // 立即让出焦点：不这样做的话，在 React 完成卸载 <input> 之前的这一小段时间里，
    // 全局快捷键监听会把"当前正在输入"判断错，导致刚提交完的那一下 1/2/3/4 被吞掉。
    inputRef.current?.blur()
    if (!correct) void speak(current.front)
  }, [current, checked, typedAnswer, speak])

  // 揭晓答案后卡片会变高（拼写反馈 / 例句 / 评分按钮一起出现），评分按钮常被
  // 顶出可视区，用户得先拿鼠标往下拖一段才够得着——这就违背了纯键盘评分的初衷。
  // 这里自动把评分区滚到可见位置，键盘操作全程不用碰鼠标。
  useEffect(() => {
    if (!revealed) return
    ratingsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [revealed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 光比对 inputRef 是不够的：语境填空有一排自己的输入框，都不等于这个 ref，
      // 于是在填空里打字会被判成"没在输入"——空格被吃掉、打 1/2/3/4 直接变成评分。
      // 这里按元素本身判断，页面上任何输入位置都算在打字。
      const typing = isTypingTarget(document.activeElement)

      // 空格揭晓只属于正反面题型。听写/中译英要先提交拼写，语境填空要先提交或
      // 点显示答案——它们各自有揭晓的入口。之前这里只排除了拼写类，
      // 于是在填空题里按一下空格，答案根本没显示，评分按钮却冒出来了，
      // 变成"没看见答案就能打分"。
      if (e.code === "Space" && !typing) {
        if (!canSpaceReveal(quizMode)) return
        e.preventDefault()
        if (!revealed) setRevealed(true)
        return
      }
      if (typing) return
      const m = RATING_META.find((x) => x.keyCap === e.key)
      if (m) {
        e.preventDefault()
        handleRate(m.key)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [revealed, quizMode, handleRate])

  const restart = () => {
    setIdx(0)
    setDone(0)
    setRevealed(false)
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
            <Button variant="outline" size="sm" className="mt-5" onClick={restart}>
              再看一轮
            </Button>
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

            {/* 题型：默认自动按每张卡的复习次数轮换，保证每个词两个方向都被考到。
                手动挡留给专项训练用。*/}
            <div className="flex items-center justify-center gap-1 text-xs">
              {(
                [
                  { key: "auto", label: "自动轮换" },
                  { key: "listening", label: "只练听力" },
                  { key: "translation", label: "只练表达" },
                  { key: "cloze", label: "只练填空" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setModePref(m.key)}
                  className={`rounded-full px-3 py-1 transition ${
                    modePref === m.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {quizMode === "cloze" ? (
              <ClozeCard
                // key 让换卡时组件整体重建，内部状态自动清空，
                // 不用在组件里再写一套"换句时重置"的逻辑
                key={current.id}
                sentence={sentence}
                translation={sentenceTranslation}
                onDone={(correct) => {
                  setIsCorrect(correct)
                  setChecked(true)
                  setRevealed(true)
                  if (!correct) void speak(sentence)
                }}
              />
            ) : spellingMode ? (
              <div className="flex min-h-72 flex-col justify-center gap-5 rounded-xl border bg-card p-8">
                <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    {quizMode === "listening" ? "听音拼写" : "中译英"}
                  </span>
                  <span>
                    {quizMode === "listening" ? "听发音，打出这个词" : "看中文，写出英文单词"}
                  </span>
                </div>

                {/* 听力模式：只给语音，不给任何中文。
                        中文释义 = 直接给答案；中文句意 = 变相给答案；
                        音标 = 原词音译；英文原句 = 暴露字母数。全部留到答完再显示。*/}
                {quizMode === "listening" && (
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
                        slow
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      🐢 慢速{slow ? "开" : "关"}
                    </button>
                  </div>
                )}

                {/* 中译英模式：只给中文，一个语音按钮都不能有——
                        听一下就知道答案了，那就完全测不出「想说的话能不能用英文表达」。*/}
                {quizMode === "translation" && (
                  <div className="flex flex-col items-center gap-2 text-center">
                    {fields?.[FIELD.definition] && (
                      <div className="max-w-lg text-lg leading-relaxed">
                        {fields[FIELD.definition]}
                      </div>
                    )}
                    {fields?.[FIELD.sentenceTranslation] && (
                      <div className="max-w-lg text-sm text-muted-foreground">
                        「{fields[FIELD.sentenceTranslation]}」
                      </div>
                    )}
                  </div>
                )}

                {/* 词性两种模式都给：只透露语法角色，不泄露词义 */}
                {fields?.[FIELD.partOfSpeech] && (
                  <div className="text-center text-sm text-muted-foreground italic">
                    {fields[FIELD.partOfSpeech]}
                  </div>
                )}

                {!checked ? (
                  <div className="flex justify-center gap-2">
                    <input
                      ref={inputRef}
                      value={typedAnswer}
                      onChange={(e) => setTypedAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") checkSpelling()
                      }}
                      placeholder={
                        quizMode === "listening" ? "输入你听到的单词…" : "输入对应的英文单词…"
                      }
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="w-64 rounded-lg border bg-background px-4 py-2.5 text-center text-lg outline-none focus:ring-2 focus:ring-primary"
                    />
                    <Button onClick={checkSpelling} disabled={!typedAnswer.trim()}>
                      提交
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 border-t pt-5">
                    <div
                      className={`rounded-lg px-4 py-2 text-lg font-semibold ${
                        isCorrect
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-red-500/10 text-red-600"
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

                    {/* 助记：答错时最需要的就是这个——给个能挂住记忆的钩子，
                        而不是让人把同一个词再死记一遍 */}
                    {fields?.[FIELD.mnemonic] && (
                      <div className="max-w-lg rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-left text-sm leading-relaxed">
                        <span className="mr-2 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          助记
                        </span>
                        {fields[FIELD.mnemonic]}
                      </div>
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
                      <AudioChip
                        label="再听单词"
                        busy={audioBusy}
                        onClick={() => void speak(current.front)}
                      />
                      {sentence && (
                        <AudioChip
                          label="再听整句"
                          busy={audioBusy}
                          onClick={() => void speak(sentence)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="flex min-h-64 cursor-pointer flex-col items-center justify-center gap-5 rounded-xl border bg-card p-8 text-center"
                onClick={() => !revealed && setRevealed(true)}
              >
                <div className="flex items-center gap-2 text-3xl font-semibold">
                  <span>{current.front}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void speak(current.front)
                    }}
                    aria-label="朗读发音"
                    className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    {audioBusy ? (
                      <IconLoader2 className="size-5 animate-spin" />
                    ) : (
                      <IconVolume className="size-5" />
                    )}
                  </button>
                </div>

                {revealed ? (
                  <div className="w-full border-t pt-5 text-left text-[15px] leading-relaxed whitespace-pre-line">
                    {current.back}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    点击卡片或按 <kbd className="rounded border px-1.5 py-0.5 text-xs">空格</kbd>{" "}
                    显示答案
                  </div>
                )}
              </div>
            )}

            {revealed && (
              <div ref={ratingsRef} className="grid grid-cols-4 gap-2">
                {RATING_META.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleRate(m.key)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-3 text-sm font-medium transition disabled:opacity-50 ${m.cls}`}
                  >
                    <span>{m.label}</span>
                    <span className="text-[11px] opacity-80">{m.hint}</span>
                    <span className="mt-0.5 rounded bg-black/20 px-1.5 text-[10px]">
                      {m.keyCap}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="text-center text-xs text-muted-foreground">
              复习 {current.reps} 次 · 忘记 {current.lapses} 次
            </div>
          </>
        )}

        {/* 通往造句练习的通道，故意放在所有分支之外：最想换个方向练的时刻，
            恰恰是"今天复习完了"和"没有卡片要复习"这两种状态，塞进答题区块里
            反而那两种情况下都看不见。 */}
        {!isPending && (
          <Link
            to="/sentence-practice"
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            <IconPencilQuestion className="size-4" />
            换个方向练：看中文，把整句英文拼出来
          </Link>
        )}

        <FreeProductBadge />
      </div>
    </PageLayout>
  )
}

function AudioChip({
  label,
  busy,
  onClick,
}: {
  label: string
  busy: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-50"
    >
      {busy ? (
        <IconPlayerStopFilled className="size-4 text-primary" />
      ) : (
        <IconVolume className="size-4" />
      )}
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
      <Button variant="outline" size="sm" className="mt-5" onClick={onRefresh}>
        刷新
      </Button>
    </div>
  )
}
