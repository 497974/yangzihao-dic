/**
 * 查词弹窗的界面（渲染进程）。布局照搬浏览器扩展的查词弹窗：
 *   标题栏：词典图标 + 标题，右边钉子、关闭
 *   内容区：选中的原文（灰色，最多三行，点一下展开），分隔线，然后按词典设置一行一个字段
 *   底栏：左边来源，右边「保存到生词本」和重新生成
 * 大模型边写边显示：没写到的字段是"…"，写完才能保存。
 *
 * 只通过 preload 暴露的 window.dic 和主进程通信。
 * 所有文字一律用 textContent 放进页面：查词结果里就算夹着 HTML，也只会原样显示成文字。
 */

type PopupState = import("../shared/popup-api").PopupState
type PopupHeader = import("../shared/popup-api").PopupHeader
type ResultState = Extract<PopupState, { kind: "result" }>
type TranslationState = Extract<PopupState, { kind: "translation" }>
type ErrorState = Extract<PopupState, { kind: "error" }>
type QueuedState = Extract<PopupState, { kind: "queued" }>

/** Tabler 图标（和扩展用的是同一套），都是固定的字符串 */
const ICONS = {
  book: '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>',
  pin: '<path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/>',
  pinned:
    '<path fill="currentColor" stroke="none" d="M15.113 3.21l.094 .083l5.5 5.5a1 1 0 0 1 -1.175 1.59l-3.172 3.171l-1.424 3.797a1 1 0 0 1 -.158 .277l-.07 .08l-1.5 1.5a1 1 0 0 1 -1.32 .082l-.095 -.083l-2.793 -2.792l-3.793 3.792a1 1 0 0 1 -1.497 -1.32l.083 -.094l3.792 -3.793l-2.792 -2.793a1 1 0 0 1 -.083 -1.32l.083 -.094l1.5 -1.5a1 1 0 0 1 .258 -.187l.098 -.042l3.796 -1.425l3.171 -3.17a1 1 0 0 1 1.497 -1.26z"/>',
  book2:
    '<path d="M19 4v16h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12z"/><path d="M19 16h-12a2 2 0 0 0 -2 2"/><path d="M9 8h6"/>',
  translate:
    '<path fill="currentColor" stroke="none" d="M5 15V17C5 18.0544 5.81588 18.9182 6.85074 18.9945L7 19H10V21H7C4.79086 21 3 19.2091 3 17V15H5ZM18 10L22.4 21H20.245L19.044 18H14.954L13.755 21H11.601L16 10H18ZM17 12.8852L15.753 16H18.245L17 12.8852ZM8 2V4H12V11H8V14H6V11H2V4H6V2H8ZM17 3C19.2091 3 21 4.79086 21 7V9H19V7C19 5.89543 18.1046 5 17 5H14V3H17ZM6 6H4V9H6V6ZM10 6H8V9H10V6Z"/>',
  sparkles:
    '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/>',
  copy: '<path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/>',
  check: '<path d="M5 12l5 5l10 -10"/>',
  x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  refresh:
    '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  volume:
    '<path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/>',
  typography:
    '<path d="M4 20l3 0"/><path d="M14 20l7 0"/><path d="M6.9 15l6.9 0"/><path d="M10.2 6.3l5.8 13.7"/><path d="M5 20l6 -16l2 0l7 16"/>',
  alert:
    '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  grip: '<path fill="currentColor" stroke="none" d="M5 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M11 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M17 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M5 15a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M11 15a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M17 15a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
} as const

const SAVE_LABELS = {
  idle: "保存到生词本",
  saving: "保存中...",
  saved: "✓ 已保存",
  error: "再试一次",
} as const

const root = document.getElementById("app") as HTMLElement
const canSpeak = "speechSynthesis" in window

let state: PopupState | null = null
let pinned = false
let sourceExpanded = false
let saveStatus: keyof typeof SAVE_LABELS = "idle"
let saveMessage = ""

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

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.classList.add("icon")
  svg.innerHTML = ICONS[name]
  return svg
}

