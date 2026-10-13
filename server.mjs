// 手机版独立服务器：托管 dist/ 静态文件 + /api/tts 发音代理
// 监听 0.0.0.0，同一 Wi-Fi 下的手机可直接访问
// 用法：npm run phone

import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { getTtsAudio, parseTtsParams } from './api/tts-core.js'

const ROOT = join(fileURLToPath(import.meta.url), '..', 'dist')
// 可用 PORT 环境变量换端口（如本机 7200 被占用时：PORT=7300 npm run phone）
const PORT = Number(process.env.PORT) || 7200

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

// ---------- 发音代理（逻辑见 api/tts-core.js：Naver 整句 → 百度 → 有道词条） ----------

async function handleTts(url, res) {
  const params = parseTtsParams(`http://localhost${url.pathname}${url.search}`)
  if (!params) {
    res.writeHead(400)
    res.end('bad request')
    return
  }
  const buf = await getTtsAudio(params.text, params.le, params.gender)
  if (!buf) {
    res.writeHead(502)
    res.end('upstream error')
    return
  }
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'public, max-age=31536000',
  })
  res.end(Buffer.from(buf))
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
