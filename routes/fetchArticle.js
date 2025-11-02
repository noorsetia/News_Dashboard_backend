const express = require('express')
const router = express.Router()
const { URL } = require('url')
const net = require('net')

const TIMEOUT_MS = 8000 // 8s
const MAX_BYTES = 200 * 1024 // 200 KB

function isPrivateIp(ip) {
  const v = net.isIP(ip)
  if (v === 4) {
    const parts = ip.split('.').map((n) => parseInt(n, 10))
    if (parts[0] === 10) return true
    if (parts[0] === 127) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    return false
  }
  if (v === 6) {
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
    // basic fc00/fd00 check
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true
    return false
  }
  return false
}

router.get('/', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: 'Missing url' })

  let parsed
  try {
    parsed = new URL(url)
  } catch (err) {
    return res.status(400).json({ error: 'Invalid url' })
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Invalid protocol' })

  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return res.status(400).json({ error: 'Disallowed host' })

  // If hostname is an IP, block private ranges
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) return res.status(400).json({ error: 'Disallowed IP' })
  }

  // Fetch remote with timeout and size limit
  try {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const remoteRes = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'NewsDashboard/1.0' }, signal: controller.signal })
    clearTimeout(id)

    if (!remoteRes.ok) return res.status(502).json({ error: 'Failed to fetch remote' })

    // read body as stream where possible to enforce size limit
    let text = ''
    if (remoteRes.body && typeof remoteRes.body.getReader === 'function') {
      const reader = remoteRes.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          const chunk = Buffer.from(value).toString('utf8')
          text += chunk
          if (text.length > MAX_BYTES) {
            controller.abort()
            return res.status(413).json({ error: 'Fetched content too large' })
          }
        }
      }
    } else {
      // fallback to text() and truncate
      text = await remoteRes.text()
      if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES)
    }

    // Strip scripts/styles and HTML tags, collapse whitespace
    text = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    text = text.replace(/<[^>]+>/g, ' ')
    text = text.replace(/\s+/g, ' ').trim()

    return res.json({ text })
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timeout fetching remote' })
    console.error('fetch-article error', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
