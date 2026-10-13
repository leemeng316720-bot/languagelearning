// 手机版独立服务器：托管 dist/ 静态文件 + /api/tts 发音代理
// 监听 0.0.0.0，同一 Wi-Fi 下的手机可直接访问
// 用法：npm run phone

import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = join(fileURLToPath(import.meta.url), '..', 'dist')
const PORT = 7200

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

// ---------- 发音代理（Naver 整句优先，有道词条兜底） ----------

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

function stripId3(buf) {
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f)
    return buf.subarray(10 + size)
  }
  return buf
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
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 500) return null
      bufs.push(bufs.length === 0 ? buf : stripId3(buf))
    }
    return Buffer.concat(bufs)
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
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length < 500 ? null : buf
  } catch {
    return null
  }
}

async function handleTts(url, res) {
  const text = url.searchParams.get('text')?.slice(0, 1000)
  const le = url.searchParams.get('le')
  const gender = url.searchParams.get('gender') === 'm' ? 'm' : 'f'
  if (!text || !le || !/^(ko|en|ja|zh)$/.test(le)) {
    res.writeHead(400)
    res.end('bad request')
    return
  }
  const buf = (await fetchNaver(text, le, gender)) ?? (await fetchYoudao(text, le))
  if (!buf) {
    res.writeHead(502)
    res.end('upstream error')
    return
  }
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'public, max-age=31536000',
  })
  res.end(buf)
}

// ---------- 静态服务 ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/tts') {
      await handleTts(url, res)
      return
    }
    let p = decodeURIComponent(url.pathname)
    if (p === '/') p = '/index.html'
    const file = normalize(join(ROOT, p))
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      // SPA 回退
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(await readFile(join(ROOT, 'index.html')))
      return
    }
    const headers = {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    }
    // SW 和 manifest 不缓存，保证更新能及时生效
    if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) {
      headers['Cache-Control'] = 'no-cache'
    }
    res.writeHead(200, headers)
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(500)
    res.end('server error')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces()
  const ips = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address)
  console.log('磨耳朵手机版已启动，同一 Wi-Fi 下用手机浏览器打开：')
  for (const ip of ips) console.log(`  http://${ip}:${PORT}`)
  if (ips.length === 0) console.log(`  （未检测到局域网 IP）http://localhost:${PORT}`)
})
