// Edge TTS：微软神经语音引擎（浏览器直连 WebSocket，无需中转服务器）
// 服务端只校验 User-Agent 必须是 Edge 系浏览器（实测不校验网页 Origin），
// 所以手机上用 Edge 浏览器打开即可免费使用，其他浏览器返回不可用由上层降级

import type { LangCode } from './tts'

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const GEC_VERSION = '1-143.0.3650.96'
const WSS_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
const CONNECT_TIMEOUT = 10000
const SYNTH_TIMEOUT = 15000

export const EDGE_VOICES: Record<LangCode, { f: string; m: string }> = {
  ko: { f: 'ko-KR-SunHiNeural', m: 'ko-KR-InJoonNeural' },
  ja: { f: 'ja-JP-NanamiNeural', m: 'ja-JP-KeitaNeural' },
  en: { f: 'en-US-AvaNeural', m: 'en-US-AndrewNeural' },
  zh: { f: 'zh-CN-XiaoxiaoNeural', m: 'zh-CN-YunxiNeural' },
}

/** 服务端校验 UA 必须是 Edge 系（桌面 Edg/、安卓 EdgA/、iOS EdgiOS/） */
export function edgeTtsUsable(): boolean {
  if (typeof navigator === 'undefined' || typeof WebSocket === 'undefined') return false
  return /Edg(A|iOS)?\//.test(navigator.userAgent)
}

/** 纯 JS SHA-256（ASCII 输入）：http://局域网 页面没有 crypto.subtle 时兜底 */
function sha256Hex(ascii: string): string {
  const rightRotate = (v: number, a: number) => (v >>> a) | (v << (32 - a))
  const maxWord = Math.pow(2, 32)
  const words: number[] = []
  const bitLen = ascii.length * 8

  // 初始哈希 = 前 8 个素数平方根的小数部分；轮常量 = 前 64 个素数立方根的小数部分
  const hash: number[] = []
  const k: number[] = []
  const isComposite: Record<number, boolean> = {}
  for (let candidate = 2; k.length < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = candidate * candidate; i < 313; i += candidate) isComposite[i] = true
      hash[k.length] = (Math.sqrt(candidate) * maxWord) | 0
      k.push((Math.cbrt(candidate) * maxWord) | 0)
    }
  }

  let msg = ascii + '\x80'
  while (msg.length % 64 !== 56) msg += '\x00'
  for (let i = 0; i < msg.length; i++) {
    const j = msg.charCodeAt(i)
    if (j >> 8) throw new Error('sha256Hex 只支持 ASCII 输入')
    words[i >> 2] |= j << (((3 - i) % 4) * 8)
  }
  words[words.length] = (bitLen / maxWord) | 0
  words[words.length] = bitLen

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16))
    const oldHash = hash.slice(0, 8)
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15]
      const w2 = w[i - 2]
      const a = hash[0]
      const e = hash[4]
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0)
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
      hash.unshift((temp1 + temp2) | 0)
      hash.pop()
      hash[4] = (hash[4] + temp1) | 0
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0
  }

  let result = ''
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255
      result += (b < 16 ? '0' : '') + b.toString(16)
    }
  }
  return result
}

