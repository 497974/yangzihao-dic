/**
 * 截图查词的框选页面：背景是冻住的屏幕画面，按住鼠标拖出一个框，松开就把框交给主进程去认字。
 * Esc、右键取消。
 *
 * 整个包在一个块里：它和 popup.ts、toolbar.ts 同属一个编译单元（都是普通脚本），不包起来变量会撞名。
 */
{
  type CaptureRect = import("../shared/popup-api").CaptureRect

  /** 框得比这还小就当是手抖，不算（和主进程的 MIN_SELECTION_DIP 一致） */
  const MIN_SIZE = 4

  const shot = document.getElementById("shot") as HTMLElement
  const dim = document.getElementById("dim") as HTMLElement
  const selection = document.getElementById("selection") as HTMLElement
  const sizeLabel = document.getElementById("size") as HTMLElement
  const hint = document.getElementById("hint") as HTMLElement

  let start: { x: number; y: number } | null = null

  function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): CaptureRect {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    }
  }

  function draw(rect: CaptureRect) {
    selection.hidden = false
    dim.hidden = true
    selection.style.left = `${rect.x}px`
    selection.style.top = `${rect.y}px`
    selection.style.width = `${rect.width}px`
    selection.style.height = `${rect.height}px`
    sizeLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
  }

  function reset() {
    start = null
    selection.hidden = true
    dim.hidden = false
    hint.hidden = false
  }

  window.dicCapture.onScreenshot((dataUrl) => {
    shot.style.backgroundImage = `url("${dataUrl}")`
  })

  document.addEventListener("pointerdown", (event) => {
    if (event.button === 2) {
      window.dicCapture.cancel()
      return
    }
    if (event.button !== 0) {
      return
    }
    start = { x: event.clientX, y: event.clientY }
    hint.hidden = true
    // 拖出窗口边缘也继续跟着鼠标；个别情况下拿不到指针也不影响框选
    try {
      document.documentElement.setPointerCapture(event.pointerId)
    } catch {
      // 忽略
    }
  })

  document.addEventListener("pointermove", (event) => {
    if (start) {
      draw(rectBetween(start, { x: event.clientX, y: event.clientY }))
    }
  })

  document.addEventListener("pointerup", (event) => {
    if (!start || event.button !== 0) {
      return
    }
    const rect = rectBetween(start, { x: event.clientX, y: event.clientY })
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      reset()
      return
    }
    start = null
    window.dicCapture.done(rect)
  })

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault()
    window.dicCapture.cancel()
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      window.dicCapture.cancel()
    }
  })
}
