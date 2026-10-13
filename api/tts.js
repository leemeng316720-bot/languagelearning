// Vercel Serverless Function：/api/tts
import { getTtsAudio, parseTtsParams } from './tts-core.js'

export default async function handler(req, res) {
  try {
    const params = parseTtsParams(`http://${req.headers.host}${req.url}`)
    if (!params) {
      res.status(400).send('bad request')
      return
    }
    const buf = await getTtsAudio(params.text, params.le, params.gender)
    if (!buf) {
      res.status(502).send('upstream error')
      return
    }
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    res.send(Buffer.from(buf))
  } catch {
    res.status(502).send('proxy error')
  }
}
