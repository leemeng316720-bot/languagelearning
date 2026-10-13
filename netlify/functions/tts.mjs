// Netlify Function：/api/tts 发音代理
import { getTtsAudio, parseTtsParams } from '../../api/tts-core.js'

export default async (req) => {
  const params = parseTtsParams(req.url)
  if (!params) return new Response('bad request', { status: 400 })
  try {
    const buf = await getTtsAudio(params.text, params.le, params.gender)
    if (!buf) return new Response('upstream error', { status: 502 })
    return new Response(buf, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    })
  } catch {
    return new Response('proxy error', { status: 502 })
  }
}

export const config = { path: '/api/tts' }
