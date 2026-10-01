/**
 * 每日必学锁屏页面（渲染进程）。出题、判题都在主进程和扩展那边，这里只管显示和收键盘：
 * 拿题 → 显示 → 把打的字交给主进程 → 显示对错 → 下一题。所有文字一律用 textContent，不拼 HTML。
 */

{
  type LockQuestion = import("../shared/lock-api").LockQuestion
  type LockProgress = import("../shared/lock-api").LockProgress

  const app = document.getElementById("app")!
  const params = new URLSearchParams(location.search)

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (className) {
      node.className = className
    }
    if (text !== undefined) {
      node.textContent = text
    }
    return node
  }

  function clear() {
    app.replaceChildren()
  }

  // 其余显示器：只盖一层黑幕，题在主屏上答
  if (params.get("cover")) {
    app.className = "cover"
    app.textContent = "先完成今天的单词，再用电脑——请到主屏幕上答题"
  } else {
    void start()
  }

  const MODE_LABEL: Record<LockQuestion["mode"], string> = {
    intro: "新词 · 照着打一遍",
    spell: "中译英 · 把这个词拼出来",
    cloze: "例句填空 · 补全句子",
  }

  const LETTER_HINT_FROM = 6

  let target = 0
  let emergencyPhrase = ""
  let loading = false
  let progress: LockProgress = { done: 0, target: 0 }
  /** 最近答过的几张卡，请扩展尽量别马上再出 */
  const recent: string[] = []
  let audio: HTMLAudioElement | null = null
  let busy = false
  let finished = false

  let barFill: HTMLDivElement
  let countText: HTMLDivElement
  let body: HTMLDivElement

  function buildShell(windowed: boolean) {
    clear()
    if (windowed) {
      const banner = el("div", "banner", "测试窗口：正式使用时这是一个盖住整个屏幕的锁屏")
      app.append(banner)
    }
    const top = el("div", "top")
    top.append(el("h1", undefined, "今日必学 · 先把单词答完，再用电脑"))
    const bar = el("div", "bar")
    barFill = el("div")
    bar.append(barFill)
    countText = el("div", "count")
    top.append(bar, countText)

    body = el("div", "card")
    const foot = el("div", "foot")
    const emergency = el("button", "link", "紧急解锁")
    emergency.addEventListener("click", openEmergency)
    foot.append(emergency)
    app.append(top, body, foot)
  }

  function setProgress(next: LockProgress) {
    progress = next
    const shown = Math.min(next.done, next.target)
    countText.textContent = `${shown} / ${next.target}`
    barFill.style.width = `${next.target > 0 ? (shown / next.target) * 100 : 0}%`
  }

  async function start() {
    const init = await window.dicLock.init()
    target = init.target
    emergencyPhrase = init.emergencyPhrase
    buildShell(init.windowed)
    setProgress({ done: 0, target })
    window.dicLock.onDone(showDone)
    await loadNext()
  }

  function showCenter(title: string, lines: string[], buttons: HTMLButtonElement[] = []) {
    body.replaceChildren()
    const box = el("div", "center")
    box.append(el("h2", undefined, title))
    for (const line of lines) {
      box.append(el("p", undefined, line))
    }
    if (buttons.length > 0) {
      const row = el("div")
      row.style.display = "flex"
      row.style.gap = "10px"
      row.append(...buttons)
      box.append(row)
    }
    body.append(box)
  }

  function showWaiting(message: string, code: string) {
    const open = el("button", "primary", "启动浏览器")
    open.addEventListener("click", () => window.dicLock.openBrowser())
    const lines =
      code === "not_connected"
        ? [
            "题目存在浏览器的词典扩展里，需要先让它连上。",
            "点下面的按钮启动浏览器，几秒后会自动继续。",
            "一直连不上：到扩展设置 → 桌面版，打开「连接桌面版」。实在不行，用右下角的紧急解锁。",
          ]
        : [message]
    showCenter(code === "not_connected" ? "正在连接词典扩展…" : "暂时出不了题", lines, [open])
    setTimeout(() => void loadNext(), 3000)
  }

  async function loadNext() {
    // 自动跳下一题和手按回车可能撞在一起，只放一个过去
    if (finished || loading) {
      return
    }
    loading = true
    const reply = await window.dicLock.next(recent.slice(-3)).finally(() => {
      loading = false
    })
    if (finished) {
      return
    }
    if (!reply.ok) {
      showWaiting(reply.message, reply.code)
      return
    }
    setProgress(reply.progress)
    if (reply.question) {
      showQuestion(reply.question)
    }
    // question 为 null：没有更多词了，主进程会马上通知收尾（onDone）
  }

  function play(text: string) {
    void window.dicLock.speak(text).then((result) => {
      if (result.ok) {
        audio?.pause()
        audio = new Audio(`data:${result.contentType};base64,${result.audioBase64}`)
        void audio.play().catch(() => {})
      } else {
        speechSynthesis.cancel()
        speechSynthesis.speak(new SpeechSynthesisUtterance(text))
      }
    })
  }

  function letterHint(word: string): string {
    const blanks = [...word].map((char) => (char === " " ? "　" : "＿"))
    const count = [...word].filter((char) => char !== " ").length
    const first = count >= LETTER_HINT_FROM ? ` · 以 ${word[0]} 开头` : ""
    return `${blanks.join(" ")}（${count} 个字母${first}）`
  }

  function showQuestion(question: LockQuestion) {
    body.replaceChildren()
    body.append(el("div", "mode", MODE_LABEL[question.mode]))

    if (question.mode === "intro") {
      body.append(el("div", "word", question.word))
      const meta = [question.phonetic, question.partOfSpeech].filter(Boolean).join("   ")
      if (meta) {
        body.append(el("div", "meta", meta))
      }
    }
    if (question.mode !== "cloze" && question.definition) {
      body.append(el("div", "definition", question.definition))
    }
    if (question.sentence) {
      body.append(el("div", "sentence", question.sentence))
    }
    if (question.sentenceTranslation && question.mode !== "spell") {
      body.append(el("div", "sentence-tr", question.sentenceTranslation))
    }
    if (question.mode === "cloze" && question.definition) {
      body.append(el("div", "sentence-tr", `释义：${question.definition}`))
    }
    if (question.mnemonic && question.mode === "intro") {
      body.append(el("div", "mnemonic", question.mnemonic))
    }
    if (question.mode !== "intro") {
      body.append(el("div", "hint", letterHint(question.answers[0] ?? question.word)))
    }

    const feedback = el("div", "feedback")
    const row = el("div", "answer-row")
    const input = el("input", "answer")
    input.type = "text"
    input.autocomplete = "off"
    input.spellcheck = false
    input.placeholder = question.mode === "intro" ? "照着把它打一遍" : "把英文拼出来，按回车"
    const speak = el("button", undefined, "🔊")
    speak.title = "听发音"
    // 要拼的题听发音就等于给答案，答完再放开
    speak.disabled = question.mode !== "intro"
    speak.addEventListener("click", () => play(question.word))
    const submit = el("button", "primary", "提交")
    row.append(input, speak, submit)
    body.append(feedback, row)
    input.focus({ preventScroll: true })
    if (question.mode === "intro") {
      play(question.word)
    }

    const shownAt = Date.now()
    let answered = false

    const send = async () => {
      if (busy) {
        return
      }
      if (answered) {
        void loadNext()
        return
      }
      const typed = input.value
      if (!typed.trim()) {
        return
      }
      busy = true
      const reply = await window.dicLock.submit(question.cardId, typed, Date.now() - shownAt)
      busy = false
      if (!reply.ok) {
        feedback.className = "feedback bad"
        feedback.textContent = reply.message
        return
      }
      setProgress(reply.progress)
      if (reply.retry) {
        input.className = "answer bad"
        feedback.className = "feedback bad"
        feedback.textContent = "不对，看着上面的词再打一遍"
        input.select()
        return
      }
      answered = true
      input.disabled = true
      speak.disabled = false
      recent.push(question.cardId)
      if (reply.correct) {
        input.className = "answer good"
        feedback.className = "feedback good"
        feedback.textContent = "✓ 对了"
        setTimeout(() => {
          if (!finished) {
            void loadNext()
          }
        }, 900)
        if (question.mode !== "intro") {
          play(question.word)
        }
      } else {
        input.className = "answer bad"
        feedback.className = "feedback bad"
        feedback.textContent = `✗ 正确写法：${reply.answers.join(" / ")}（按回车继续，这个词稍后还会再考你）`
        submit.textContent = "继续"
        input.disabled = false
        input.value = reply.answers[0] ?? ""
        input.readOnly = true
        play(question.word)
      }
    }

    submit.addEventListener("click", () => void send())
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        void send()
      }
    })
  }

  function showDone(reason: "done" | "empty" | "emergency" | "off", result: LockProgress | null) {
    finished = true
    const shown = result ?? progress
    const titles = {
      done: "今天的目标完成了 🎉",
      empty: "今天的词都答完了",
      emergency: "已解锁",
      off: "每日必学已关闭",
    }
    const lines =
      reason === "done"
        ? [`今天答对了 ${Math.min(shown.done, shown.target)} 个，明天继续。`]
        : reason === "empty"
          ? ["没有更多要复习的词了，今天先到这里。"]
          : reason === "emergency"
            ? ["今天不再锁屏。明天记得把单词补上。"]
            : []
    showCenter(titles[reason], lines)
  }

  function openEmergency() {
    const phrase = emergencyPhrase
    const modal = el("div", "modal")
    const box = el("div", "modal-box")
    box.append(
      el("h2", undefined, "紧急解锁"),
      el(
        "p",
        undefined,
        "确实有急事的话，把下面这句话一个字一个字敲进去（不能粘贴）。今天不会再锁，但明天照旧。",
      ),
      el("div", "phrase", phrase),
    )
    const input = el("input", "answer")
    input.type = "text"
    input.autocomplete = "off"
    input.spellcheck = false
    input.addEventListener("paste", (event) => event.preventDefault())
    input.addEventListener("drop", (event) => event.preventDefault())
    const message = el("div", "feedback bad")
    const row = el("div")
    row.style.display = "flex"
    row.style.gap = "10px"
    const cancel = el("button", undefined, "算了，继续答题")
    const confirm = el("button", "primary", "解锁")
    row.append(confirm, cancel)
    box.append(input, message, row)
    modal.append(box)
    app.append(modal)
    input.focus({ preventScroll: true })

    const close = () => modal.remove()
    cancel.addEventListener("click", close)
    const submit = async () => {
      const ok = await window.dicLock.emergencyUnlock(input.value)
      if (!ok) {
        message.textContent = "不对，请一字不差地敲"
        box.classList.remove("shake")
        void box.offsetWidth
        box.classList.add("shake")
      }
    }
    confirm.addEventListener("click", () => void submit())
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        void submit()
      }
      if (event.key === "Escape") {
        close()
      }
    })
  }
}
