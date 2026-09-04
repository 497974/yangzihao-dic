/**
 * 造句练习页
 *
 * 看中文，把英文句子拼出来 —— 补上"词都认识但连不成句"这一环（划词词典解决
 * 看不懂，闪卡听音拼写解决听不出，这里解决说不出）。
 *
 * 交互上刻意抄了成熟产品的两个设计：
 *   1. 空的宽度按词长走，长短本身就是提示，但不直接给答案
 *   2. 空可以乱序填，提交后逐空判定 —— 只标错的那一个，对的锁定，错的保留你
 *      的输入让你自己改，绝不整句判错把答案全抖出来
 *
 * 句子直接取自生词本里划词存下的例句（句子 + 句子翻译），不额外联网、不花 token。
 */

import { IconLoader2, IconVolume } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FreeProductBadge } from "@/components/free-product-badge"
import { Button } from "@/components/ui/base-ui/button"
import { PageLayout } from "@/entrypoints/options/components/page-layout"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { ANALYTICS_SURFACE } from "@/types/analytics"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { detectLanguage } from "@/utils/content/language"
import { cellToText } from "@/utils/notebase/cell-text"
import { orpcClient } from "@/utils/orpc/client"
import {
  type BlankVerdict,
  blankWidthCh,
  checkBlanks,
  prepareSentence,
  type SentenceToken,
} from "@/utils/sentence-practice/blanks"
import { SENTENCE_CORPUS } from "@/utils/sentence-practice/corpus"
import {
  markSortWeight,
  readProgress,
  recordSentenceSolved,
  type SentenceMark,
  setSentenceMark,
} from "@/utils/sentence-practice/progress"

/** 生词本里这两列的列名 —— 与词典操作的输出字段一一对应 */
const FIELD = {
  sentence: "句子",
  sentenceTranslation: "句子翻译",
  term: "词条",
} as const

/** 太短的"句子"（比如只有一个词）当不了造句题 */
const MIN_WORDS = 3

/**
 * 从零拼整句的长度上限。这里是**全挖空**——没有骨架可蹭，一个词都不给。
 * 内置语料库最长 10 词，正合适；生词本里的例句最长 28 词，那种长度全挖
 * 不是练习是酷刑，超过这个数就不进题库。
 */
const MAX_WORDS_FOR_CONSTRUCTION = 12

type PracticeSource = "corpus" | "notebase"