function iconButton(
  name: keyof typeof ICONS,
  label: string,
  onClick: () => void,
  className = "icon-button",
): HTMLButtonElement {
  const node = el("button", className)
  node.type = "button"
  node.title = label
  node.setAttribute("aria-label", label)
  node.append(icon(name))
  node.addEventListener("click", onClick)
  return node
}

function textButton(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", className, text)
  node.type = "button"
  node.addEventListener("click", onClick)
  return node
}

/** 交给主进程读：优先用扩展的朗读设置（和网页同一个声音），不行再用系统语音 */
function speak(text: string) {
  window.dic.speak(text)
}

/*
 * 标题栏、内容区、底栏这三块只建一次，之后原地更新。
 * 大模型边写边出时每 150 毫秒就刷新一次；要是把按钮整个换掉，鼠标按下和松开会落在
 * 两个不同的按钮上，这一下点击就丢了——钉子怎么点都钉不上。
 */
const pinButton = iconButton("pin", "", () => {
  pinned = !pinned
  window.dic.setPinned(pinned)
  updatePinButton()
})

function updatePinButton() {
  const label = pinned ? "取消钉住" : "钉住（点别处也不会关）"
  pinButton.replaceChildren(icon(pinned ? "pinned" : "pin"))
  pinButton.title = label
  pinButton.setAttribute("aria-label", label)
  pinButton.setAttribute("aria-pressed", String(pinned))
  pinButton.classList.toggle("active", pinned)
}

/** 标题栏的图标和文字跟着点的是哪个按钮变（词典、翻译、自定义动作） */
const DEFAULT_HEADER: PopupHeader = { title: "词典", icon: "dictionary" }
const HEADER_ICONS = { dictionary: "book2", translate: "translate", action: "sparkles" } as const
const titleIcon = el("span", "title-icon")
const titleText = el("h2", "title-text", DEFAULT_HEADER.title)
let headerKey = ""

function updateHeader(header: PopupHeader) {
  const key = `${header.icon}:${header.title}`
  if (key === headerKey) {
    return
  }
  headerKey = key
  titleIcon.replaceChildren(icon(HEADER_ICONS[header.icon]))
  titleText.textContent = header.title
}

function buildHeader(): HTMLElement {
  const header = el("header", "header")
  const grip = el("div", "grip")
  grip.append(icon("grip"))
  const title = el("div", "title")
  title.append(titleIcon, titleText)
  const actions = el("div", "header-actions")
  actions.append(
    pinButton,
    iconButton("x", "关闭（Esc）", () => window.dic.close()),
  )
  header.append(grip, title, actions)

  // 按住标题栏空白处拖动：主程序跟着鼠标挪窗口。点在按钮上就是普通点击，不会拖
  const endDrag = () => {
    header.classList.remove("dragging")
    window.dic.dragEnd()
  }
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) {
      return
    }
    event.preventDefault()
    header.setPointerCapture(event.pointerId)
    header.classList.add("dragging")
    window.dic.dragStart()
  })
  header.addEventListener("pointerup", endDrag)
  header.addEventListener("pointercancel", endDrag)
  return header
}

function renderSource(text: string): HTMLElement[] {
  const row = el("div", "source")
  const paragraph = el("p", sourceExpanded ? "source-text expanded" : "source-text", text)
  paragraph.title = sourceExpanded ? "点一下收起" : "点一下展开"
  paragraph.addEventListener("click", () => {
    // 正在选文字时不要切换
    if (window.getSelection()?.toString()) {
      return
    }
    sourceExpanded = !sourceExpanded
    render()
  })
  row.append(paragraph)
  if (canSpeak) {
    row.append(iconButton("volume", "朗读原文", () => speak(text), "icon-button small"))
  }
  return [row, el("div", "separator")]
}

function statusLine(text: string): HTMLElement {
  const line = el("div", "status-line")
  line.append(el("span", "spinner"), el("span", undefined, text))
  return line
}

