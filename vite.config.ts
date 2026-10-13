import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import type { IncomingMessage, ServerResponse } from "http"

// 发音接口不允许网页跨域下载音频，这里加一层同源代理：
// 前端从同源地址拿音频，存进 IndexedDB 本机缓存，读过的内容离线也能播
//
// 优先 Naver Clova（整句自然发音，需 Referer 头所以必须走代理），
// 失败后回退有道词典发音（词条级），再失败返回 502 让前端逐词降级

const NAVER = "https://dict.naver.com/api/nvoice"
const YOUDAO = "https://dict.youdao.com/dictvoice"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

const NAVER_SPEAKERS: Record<string, Record<string, string>> = {
  ko: { f: "kyuri", m: "jinho" },
  ja: { f: "yuri", m: "shinji" },
  en: { f: "danna", m: "matt" },
  zh: { f: "meimei", m: "liangliang" },
}

const NAVER_MAX_CHARS = 100

/** 按标点/空格把长文本切成 ≤maxLen 的片段 */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const parts = text.split(/(?<=[。！？!?；;.，,、\n])|(?<=\s)/)
  const out: string[] = []
  let cur = ""
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

/** 剥掉 MP3 文件的 ID3v2 头，便于直接拼接多段音频帧 */
function stripId3(buf: Buffer): Buffer {
  if (buf.length > 10 && buf.toString("latin1", 0, 3) === "ID3") {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f)
    return buf.subarray(10 + size)
  }
  return buf
}

async function fetchNaver(
  text: string,
  le: string,
  gender: string,
): Promise<Buffer | null> {
  const speaker = NAVER_SPEAKERS[le]?.[gender] ?? NAVER_SPEAKERS[le]?.f
  if (!speaker) return null
  try {
    const bufs: Buffer[] = []
    for (const part of chunkText(text, NAVER_MAX_CHARS)) {
      const url = `${NAVER}?service=dictionary&speech_fmt=mp3&speaker=${speaker}&speed=0&text=${encodeURIComponent(part)}`
      const res = await fetch(url, {
        headers: { Referer: "https://papago.naver.com/", "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 500) return null // 0 字节小响应 = 没有这段发音
      bufs.push(bufs.length === 0 ? buf : stripId3(buf))
    }
    return Buffer.concat(bufs)
  } catch {
    return null
  }
}

async function fetchYoudao(text: string, le: string): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `${YOUDAO}?audio=${encodeURIComponent(text)}&le=${le}`,
      { signal: AbortSignal.timeout(12000) },
    )
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length < 500 ? null : buf
  } catch {
    return null
  }
}

async function ttsProxyHandler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? "", "http://localhost")
    const text = url.searchParams.get("text")?.slice(0, 1000)
    const le = url.searchParams.get("le")
    const gender = url.searchParams.get("gender") === "m" ? "m" : "f"
    if (!text || !le || !/^(ko|en|ja|zh)$/.test(le)) {
      res.statusCode = 400
      res.end("bad request")
      return
    }
    const buf =
      (await fetchNaver(text, le, gender)) ?? (await fetchYoudao(text, le))
    if (!buf) {
      res.statusCode = 502
      res.end("upstream error")
      return
    }
    res.setHeader("Content-Type", "audio/mpeg")
    res.setHeader("Cache-Control", "public, max-age=31536000")
    res.end(buf)
  } catch {
    res.statusCode = 502
    res.end("proxy error")
  }
}

const ttsProxy = (): Plugin => ({
  name: "tts-proxy",
  configureServer(server) {
    server.middlewares.use("/api/tts", ttsProxyHandler)
  },
  configurePreviewServer(server) {
    server.middlewares.use("/api/tts", ttsProxyHandler)
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), ttsProxy()],
  server: {
    port: 7100,
    host: true, // 允许同一 Wi-Fi 下的手机访问
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
