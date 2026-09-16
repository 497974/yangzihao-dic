/**
 * 小提示窗的页面：主进程用 executeJavaScript 调 window.setToast(状态)，返回内容需要的高度。
 * 文字一律用 textContent 放进页面。
 *
 * 整个包在一个块里：它和 popup.ts 同属一个编译单元（都是普通脚本），不包起来变量会撞名。
 */
{
  const box = document.getElementById("toast") as HTMLElement

  window.setToast = (state) => {
    box.className = `toast ${state.kind}`
    const parts: HTMLElement[] = []
    if (state.kind === "working") {
      const spinner = document.createElement("span")
      spinner.className = "spinner"
      parts.push(spinner)
    }
    const text = document.createElement("div")
    text.className = "text"
    const title = document.createElement("div")
    title.className = "title"
    title.textContent = state.title
    text.append(title)
    if (state.message) {
      const message = document.createElement("div")
      message.className = "message"
      message.textContent = state.message
      text.append(message)
    }
    parts.push(text)
    box.replaceChildren(...parts)
    // min-height: 100vh 会让量出来的高度永远等于窗口高度，量之前先去掉
    box.style.minHeight = "0"
    const height = Math.ceil(box.getBoundingClientRect().height)
    box.style.minHeight = ""
    return height
  }
}
