/**
 * 对话练习的语音输入：浏览器自带的语音识别（Web Speech API）。
 *
 * 不花钱、不用配置，但它依赖浏览器厂商的在线识别服务——在部分网络环境下连不上。
 * 所以这里一定要把失败原因如实告诉用户，而不是按了没反应；文字输入始终可用。
 */

import { useCallback, useEffect, useRef, useState } from "react"

/** lib.dom 没有收录语音识别的类型，只声明这里用到的部分 */
interface RecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

interface RecognitionErrorEvent {
  error: string
}

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecognitionConstructor = new () => Recognition

function getRecognitionConstructor(): RecognitionConstructor | null {
  const scope = globalThis as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** 识别出错的原因 → 给用户看的说明 */
export function describeSpeechError(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "未获得麦克风权限。请在浏览器地址栏左侧的站点设置中允许使用麦克风。"
    case "network":
      return "无法连接语音识别服务。该功能依赖浏览器自带的在线识别服务，部分网络环境下不可用，请改用文字输入。"
    case "no-speech":
      return "没有检测到说话声，请靠近麦克风再试一次。"
    case "audio-capture":
      return "没有找到可用的麦克风。"
    default:
      return "语音识别失败，请改用文字输入。"
  }
}

export function useSpeechInput(onFinalText: (text: string) => void) {
  const supported = getRecognitionConstructor() !== null
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState("")
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<Recognition | null>(null)
  const onFinalRef = useRef(onFinalText)
  onFinalRef.current = onFinalText

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Constructor = getRecognitionConstructor()
    if (!Constructor) {
      return
    }
    recognitionRef.current?.abort()
    const recognition = new Constructor()
    recognition.lang = "en-US"
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      let finalText = ""
      let interimText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      setInterim(interimText)
      if (finalText.trim()) {
        onFinalRef.current(finalText.trim())
      }
    }
    recognition.onerror = (event) => {
      // 用户主动停止会触发 aborted，不算出错
      if (event.error !== "aborted") {
        setError(describeSpeechError(event.error))
      }
    }
    recognition.onend = () => {
      setListening(false)
      setInterim("")
    }
    recognitionRef.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }, [])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) }
}
