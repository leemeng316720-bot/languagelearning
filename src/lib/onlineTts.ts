// 在线语音引擎：Edge 神经语音（Edge 系浏览器直连，无需中转）→ 本地代理（Naver 整句 + 百度/有道兜底，带离线缓存）
// 静态托管无代理且非 Edge 浏览器时，直连百度翻译发音接口（页面已设 no-referrer，可跨域播放，无缓存）

import type { LangCode } from './tts'
import { edgeTtsSpeak, edgeTtsUsable, resetEdgeTts, stopEdgeTts } from './edgeTts'

// 百度翻译发音接口的语言代码
const BAIDU_LAN: Record<LangCode, string> = { ko: 'kor', en: 'en', ja: 'jp', zh: 'zh' }

function directUrl(text: string, lang: LangCode): string {
  return `https://fanyi.baidu.com/gettts?lan=${BAIDU_LAN[lang]}&text=${encodeURIComponent(text)}&spd=3&source=web`
}

function proxyUrl(text: string, lang: LangCode, gender: string): string {
  return `/api/tts?text=${encodeURIComponent(text)}&le=${lang}&gender=${gender}`
}

// ---------- IndexedDB 音频缓存 ----------

const DB_NAME = 'moerduo-audio'
const STORE = 'clips'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

async function idbGet(key: string): Promise<Blob | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => resolve(null)
  })
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function audioCacheCount(): Promise<number> {
  const db = await openDb()
  if (!db) return 0
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(0)
  })
}

export async function clearAudioCache(): Promise<void> {
  // 先清内存里的 objectURL
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// ---------- 播放 ----------

let stopFlag = false
let curAudio: HTMLAudioElement | null = null
let settle: ((ok: boolean) => void) | null = null
let curFetch: AbortController | null = null
/** 代理是否可用（页面不从本地服务器打开时不可用） */
let proxyDown = false
/** Edge TTS 是否可用（UA 是 Edge 系且接口未被封） */
let edgeOk = edgeTtsUsable()
/** 已生成的 objectURL，避免重复创建 */
const urlCache = new Map<string, string>()

export function stopOnlineSpeaking() {
  stopFlag = true
  stopEdgeTts()
  try {
    curFetch?.abort()
  } catch {
    /* ignore */
  }
  curFetch = null
  if (curAudio) {
    try {
      curAudio.pause()
    } catch {
      /* ignore */
    }
    curAudio = null
  }
  settle?.(true)
  settle = null
}

/**
 * 获取一段文字的可播放地址：
 * 本机缓存 → Edge 神经语音（Edge 系浏览器，合成结果写入缓存）→ 本地代理下载（并写入缓存）→ 直连（无缓存）
 * 返回 null 表示这段文字拿不到发音（触发上层逐词降级）
 */
async function getPlayableUrl(text: string, lang: LangCode, gender: string): Promise<string | null> {
  const key = `${lang}:${gender}:${text}`
  const hit = urlCache.get(key)
  if (hit) return hit

  const cached = await idbGet(key)
  if (cached) {
    const url = URL.createObjectURL(cached)
    urlCache.set(key, url)
    return url
  }

  // Edge 神经语音：音质最佳，浏览器直连 WebSocket，无需中转
  if (edgeOk && !stopFlag) {
    try {
      const blob = await edgeTtsSpeak(text, lang, gender)
      if (stopFlag) return null
      const url = URL.createObjectURL(blob)
      urlCache.set(key, url)
      void idbPut(key, blob) // 后台落盘，离线也能播
      return url
    } catch {
      if (stopFlag) return null
      edgeOk = false // 网络不通或接口变动，本次会话降级
    }
  }

  if (!proxyDown) {
    const ctrl = new AbortController()
    curFetch = ctrl
    try {
      const res = await fetch(proxyUrl(text, lang, gender), { signal: ctrl.signal })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.startsWith('audio/')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        urlCache.set(key, url)
        void idbPut(key, blob) // 后台落盘，不阻塞播放
        return url
      }
      if (res.status === 502) return null // 上游确实没有这段发音
      proxyDown = true // 代理不存在（静态部署等情况）
    } catch {
      if (stopFlag) return null
      // 网络错误或代理不存在，降级直连
      proxyDown = true
    } finally {
      if (curFetch === ctrl) curFetch = null
    }
  }

  // 直连模式：地址交给 <audio>，失败由 onerror 捕获
  return directUrl(text, lang)
}