/** Sec-MS-GEC 反滥用令牌：5 分钟窗口的 Windows ticks + token 的 SHA-256（标准算法） */
async function secMsGec(): Promise<string> {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600
  const winTicks = (ticks - (ticks % 300)) * 10000000
  const input = `${winTicks}${TOKEN}`
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  return sha256Hex(input).toUpperCase()
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  // http 页面没有 crypto.randomUUID，退化为随机 hex
  let s = ''
  for (let i = 0; i < 32; i++) s += ((Math.random() * 16) | 0).toString(16)
  return s
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---------- 连接管理：单条 WebSocket 复用，请求串行 ----------

let socket: WebSocket | null = null
let connecting: Promise<WebSocket> | null = null
let stopped = false
let activeReject: ((e: Error) => void) | null = null

function openSocket(): Promise<WebSocket> {
  return (async () => {
    const gec = await secMsGec()
    const url =
      `${WSS_URL}?Ocp-Apim-Subscription-Key=${TOKEN}` +
      `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${requestId()}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('edge tts connect timeout'))
      }, CONNECT_TIMEOUT)
      ws.onopen = () => {
        clearTimeout(timer)
        ws.send(
          'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
            JSON.stringify({
              context: {
                synthesis: {
                  audio: {
                    metadataoptions: {
                      sentenceBoundaryEnabled: 'false',
                      wordBoundaryEnabled: 'false',
                    },
                    outputFormat: OUTPUT_FORMAT,
                  },
                },
              },
            }),
        )
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('edge tts connect failed'))
      }
      ws.onclose = () => {
        clearTimeout(timer)
        reject(new Error('edge tts closed during connect'))
      }
    })
    // 建立成功后的常驻事件：断线时清理状态并中断进行中的合成
    ws.onclose = () => {
      if (socket === ws) {
        socket = null
        connecting = null
      }
      activeReject?.(new Error('edge tts connection closed'))
    }
    ws.onerror = null
    return ws
  })()
}

async function connect(): Promise<WebSocket> {
  for (;;) {
    if (socket && socket.readyState === WebSocket.OPEN) return socket
    if (!connecting) {
      connecting = openSocket().then((ws) => {
        socket = ws
        return ws
      })
    }
    try {
      const ws = await connecting
      if (ws.readyState === WebSocket.OPEN) return ws
      // 建立后立刻又断了，清理后重试
      connecting = null
      socket = null
    } catch (e) {
      connecting = null
      socket = null
      throw e
    }
  }
}

// ---------- 合成 ----------

function synthesize(text: string, lang: LangCode, gender: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const reqId = requestId()
    const chunks: ArrayBuffer[] = []
    let ws: WebSocket | null = null
    let settled = false

    const finish = (err: Error | null, blob?: Blob) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (activeReject === onAbort) activeReject = null
      ws?.removeEventListener('message', onMessage)
      if (err) reject(err)
      else resolve(blob as Blob)
    }
    const onAbort = (e: Error) => finish(e)
    const timer = setTimeout(() => finish(new Error('edge tts synth timeout')), SYNTH_TIMEOUT)

    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.end') && ev.data.includes(reqId)) {
          const blob = new Blob(chunks, { type: 'audio/mpeg' })
          finish(
            blob.size > 100 ? null : new Error('edge tts empty audio'),
            blob,
          )
        }
        return
      }
      const buf = new Uint8Array(ev.data as ArrayBuffer)
      const headerLen = (buf[0] << 8) | buf[1]
      const header = new TextDecoder().decode(buf.subarray(2, 2 + headerLen))
      if (!header.includes('Path:audio') || !header.includes(reqId)) return
      const audio = buf.subarray(2 + headerLen)
      if (audio.length > 0) {
        chunks.push(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.length))
      }
    }

    connect().then(
      (s) => {
        if (settled) return
        ws = s
        activeReject = onAbort
        ws.addEventListener('message', onMessage)
        const voice = EDGE_VOICES[lang][gender === 'm' ? 'm' : 'f']
        const ssml =
          `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.slice(0, 5)}">` +
          `<voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">` +
          `${escapeXml(text)}</prosody></voice></speak>`
        ws.send(
          `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`,
        )
      },
      (e) => finish(e as Error),
    )
  })
}

/** 请求串行队列：连播场景下逐条合成，避免争抢同一条连接 */
let queue: Promise<unknown> = Promise.resolve()

/** 合成一段文字为 mp3 Blob（抛错时由上层降级到其他引擎） */
export function edgeTtsSpeak(text: string, lang: LangCode, gender: string): Promise<Blob> {
  const run = queue.then(() =>
    stopped ? Promise.reject(new Error('stopped')) : synthesize(text, lang, gender),
  )
  queue = run.catch(() => undefined)
  return run
}

/** 停止播放：中断进行中的合成并断开连接（下次播放自动重连） */
export function stopEdgeTts() {
  stopped = true
  activeReject?.(new Error('stopped'))
  activeReject = null
  const s = socket
  socket = null
  connecting = null
  try {
    s?.close()
  } catch {
    /* ignore */
  }
}

/** 新一轮朗读前复位停止标记 */
export function resetEdgeTts() {
  stopped = false
}