/** 跟在前面内容后面、前面不该加空格的标点 */
const ATTACHES_LEFT = /^[.,!?;:%)\]}''"]|^n't$/i
/** 后面不该加空格的开括号类 */
const ATTACHES_RIGHT = /[([{$"']$/

function needsSpaceBefore(prev: SentenceToken | undefined, token: SentenceToken): boolean {
  if (!prev) return false
  if (ATTACHES_LEFT.test(token.text)) return false
  if (ATTACHES_RIGHT.test(prev.text)) return false
  return true
}

interface PracticeItem {
  id: string
  sentence: string
  translation: string
  term: string
  /** 句式骨架，只有内置语料库有 */
  pattern?: string
  /** 为什么这么说：语法要点、地道用法。答完题才展开 */
  note?: string
}

function MarkButton({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean
  activeClass: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? activeClass : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          {key}
        </kbd>
      ))}
      <span className="ml-0.5">{label}</span>
    </span>
  )
}

export function SentencePracticePage() {
  const ttsConfig = useAtomValue(configFieldsAtomMap.tts)
  const language = useAtomValue(configFieldsAtomMap.language)
  const { play, prefetch, stop, isFetching, isPlaying } = useTextToSpeech(
    ANALYTICS_SURFACE.FLASHCARD_REVIEW,
  )

  /** 默认用内置语料库：那批句子是按"从零拼整句"的难度和长度专门挑的 */
  const [source, setSource] = useState<PracticeSource>("corpus")
  const [idx, setIdx] = useState(0)
  const [inputs, setInputs] = useState<string[]>([])
  const [verdicts, setVerdicts] = useState<BlankVerdict[] | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [solvedCount, setSolvedCount] = useState(0)
  const [attempted, setAttempted] = useState(false)
  /** 「再来一轮」计数，变化时触发重新洗牌 */
  const [round, setRound] = useState(0)
  /** 本句是否出过错——决定还算不算 Perfect、连击断不断 */
  const [hadMistake, setHadMistake] = useState(false)
  const [combo, setCombo] = useState(0)
  const [bestCombo, setBestCombo] = useState(0)
  const [perfectCount, setPerfectCount] = useState(0)
  const [marks, setMarks] = useState<Record<string, SentenceMark>>({})
  /** 标记读完了没——队列排序要等它到齐，否则排了个寂寞 */
  const [marksLoaded, setMarksLoaded] = useState(false)
  /**
   * 队列排序要读标记，但又不能把 marks 放进 useMemo 依赖：那样每标记一句就会
   * 立刻重排整个队列，正在做的题被换走。所以用 ref 读当下快照，重排时机
   * 由 marksLoaded / round 显式控制。
   */
  const marksRef = useRef(marks)
  marksRef.current = marks
  const blankRefs = useRef<(HTMLInputElement | null)[]>([])

  // 本局计时：只记录页面停留时长，够用且零成本
  const [sessionStart, setSessionStart] = useState(() => Date.now())
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setElapsedMs(Date.now() - sessionStart), 1000)
    return () => clearInterval(timer)
  }, [sessionStart])

  // 标记是异步读出来的；读完之前先按无标记渲染，读完再补上
  useEffect(() => {
    let cancelled = false
    void readProgress()
      .then((progress) => {
        if (!cancelled) setMarks(progress.marks)
      })
      .finally(() => {
        // 读失败也要放行，否则队列会一直等在"未排序"状态
        if (!cancelled) setMarksLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { data: notebases, isPending: notebasesPending } = useQuery({
    queryKey: ["local-notebases"],
    queryFn: () => orpcClient.notebase.list({}),
  })
  const notebaseId = notebases?.[0]?.id

  const { data: notebase, isPending: notebasePending } = useQuery({
    queryKey: ["local-notebase-detail", notebaseId],
    queryFn: () => orpcClient.notebase.get({ id: notebaseId! }),
    enabled: !!notebaseId,
  })

  /**
   * 注意：react-query v5 里 `enabled: false` 的查询，status 一直是 pending，
   * isPending 恒为 true。新装机的用户还没有任何笔记库，notebaseId 是 undefined，
   * 详情查询被禁用 —— 直接拿 isPending 当加载态的话，页面会永远停在"加载中…"，
   * 连一条数据都不需要的内置语料库也显示不出来。
   *
   * 所以：语料库题库不等任何查询；只有切到生词本时才需要等，而且没有笔记库
   * 时也不算加载中（应该走空状态提示，而不是转圈）。
   */
  const isPending = source === "notebase" && (notebasesPending || (!!notebaseId && notebasePending))

  /** 生词本里够短、能拿来从零拼的句子 */
  const notebaseItems = useMemo<PracticeItem[]>(() => {
    if (!notebase) return []
    const nameById = new Map(notebase.notebaseColumns.map((c) => [c.id, c.name]))
    const out: PracticeItem[] = []
    for (const row of notebase.notebaseRows) {
      const fields: Record<string, string> = {}
      for (const [colId, value] of Object.entries(row.cells ?? {})) {
        const name = nameById.get(colId)
        if (name) fields[name] = cellToText(value).trim()
      }
      const sentence = fields[FIELD.sentence] ?? ""
      const translation = fields[FIELD.sentenceTranslation] ?? ""
      if (!sentence || !translation) continue
      const words = sentence.split(/\s+/).filter(Boolean).length
      if (words < MIN_WORDS || words > MAX_WORDS_FOR_CONSTRUCTION) continue
      out.push({ id: row.id, sentence, translation, term: fields[FIELD.term] ?? "" })
    }
    return out
  }, [notebase])

  const corpusItems = useMemo<PracticeItem[]>(
    () =>
      SENTENCE_CORPUS.map((s) => ({
        id: s.id,
        sentence: s.en,
        translation: s.zh,
        term: s.scene,
        pattern: s.pattern,
        note: s.note,
      })),
    [],
  )

  const items = source === "corpus" ? corpusItems : notebaseItems

  // 打乱顺序，避免总是从同一句开始；每按一次「再来一轮」重排一次，否则第二轮
  // 跟第一轮完全一样，重复练就只是在背顺序。
  // 依赖只看条数不看内容：后台重新拉数据会生成新数组，但内容没变时不该把正在
  // 做的这一轮打乱重排。
  const queue = useMemo(() => {
    const shuffled = [...items]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    // 先随机再按标记稳定排序：标记相同的那一档内部保持随机，档与档之间
    // 生词在前、已掌握沉底。直接按标记排会让同档顺序每轮都一样。
    return shuffled.sort(
      (a, b) => markSortWeight(marksRef.current[a.id]) - markSortWeight(marksRef.current[b.id]),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上方注释
  }, [items.length, round, marksLoaded, source])

  // 换题库要从头开始，否则会停在上一个题库的进度上（下标可能还越界）
  useEffect(() => {
    setIdx(0)
    setSolvedCount(0)
    setPerfectCount(0)
    setCombo(0)
  }, [source])

  const current = queue[idx]
  // "all" = 整句全挖。造句练习就该没有骨架可蹭：留着 the/of/in 当提示的话，
  // 考的是"这个位置填哪个词"（词汇题），不是"这个意思怎么用英文说"（表达题）。
  const prepared = useMemo(
    () => (current ? prepareSentence(current.sentence, "all") : { tokens: [], answers: [] }),
    [current],
  )

  // 换题时清空所有状态
  useEffect(() => {
    setInputs(Array.from({ length: prepared.answers.length }, () => ""))
    setVerdicts(null)
    setRevealed(false)
    setAttempted(false)
    setHadMistake(false)
    // 不清空 blankRefs：ref 回调是在渲染时写入的，effect 在其之后才跑，清空会把
    // 刚写好的引用抹掉，导致下面这次 focus 拿到 undefined。多余的旧引用无害，
    // 因为访问下标永远来自当前句子的空位数。
    requestAnimationFrame(() => blankRefs.current[0]?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换题时重置
  }, [current?.id])

  // 锁定音色，别让 TTS 按短文本猜语言（同闪卡页的处理）
  const [voice, setVoice] = useState<string | undefined>()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let lang = language.sourceCode !== "auto" ? language.sourceCode : null
      if (!lang && current?.sentence) {
        lang = await detectLanguage(current.sentence, { minLength: 0, enableLLM: false })
      }
      if (cancelled) return
      setVoice((lang && ttsConfig.languageVoices[lang]) || ttsConfig.defaultVoice || undefined)
    })()
    return () => {
      cancelled = true
    }
  }, [language.sourceCode, current?.sentence, ttsConfig])

  const speak = useCallback(
    (text: string) => {
      if (!text) return Promise.resolve()
      return play(text, ttsConfig, voice ? { forcedVoice: voice } : undefined)
    },
    [play, ttsConfig, voice],
  )

  // 离开页面停掉音频（stop 每次渲染都是新引用，用 ref 存最新的，只在卸载时跑）
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => () => stopRef.current(), [])

  // 提前把这一句的音频合成好焐进缓存：答完题必定要播一次，而合成要走网络，
  // 等答完再现发就得干等。用户正在打字的这段时间足够合成完，真播的时候
  // 走的是同一把缓存 key，直接命中，零等待。
  useEffect(() => {
    if (!current?.sentence || !voice) return undefined
    let cancelled = false
    void (async () => {
      try {
        if (!cancelled) await prefetch(current.sentence, ttsConfig, { forcedVoice: voice })
      } catch {
        // 预取失败不影响答题，真播时会照常发一次正常请求
      }
    })()
    return () => {
      cancelled = true
    }
  }, [current?.sentence, voice, ttsConfig, prefetch])

  const allCorrect =
    verdicts !== null && verdicts.length > 0 && verdicts.every((v) => v === "correct")

  const handleCheck = useCallback(() => {
    if (!current || allCorrect) return
    const next = checkBlanks(inputs, prepared.answers)
    setVerdicts(next)
    setAttempted(true)
    if (next.every((v) => v === "correct")) {
      setSolvedCount((n) => n + 1)
      void recordSentenceSolved(current.id)
      // 一次通过才算 Perfect、才续连击；错过一次或看过答案就不算。
      // 连击的意义在于"不出错地连续拿下"，掺水就没有驱动力了。
      if (!hadMistake) {
        setPerfectCount((n) => n + 1)
        setCombo((c) => {
          const nextCombo = c + 1
          setBestCombo((best) => Math.max(best, nextCombo))
          return nextCombo
        })
      }
      void speak(current.sentence)
      return
    }
    // 提交了但没全对：连击断掉，并记下这句已经出过错
    setHadMistake(true)
    setCombo(0)
    // 焦点送到第一个错的空上，方便直接改
    const firstWrong = next.findIndex((v) => v === "wrong")
    const target = firstWrong >= 0 ? firstWrong : next.findIndex((v) => v === "empty")
    if (target >= 0) requestAnimationFrame(() => blankRefs.current[target]?.focus())
  }, [current, allCorrect, inputs, prepared.answers, speak, hadMistake])

  /**
   * 在空格之间跳转。原生 Tab 会把焦点带出空格区（跑到按钮、侧边栏上），
   * 而且已答对的空是 readOnly 但仍可聚焦，Tab 会白停在上面。所以这里自己接管：
   * 只在"还没答对的空"之间循环，到头绕回另一端。
   */
  const focusBlank = useCallback(
    (from: number, dir: 1 | -1) => {
      const total = prepared.answers.length
      if (total === 0) return
      for (let step = 1; step <= total; step++) {
        const target = (((from + dir * step) % total) + total) % total
        if (verdicts?.[target] === "correct") continue
        const el = blankRefs.current[target]
        if (!el) continue
        el.focus()
        el.select()
        return
      }
    },
    [prepared.answers.length, verdicts],
  )

  const handleBlankKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, bi: number) => {
      const el = e.currentTarget
      if (e.key === "Tab") {
        e.preventDefault()
        focusBlank(bi, e.shiftKey ? -1 : 1)
        return
      }
      // 方向键只在光标已经顶到边界时才跳格，否则正常在词内移动光标
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
      if (e.key === "ArrowLeft" && atStart) {
        e.preventDefault()
        focusBlank(bi, -1)
      } else if (e.key === "ArrowRight" && atEnd) {
        e.preventDefault()
        focusBlank(bi, 1)
      }
    },
    [focusBlank],
  )

  const handleReveal = useCallback(() => {
    setRevealed(true)
    setInputs([...prepared.answers])
    setVerdicts(prepared.answers.map(() => "correct" as const))
    // 看了答案就不是自己拿下的，连击照断
    setHadMistake(true)
    setCombo(0)
    // 看答案时更需要听一遍——这时才是真正在学这句话怎么说
    if (current) void speak(current.sentence)
  }, [prepared.answers, current, speak])

  const goNext = useCallback(() => {
    stop()
    setIdx((i) => i + 1)
  }, [stop])

  const restart = useCallback(() => {
    stop()
    setIdx(0)
    setSolvedCount(0)
    setPerfectCount(0)
    setCombo(0)
    setBestCombo(0)
    setSessionStart(Date.now())
    setElapsedMs(0)
    setRound((n) => n + 1)
  }, [stop])

  /** 标记当前句：已经是这个标记就取消，相当于按同一个键切换开关 */
  const toggleMark = useCallback(
    (mark: SentenceMark) => {
      if (!current) return
      const next = marks[current.id] === mark ? null : mark
      setMarks((prev) => {
        const copy = { ...prev }
        if (next === null) delete copy[current.id]
        else copy[current.id] = next
        return copy
      })
      void setSentenceMark(current.id, next)
    },
    [current, marks],
  )

  // 快捷键：答题时手一直在键盘上，不该逼人去点按钮。
  // Enter 在输入框里也要生效，所以监听挂在 window 上而不是按钮上——但挂在 window
  // 上就会抢走本该属于别人的回车：命令面板（Ctrl+K）用 Enter 确认选中项，按钮
  // 用 Enter 触发点击。所以先判断这个按键该不该归我们管。
  useEffect(() => {
    const shouldIgnore = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      // 对话框/命令面板打开时，回车是它们的确认键
      if (target.closest('[role="dialog"]')) return true
      if (target.isContentEditable || target.tagName === "TEXTAREA") return true
      // 页面上别的输入框（真有的话）不该被我们劫持；自己的空格除外
      if (target instanceof HTMLInputElement && !blankRefs.current.includes(target)) return true
      // 焦点在按钮上时，回车本来就该触发那个按钮
      if (target.tagName === "BUTTON" || target.closest("button")) return true
      return false
    }

    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnore(e.target)) return
      if (e.key === "Enter") {
        e.preventDefault()
        if (allCorrect) goNext()
        else handleCheck()
        return
      }
      // 标记用 Alt 而不是参考站那套 Ctrl+M / Ctrl+N：Ctrl+N 在 Chrome 里是
      // "新建窗口"，属于浏览器级快捷键，网页的 preventDefault() 拦不住——
      // 照搬过来按下去只会弹出新窗口。Alt+M / Alt+N 在 Chrome 里没有占用。
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === "m") {
          e.preventDefault()
          toggleMark("mastered")
        } else if (e.key.toLowerCase() === "n") {
          e.preventDefault()
          toggleMark("difficult")
        }
        return
      }
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === "'") {
        e.preventDefault()
        if (current && allCorrect) void speak(current.sentence)
      } else if (e.key === ";") {
        e.preventDefault()
        if (!allCorrect) handleReveal()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [allCorrect, goNext, handleCheck, handleReveal, speak, current, toggleMark])

  const finished = !isPending && queue.length > 0 && idx >= queue.length
  const audioBusy = isFetching || isPlaying

  return (
    <PageLayout
      title="造句练习"
      description="看中文，把英文句子拼出来 —— 练的是「说得出」，不只是「看得懂」"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {isPending && <div className="py-16 text-center text-muted-foreground">加载中…</div>}

        {!isPending && (
          <div className="flex items-center justify-center gap-1 text-xs">
            {(
              [
                { key: "corpus", label: `常用表达 ${corpusItems.length}` },
                { key: "notebase", label: `我的生词本 ${notebaseItems.length}` },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSource(s.key)}
                className={`rounded-full px-3 py-1 transition ${
                  source === s.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {!isPending && queue.length === 0 && (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <div className="text-4xl">✍️</div>
            <div className="mt-3 text-lg font-medium">这个题库还没有可练的句子</div>
            <div className="mt-1 text-sm text-muted-foreground">
              造句是从零拼整句，只收 {MAX_WORDS_FOR_CONSTRUCTION} 词以内的句子——
              生词本里的例句大多偏长，被过滤掉了。切到「常用表达」先练内置的那批。
            </div>
          </div>
        )}

        {!isPending && finished && (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <div className="text-4xl">🎉</div>
            <div className="mt-3 text-lg font-medium">这一轮练完了</div>
            <div className="mt-1 text-sm text-muted-foreground">
              共 {queue.length} 句 · 做对 {solvedCount} 句 · 用时 {formatElapsed(elapsedMs)}
            </div>
            <div className="mt-4 flex items-center justify-center gap-6 text-sm">
              <span className="text-amber-600">★ Perfect {perfectCount} 句</span>
              <span className="text-amber-600">🔥 最高连对 {bestCombo}</span>
            </div>
            <Button variant="outline" size="sm" className="mt-5" onClick={restart}>
              再来一轮
            </Button>
          </div>
        )}

        {!isPending && current && !finished && (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                第 {idx + 1} / {queue.length} 句
              </span>
              <div className="flex items-center gap-4">
                {combo >= 2 && <span className="font-medium text-amber-600">🔥 连对 {combo}</span>}
                <span>做对 {solvedCount}</span>
                <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>
              </div>
            </div>
            <div className="h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(idx / Math.max(queue.length, 1)) * 100}%` }}
              />
            </div>

            <div className="flex flex-col gap-6 rounded-xl border bg-card p-8">
              {/* 中文在最上面，是这道题的"题干" */}
              <div className="text-center text-xl leading-relaxed font-medium">
                {current.translation}
              </div>

              {/* 空可以乱序点、乱序填；宽度按词长走 */}
              <div className="flex flex-wrap items-end justify-center gap-y-3 text-lg leading-loose">
                {prepared.tokens.map((token, tokenIndex) => {
                  const space = needsSpaceBefore(prepared.tokens[tokenIndex - 1], token)
                  if (token.blankIndex === null) {
                    return (
                      <span key={token.key} className={space ? "ml-1.5" : ""}>
                        {token.text}
                      </span>
                    )
                  }
                  const bi = token.blankIndex
                  const verdict = verdicts?.[bi]
                  const locked = verdict === "correct"
                  return (
                    <input
                      key={token.key}
                      ref={(el) => {
                        blankRefs.current[bi] = el
                      }}
                      value={inputs[bi] ?? ""}
                      onChange={(e) => {
                        setInputs((prev) => {
                          const next = [...prev]
                          next[bi] = e.target.value
                          return next
                        })
                        // 改动某个空时，只清掉这个空的判定，别动其他空的对错
                        setVerdicts((prev) => {
                          if (!prev) return prev
                          const next = [...prev]
                          next[bi] = "empty"
                          return next
                        })
                      }}
                      readOnly={locked}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      onKeyDown={(e) => handleBlankKeyDown(e, bi)}
                      style={{
                        width: `${blankWidthCh(prepared.answers[bi] ?? "", inputs[bi] ?? "")}ch`,
                      }}
                      // 等宽字体是必须的：宽度用 ch 计算，而 ch 只在等宽字体里
                      // 才等于一个字母宽，比例字体下 m/w 会把字撑出框外看不见
                      className={`${space ? "ml-1.5" : ""} border-0 border-b-2 bg-transparent px-0.5 pb-0.5 text-center font-mono transition-colors outline-none ${
                        locked
                          ? "border-emerald-500 text-emerald-600"
                          : verdict === "wrong"
                            ? "border-red-500 text-red-600"
                            : "border-muted-foreground/40 focus:border-primary"
                      }`}
                    />
                  )
                })}
              </div>

              {/* 只说"哪几个空还不对"，不说是什么 */}
              {attempted && !allCorrect && verdicts && (
                <div className="text-center text-sm text-red-600">
                  还有 {verdicts.filter((v) => v !== "correct").length} 个空没对
                  {verdicts.some((v) => v === "wrong") && "，标红的改一下"}
                </div>
              )}

              {allCorrect && (
                <div className="text-center text-sm font-medium text-emerald-600">
                  {revealed ? (
                    "已显示答案"
                  ) : hadMistake ? (
                    "✓ 全对"
                  ) : (
                    <span className="text-amber-600">★ Perfect · 一次通过</span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2">
                {allCorrect ? (
                  <Button onClick={goNext}>下一句</Button>
                ) : (
                  <Button onClick={handleCheck}>提交</Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => void speak(current.sentence)}
                  disabled={!allCorrect}
                  title={allCorrect ? "" : "答对后才能听整句，避免直接抄答案"}
                >
                  {audioBusy ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconVolume className="size-4" />
                  )}
                  听整句
                </Button>
                {!allCorrect && (
                  <Button variant="ghost" onClick={handleReveal}>
                    显示答案
                  </Button>
                )}
              </div>

              {/* 讲解只在答完之后展开：答题时露出来等于给提示。
                  做对了也得知道为什么对，否则跟蒙对没区别。 */}
              {allCorrect && (current.pattern || current.note) && (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-left">
                  {current.pattern && (
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        句式
                      </span>
                      <span className="font-mono text-sm">{current.pattern}</span>
                    </div>
                  )}
                  {current.note && (
                    <p className="text-sm leading-relaxed text-muted-foreground">{current.note}</p>
                  )}
                </div>
              )}

              {/* 标记：练的时候顺手标，不用退出去管理。已掌握的下轮沉底，
                  生词优先冒头（见 progress.ts 的 markSortWeight）。 */}
              <div className="flex items-center justify-center gap-2 border-t pt-4">
                <MarkButton
                  active={marks[current.id] === "mastered"}
                  activeClass="border-emerald-500 bg-emerald-500/10 text-emerald-600"
                  onClick={() => toggleMark("mastered")}
                >
                  ✓ 已掌握
                </MarkButton>
                <MarkButton
                  active={marks[current.id] === "difficult"}
                  activeClass="border-amber-500 bg-amber-500/10 text-amber-600"
                  onClick={() => toggleMark("difficult")}
                >
                  ★ 标为生词
                </MarkButton>
              </div>
            </div>

            {/* 下一句预览：知道还剩什么，节奏感更强 */}
            {queue[idx + 1] && (
              <div className="truncate text-center text-xs text-muted-foreground">
                下一句：{queue[idx + 1]!.translation}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <ShortcutHint keys={["Enter"]} label={allCorrect ? "下一句" : "提交"} />
              <ShortcutHint keys={["Ctrl", "'"]} label="听整句" />
              <ShortcutHint keys={["Ctrl", ";"]} label="显示答案" />
              <ShortcutHint keys={["Alt", "M"]} label="已掌握" />
              <ShortcutHint keys={["Alt", "N"]} label="标生词" />
              <ShortcutHint keys={["Tab", "/", "←", "→"]} label="下一个空" />
              <ShortcutHint keys={["Shift", "Tab"]} label="上一个空" />
            </div>

            {current.term && (
              <div className="text-center text-xs text-muted-foreground">
                本句来自生词「{current.term}」
              </div>
            )}
          </>
        )}

        {/* 放在所有分支之外：空状态和完成页也要能看到 */}
        <FreeProductBadge />
      </div>
    </PageLayout>
  )
}
