/**
 * 划词工具栏页面：一排按钮（翻译、朗读、词典、其它动作）+ 关闭。
 * 图标和扩展网页工具栏一样用 Iconify 的名字；这里内置了扩展自带动作用到的几个，
 * 用户自己挑的其它图标显示成名字的第一个字。
 *
 * 整个包在一个块里：它和 popup.ts、toast.ts 同属一个编译单元（都是普通脚本），不包起来变量会撞名。
 */
{
  type ToolbarButton = import("../shared/popup-api").ToolbarButton

  /** 描边图标（Tabler） */
  const STROKE_ICONS: Record<string, string> = {
    "tabler:book-2":
      '<path d="M19 4v16h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12z"/><path d="M19 16h-12a2 2 0 0 0 -2 2"/><path d="M9 8h6"/>',
    "tabler:book":
      '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>',
    "tabler:pencil-check":
      '<path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/><path d="M15 19l2 2l4 -4"/>',
    "tabler:sparkles":
      '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/>',
    "tabler:volume":
      '<path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/>',
    "tabler:x": '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  }
  /** 填充图标（Remix） */
  const FILL_ICONS: Record<string, string> = {
    "ri:translate":
      '<path d="M5 15V17C5 18.0544 5.81588 18.9182 6.85074 18.9945L7 19H10V21H7C4.79086 21 3 19.2091 3 17V15H5ZM18 10L22.4 21H20.245L19.044 18H14.954L13.755 21H11.601L16 10H18ZM17 12.8852L15.753 16H18.245L17 12.8852ZM8 2V4H12V11H8V14H6V11H2V4H6V2H8ZM17 3C19.2091 3 21 4.79086 21 7V9H19V7C19 5.89543 18.1046 5 17 5H14V3H17ZM6 6H4V9H6V6ZM10 6H8V9H10V6Z"/>',
  }

  function iconFor(name: string, fallbackLetter: string): Element {
    const stroke = STROKE_ICONS[name]
    const fill = FILL_ICONS[name]
    if (!stroke && !fill) {
      const letter = document.createElement("span")
      letter.className = "letter"
      letter.textContent = fallbackLetter
      return letter
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    if (stroke) {
      svg.setAttribute("fill", "none")
      svg.setAttribute("stroke", "currentColor")
      svg.setAttribute("stroke-width", "1.8")
      svg.setAttribute("stroke-linecap", "round")
      svg.setAttribute("stroke-linejoin", "round")
      svg.innerHTML = stroke
    } else {
      svg.setAttribute("fill", "currentColor")
      svg.innerHTML = fill ?? ""
    }
    return svg
  }

  type ToolbarAudio = import("../shared/popup-api").ToolbarAudio

  /** 正在放的扩展音频；新的朗读一来就停掉旧的 */
  let playing: HTMLAudioElement | null = null

  function stopSpeaking() {
    speechSynthesis.cancel()
    playing?.pause()
    playing = null
  }

  /** 放扩展按朗读设置合成好的音频（和网页上同一个声音）；放不出来就用系统语音读 */
  function playAudio(audio: ToolbarAudio) {
    stopSpeaking()
    const element = new Audio(`data:${audio.contentType};base64,${audio.audioBase64}`)
    playing = element
    element.play().catch(() => {
      if (playing === element) {
        speakText(audio.fallbackText)
      }
    })
  }

  function speakText(text: string) {
    stopSpeaking()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = /[㐀-鿿]/.test(text) ? "zh-CN" : "en-US"
    const prefix = utterance.lang.slice(0, 2)
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix))
    if (voice) {
      utterance.voice = voice
    }
    speechSynthesis.speak(utterance)
  }

  const bar = document.getElementById("bar") as HTMLElement

  function render(buttons: ToolbarButton[]) {
    const nodes: Element[] = buttons.map((button, index) => {
      const node = document.createElement("button")
      node.type = "button"
      node.title = button.name
      node.setAttribute("aria-label", button.name)
      node.append(iconFor(button.icon, button.name.slice(0, 1)))
      node.addEventListener("click", () => window.dicToolbar.click(index))
      return node
    })
    const divider = document.createElement("span")
    divider.className = "divider"
    const close = document.createElement("button")
    close.type = "button"
    close.className = "close"
    close.title = "关闭"
    close.setAttribute("aria-label", "关闭")
    close.append(iconFor("tabler:x", "×"))
    close.addEventListener("click", () => window.dicToolbar.close())
    bar.replaceChildren(...nodes, divider, close)
    requestAnimationFrame(() => {
      const rect = bar.getBoundingClientRect()
      window.dicToolbar.resize(rect.width, rect.height)
    })
  }

  bar.addEventListener("mouseenter", () => window.dicToolbar.hover(true))
  bar.addEventListener("mouseleave", () => window.dicToolbar.hover(false))
  window.dicToolbar.onButtons(render)
  window.dicToolbar.onSpeak(speakText)
  window.dicToolbar.onPlayAudio(playAudio)
}
