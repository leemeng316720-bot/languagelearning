import { useEffect, useState } from 'react'

/** 获取系统可用的朗读语音列表（浏览器异步加载，需要监听 voiceschanged） */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    // 部分浏览器首次调用为空，兜底轮询一次
    const timer = setTimeout(load, 500)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
      clearTimeout(timer)
    }
  }, [])

  return voices
}
