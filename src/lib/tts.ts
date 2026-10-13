// 语音朗读与语言识别工具

import { speakOnline, stopOnlineSpeaking } from './onlineTts'

export type LangCode = 'ko' | 'en' | 'ja' | 'zh'

/** 朗读引擎：自动（有系统语音用系统，没有用在线）/ 强制系统 / 强制在线 */
export type Engine = 'auto' | 'system' | 'online'

export const LANGS: { code: LangCode; name: string; bcp: string; flag: string }[] = [
  { code: 'ko', name: '韩语', bcp: 'ko-KR', flag: '🇰🇷' },
  { code: 'en', name: '英语', bcp: 'en-US', flag: '🇺🇸' },
  { code: 'ja', name: '日语', bcp: 'ja-JP', flag: '🇯🇵' },
  { code: 'zh', name: '中文', bcp: 'zh-CN', flag: '🇨🇳' },
]

export function langInfo(code: LangCode) {
  return LANGS.find((l) => l.code === code) ?? LANGS[0]
}

const SCRIPT_RE: Record<LangCode, RegExp> = {
  // 韩文音节 + 韩文字母
  ko: /[ᄀ-ᇿ가-힯ꥠ-꥿]/,
  // 日文假名
  ja: /[぀-ゟ゠-ヿ]/,
  // 汉字
  zh: /[一-鿿]/,
  // 拉丁字母
  en: /[A-Za-z]/,
}

/**
 * 自动识别语言。
 * 外文优先，中文兜底：只要出现韩文/假名/拉丁字母，就判定为对应外语，
 * 纯汉字才判为中文（混排条目如「사과 · 苹果」判为韩语）。
 */
export function detectLang(text: string): LangCode {
  if (SCRIPT_RE.ko.test(text)) return 'ko'
  if (SCRIPT_RE.ja.test(text)) return 'ja'
  if (SCRIPT_RE.en.test(text)) return 'en'
  if (SCRIPT_RE.zh.test(text)) return 'zh'
  return 'en'
}

// 常见分隔符：中外对照的词条一般用它隔开
const SEP_RE = /[·•＝=~～\-—–_|/、，,。.;；:：!?！？（）()【】[\]「」『』"']+/

/**
 * 从条目中提取要朗读的部分：
 * - 韩语 / 英语条目：剥掉汉字与中文标点，只读外文（「사과 · 苹果」只读 사과）
 * - 日语条目：汉字是日语的一部分不能剥；有分隔符时取第一个含假名的片段
 * - 中文条目：原样读
 */
export function extractSpeakText(text: string, lang: LangCode): string {
  if (lang === 'zh') return text
  if (lang === 'ko' || lang === 'en') {
    const stripped = text
      .replace(/[一-鿿　-〿＀-￯]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return stripped || text
  }
  // ja
  const segs = text.split(SEP_RE).map((s) => s.trim()).filter(Boolean)
  if (segs.length > 1) {
    const withKana = segs.find((s) => SCRIPT_RE.ja.test(s))
    return withKana ?? segs[0]
  }
  return text
}

/** 为指定语言挑选语音：优先用户指定的，其次系统里语言匹配的 */
export function pickVoice(lang: LangCode, voiceURI?: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (voiceURI && voiceURI !== 'auto') {
    const v = voices.find((x) => x.voiceURI === voiceURI)
    if (v) return v
  }
  const norm = (s: string) => s.toLowerCase().replace('_', '-')
  const matches = voices.filter((v) => norm(v.lang).startsWith(lang))
  if (matches.length === 0) return null
  if (lang === 'zh') {
    // 中文语音很多，优先大陆普通话
    return (
      matches.find((v) => norm(v.lang).startsWith('zh-cn')) ??
      matches.find((v) => v.default) ??
      matches[0]
    )
  }
  return matches.find((v) => v.default) ?? matches[0]
}

/** 朗读一条文本，返回 Promise（结束或被打断时 resolve） */
export function speakAsync(
  text: string,
  opts: { lang: LangCode; rate: number; voiceURI?: string },
): Promise<void> {
  return new Promise((resolve) => {
    const speakText = extractSpeakText(text, opts.lang)
    const utter = new SpeechSynthesisUtterance(speakText)
    utter.lang = langInfo(opts.lang).bcp
    utter.rate = opts.rate
    const voice = pickVoice(opts.lang, opts.voiceURI)
    if (voice) {
      utter.voice = voice
      utter.lang = voice.lang
    }
    utter.onend = () => resolve()
    utter.onerror = () => resolve()
    window.speechSynthesis.speak(utter)
  })
}

/** 智能朗读：按引擎设置选择系统语音或在线语音，失败自动回退 */
export async function speakSmart(
  text: string,
  opts: { lang: LangCode; rate: number; engine: Engine; voiceURI?: string; gender?: string },
): Promise<void> {
  const hasSystemVoice = pickVoice(opts.lang, opts.voiceURI) !== null
  const preferOnline =
    opts.engine === 'online' || (opts.engine === 'auto' && !hasSystemVoice)
  if (preferOnline) {
    try {
      await speakOnline(extractSpeakText(text, opts.lang), {
        lang: opts.lang,
        rate: opts.rate,
        gender: opts.gender ?? 'f',
      })
      return
    } catch {
      // 在线失败，回退系统语音
    }
  }
  return speakAsync(text, opts)
}

export function stopSpeaking() {
  window.speechSynthesis.cancel()
  stopOnlineSpeaking()
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