function renderFields(current: ResultState): HTMLElement {
  const list = el("div", "fields")
  for (const field of current.fields) {
    const row = el("div", "field")
    const label = el("div", "field-label")
    label.append(icon("typography"), el("span", undefined, field.label))
    if (field.speakable && canSpeak) {
      const button = iconButton(
        "volume",
        `朗读${field.label}`,
        () => speak(field.value),
        "icon-button small",
      )
      button.disabled = field.pending || !field.value
      label.append(button)
    }
    const value = el(
      "div",
      field.pending ? "field-value pending" : "field-value",
      field.pending ? "…" : field.value || "—",
    )
    row.append(label, value)
    list.append(row)
  }
  return list
}

/** 划词翻译：译文一段，写完后下面是复制、朗读（和扩展的翻译弹窗一样） */
function renderTranslation(current: TranslationState): HTMLElement[] {
  const parts: HTMLElement[] = []
  if (current.thinking) {
    parts.push(statusLine("模型正在思考…"))
  } else if (current.streaming && !current.translated) {
    parts.push(statusLine("正在翻译…"))
  }
  if (current.translated) {
    parts.push(
      el("p", current.streaming ? "translation streaming" : "translation", current.translated),
    )
    if (!current.streaming) {
      const tools = el("div", "translation-tools")
      const copyButton = iconButton(
        "copy",
        "复制译文",
        () => {
          window.dic.copy(current.translated)
          copyButton.replaceChildren(icon("check"))
          copyButton.title = "已复制"
          window.setTimeout(() => {
            copyButton.replaceChildren(icon("copy"))
            copyButton.title = "复制译文"
          }, 1500)
        },
        "icon-button small",
      )
      tools.append(copyButton)
      if (canSpeak) {
        tools.append(
          iconButton("volume", "朗读译文", () => speak(current.translated), "icon-button small"),
        )
      }
      parts.push(tools)
    }
  }
  return parts
}

function renderAlert(current: ErrorState): HTMLElement {
  const alert = el("div", "alert")
  const content = el("div")
  content.append(
    el("div", "alert-title", current.title),
    el("div", "alert-message", current.message),
  )
  alert.append(icon("alert"), content)
  return alert
}

/** 不是出错，只是告诉用户词已经记下了（浏览器没开时） */
function renderNotice(current: QueuedState): HTMLElement {
  const notice = el("div", "alert info")
  const content = el("div")
  content.append(
    el("div", "alert-title", current.title),
    el("div", "alert-message", current.message),
  )
  notice.append(icon("check"), content)
  return notice
}

function renderBody(current: PopupState): DocumentFragment {
  const body = document.createDocumentFragment()
  if (current.text) {
    body.append(...renderSource(current.text))
  }
  if (current.kind === "loading") {
    body.append(statusLine(current.thinking ? "模型正在思考…" : "正在查词…"))
  } else if (current.kind === "result") {
    if (current.thinking) {
      body.append(statusLine("模型正在思考…"))
    }
    body.append(renderFields(current))
  } else if (current.kind === "translation") {
    body.append(...renderTranslation(current))
  } else if (current.kind === "queued") {
    body.append(renderNotice(current))
  } else {
    body.append(renderAlert(current))
  }
  return body
}