/** 播放一个音频地址；resolve(true)=正常播完或被停止，resolve(false)=加载失败 */
function playClip(url: string, rate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio()
    curAudio = audio
    audio.preload = 'auto'
    audio.playbackRate = rate
    settle = (ok) => {
      settle = null
      resolve(ok)
    }
    audio.onended = () => {
      if (curAudio === audio) curAudio = null
      settle = null
      resolve(true)
    }
    audio.onerror = () => {
      if (curAudio === audio) curAudio = null
      settle = null
      resolve(false)
    }
    audio.src = url
    audio.play().catch(() => {
      if (curAudio === audio) curAudio = null
      settle = null
      resolve(false)
    })
  })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 去掉词首尾标点（「아니,」「그래?」这类词直接查发音会失败） */
function cleanWord(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

// 常见韩语助词/词尾，长在前（逐词降级失败时剥掉再试一次）
const KO_PARTICLES = [
  '으로써', '부터', '까지', '에서', '으로', '하고', '이나', '처럼', '보다',
  '에게', '한테', '이랑', '이야', '조차', '마저', '밖에', '이라',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '만',
  '와', '과', '로', '나', '야', '랑', '아', '여',
].sort((a, b) => b.length - a.length)

function stripKoParticle(w: string): string {
  for (const p of KO_PARTICLES) {
    if (w.length > p.length + 1 && w.endsWith(p)) return w.slice(0, -p.length)
  }
  return w
}

/** 播放一段文字（内部处理缓存与降级），返回是否成功出声 */
async function speakSegment(
  text: string,
  opts: { lang: LangCode; rate: number; gender: string },
): Promise<boolean> {
  const url = await getPlayableUrl(text, opts.lang, opts.gender)
  if (stopFlag || !url) return false
  const direct = url.startsWith('http')
  const ok = await playClip(url, opts.rate)
  if (ok || !direct) return ok
  return false
}

/**
 * 在线朗读（Edge 神经语音优先，其次代理内 Naver 整句 / 百度直连）。
 * 整段失败时自动降级为逐词朗读；韩语单词失败会剥词尾助词再试；
 * 连单个词都失败则抛错，由上层回退到系统语音。
 */
export async function speakOnline(
  text: string,
  opts: { lang: LangCode; rate: number; gender: string },
): Promise<void> {
  stopFlag = false
  resetEdgeTts()
  const ok = await speakSegment(text, opts)
  if (stopFlag || ok) return
  const words = text
    .split(/\s+/)
    .map(cleanWord)
    .filter(Boolean)
  if (words.length === 0) throw new Error('online tts unavailable')
  if (words.length === 1) {
    // 唯一一个词失败：韩语试剥助词，否则抛错回退系统语音
    if (opts.lang === 'ko') {
      const stem = stripKoParticle(words[0])
      if (stem !== words[0] && (await speakSegment(stem, opts))) return
    }
    throw new Error('online tts unavailable')
  }
  for (const w of words) {
    if (stopFlag) return
    let wordOk = await speakSegment(w, opts)
    if (stopFlag) return
    if (!wordOk && opts.lang === 'ko') {
      const stem = stripKoParticle(w)
      if (stem !== w) wordOk = await speakSegment(stem, opts)
      if (stopFlag) return
    }
    await sleep(wordOk ? 120 : 100)
  }
}
