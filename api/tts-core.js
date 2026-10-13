// TTS 代理核心逻辑（纯 Web API，Node 与 Edge 运行时通用）
// Naver Clova 整句优先，有道词典词条兜底

const NAVER = 'https://dict.naver.com/api/nvoice'
const YOUDAO = 'https://dict.youdao.com/dictvoice'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

const NAVER_SPEAKERS = {
  ko: { f: 'kyuri', m: 'jinho' },
  ja: { f: 'yuri', m: 'shinji' },
  en: { f: 'danna', m: 'matt' },
  zh: { f: 'meimei', m: 'liangliang' },
}

const NAVER_MAX_CHARS = 100

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text]
  const parts = text.split(/(?<=[。！？!?；;.，,、\n])|(?<=\s)/)
  const out = []
  let cur = ''
  for (const p of parts) {
    if (cur && (cur + p).length > maxLen) {
      out.push(cur)
      cur = p
    } else {
      cur += p
    }
    while (cur.length > maxLen) {
      out.push(cur.slice(0, maxLen))
      cur = cur.slice(maxLen)
    }
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** 剥掉 MP3 的 ID3v2 头，便于拼接多段音频帧 */
function stripId3(buf) {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f)
    return buf.subarray(10 + size)
  }
  return buf
}

function concatBytes(arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) {
    out.set(a, off)
    off += a.length
  }
  return out
}

async function fetchNaver(text, le, gender) {
  const speaker = NAVER_SPEAKERS[le]?.[gender] ?? NAVER_SPEAKERS[le]?.f
  if (!speaker) return null
  try {
    const bufs = []
    for (const part of chunkText(text, NAVER_MAX_CHARS)) {
      const url = `${NAVER}?service=dictionary&speech_fmt=mp3&speaker=${speaker}&speed=0&text=${encodeURIComponent(part)}`
      const res = await fetch(url, {
        headers: { Referer: 'https://papago.naver.com/', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) return null
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.length < 500) return null
      bufs.push(bufs.length === 0 ? buf : stripId3(buf))
    }
    return concatBytes(bufs)
  } catch {
    return null
  }
}

async function fetchYoudao(text, le) {
  try {
    const res = await fetch(
      `${YOUDAO}?audio=${encodeURIComponent(text)}&le=${le}`,
      { signal: AbortSignal.timeout(12000) },
    )
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length < 500 ? null : buf
  } catch {
    return null
  }
}

/** 返回 MP3 字节；拿不到返回 null */
export async function getTtsAudio(text, le, gender) {
  return (await fetchNaver(text, le, gender)) ?? (await fetchYoudao(text, le))
}

export function parseTtsParams(requestUrl) {
  const url = new URL(requestUrl)
  const text = url.searchParams.get('text')?.slice(0, 1000)
  const le = url.searchParams.get('le')
  const gender = url.searchParams.get('gender') === 'm' ? 'm' : 'f'
  if (!text || !le || !/^(ko|en|ja|zh)$/.test(le)) return null
  return { text, le, gender }
}