function renderFooter(current: PopupState): DocumentFragment {
  const footer = document.createDocumentFragment()
  const lookupCount = current.kind === "result" ? (current.lookupCount ?? 0) : 0
  const meta = [
    current.source ? `来自 ${current.source}` : null,
    // 查了好几次的词最该记：写出来提醒一下（存过的词又查，扩展会把它提前到今天复习）
    lookupCount > 1
      ? `第 ${lookupCount} 次查${current.kind === "result" && current.reviewBumped ? "，已提前到今天复习" : ""}`
      : null,
    current.kind === "result" && current.fast ? "快速词典" : null,
    current.kind === "translation" && current.fast ? "翻译引擎" : null,
  ]
    .filter(Boolean)
    .join(" · ")
  footer.append(el("div", "meta", meta))

  const actions = el("div", "footer-actions")
  if (current.kind === "result") {
    if (saveStatus === "error") {
      const error = el("span", "save-error", saveMessage)
      error.title = saveMessage
      actions.append(error)
    }
    const save = textButton(
      saveStatus === "saved" ? "button brand saved" : "button brand",
      SAVE_LABELS[saveStatus],
      () => void saveResult(),
    )
    save.disabled = current.streaming || saveStatus === "saving" || saveStatus === "saved"
    save.title = current.streaming
      ? "等查完才能保存"
      : saveStatus === "saved"
        ? saveMessage
        : "Enter"
    actions.append(save)
  }
  if ((current.kind === "error" && !current.canRetry) || current.kind === "queued") {
    actions.append(textButton("button secondary", "关闭", () => window.dic.close()))
  } else {
    const regenerate = iconButton("refresh", current.kind === "error" ? "重试" : "重新生成", () =>
      window.dic.retry(),
    )
    regenerate.disabled = current.kind === "loading"
    actions.append(regenerate)
  }
  footer.append(actions)
  return footer
}

const bodySlot = el("div", "body")
const footerSlot = el("footer", "footer")
/** 底栏上次画的是什么；没变就不重画，按钮不会在鼠标底下被换掉 */
let footerKey = ""
const card = el("div", "card")
card.append(buildHeader(), bodySlot, footerSlot)
root.append(card)
updatePinButton()

function render() {
  if (!state) {
    return
  }
  updateHeader(state.header ?? DEFAULT_HEADER)
  // 内容区还是同一个元素，只换里面的东西：用户滚到哪就停在哪
  bodySlot.replaceChildren(renderBody(state))
  const nextFooterKey = JSON.stringify([
    state.kind,
    state.source,
    state.kind === "result" || state.kind === "translation" ? [state.streaming, state.fast] : null,
    state.kind === "error" ? state.canRetry : null,
    state.kind === "result" ? [state.lookupCount, state.reviewBumped] : null,
    saveStatus,
    saveMessage,
  ])
  if (nextFooterKey !== footerKey) {
    footerKey = nextFooterKey
    footerSlot.replaceChildren(renderFooter(state))
  }
  requestAnimationFrame(reportSize)
}

/** 告诉主进程内容有多高，窗口跟着变；超出上限时主进程会封顶，内容区自己滚动 */
function reportSize() {
  const card = root.firstElementChild
  if (!(card instanceof HTMLElement)) {
    return
  }
  let height = 2 // 上下边框
  for (const child of Array.from(card.children)) {
    if (child instanceof HTMLElement) {
      height += child.classList.contains("body") ? child.scrollHeight : child.offsetHeight
    }
  }
  window.dic.resize(height)
}

async function saveResult() {
  if (
    state?.kind !== "result" ||
    state.streaming ||
    saveStatus === "saving" ||
    saveStatus === "saved"
  ) {
    return
  }
  saveStatus = "saving"
  render()
  const outcome = await window.dic.save()
  saveStatus = outcome.ok ? "saved" : "error"
  saveMessage = outcome.message
  render()
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault()
    window.dic.close()
  } else if (event.key === "Enter" && state?.kind === "result") {
    event.preventDefault()
    void saveResult()
  }
})

window.dic.onPinned((next) => {
  pinned = next
  updatePinButton()
})

window.dic.onState((next) => {
  const isNewLookup = state?.text !== next.text || next.kind !== "result" || !state
  // 同一个词还在写（进度更新）时，保存按钮、展开状态都不重置
  if (isNewLookup || (state?.kind === "result" && !state.streaming)) {
    saveStatus = "idle"
    saveMessage = ""
  }
  if (state?.text !== next.text) {
    sourceExpanded = false
  }
  state = next
  render()
})
