const express = require('express')
const router = express.Router()
const { URL } = require('url')
const net = require('net')

const TIMEOUT_MS = 8000
const MAX_BYTES = 300 * 1024

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
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true
    return false
  }
  return false
}

async function fetchTextFromUrl(url) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'NewsDashboard/1.0' }, signal: controller.signal })
  clearTimeout(id)
  if (!res.ok) throw new Error('Remote fetch failed')
  let text = ''
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        const chunk = Buffer.from(value).toString('utf8')
        text += chunk
        if (text.length > MAX_BYTES) {
          controller.abort()
          throw new Error('Content too large')
        }
      }
    }
  } else {
    text = await res.text()
    if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES)
  }
  // strip tags
  text = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

function splitSentences(text) {
  return text
    .replace(/\n/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

function buildSentenceVectors(sentences) {
  const vocab = new Map()
  let idx = 0
  const vectors = []
  for (const s of sentences) {
    const toks = tokenize(s)
    const freq = {}
    for (const t of toks) {
      if (!vocab.has(t)) vocab.set(t, idx++)
      const id = vocab.get(t)
      freq[id] = (freq[id] || 0) + 1
    }
    vectors.push(freq)
  }
  return { vectors, vocabSize: vocab.size }
}

function cosineSim(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (const k in a) {
    const av = a[k]
    na += av * av
    if (b[k]) dot += av * b[k]
  }
  for (const k in b) {
    const bv = b[k]
    nb += bv * bv
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function textRank(sentences, vectors, opts = {}) {
  const d = opts.damping || 0.85
  const iters = opts.iters || 20
  const n = sentences.length
  if (n === 0) return []
  if (n === 1) return [0]
  // build similarity matrix
  const sim = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosineSim(vectors[i], vectors[j])
      sim[i][j] = s
      sim[j][i] = s
    }
  }
  // normalize rows
  const rowSum = sim.map((row) => row.reduce((a, b) => a + b, 0))
  const scores = new Array(n).fill(1 / n)
  for (let it = 0; it < iters; it++) {
    const next = new Array(n).fill((1 - d) / n)
    for (let i = 0; i < n; i++) {
      if (rowSum[i] === 0) continue
      for (let j = 0; j < n; j++) {
        if (sim[j][i] <= 0) continue
        next[i] += d * (sim[j][i] / rowSum[j]) * scores[j]
      }
    }
    for (let k = 0; k < n; k++) scores[k] = next[k]
  }
  return scores.map((s, idx) => ({ idx, score: s })).sort((a, b) => b.score - a.score)
}

router.get('/', async (req, res) => {
  const url = req.query.url
  const rawText = req.query.text
  let text = ''

  try {
    if (url) {
      let parsed
      try {
        parsed = new URL(url)
      } catch (err) {
        return res.status(400).json({ error: 'Invalid url' })
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Invalid protocol' })
      const hostname = parsed.hostname.toLowerCase()
      if (hostname === 'localhost' || hostname.endsWith('.localhost')) return res.status(400).json({ error: 'Disallowed host' })
      if (net.isIP(hostname)) {
        if (isPrivateIp(hostname)) return res.status(400).json({ error: 'Disallowed IP' })
      }
      text = await fetchTextFromUrl(url)
    } else if (rawText) {
      text = String(rawText).slice(0, MAX_BYTES)
    } else {
      return res.status(400).json({ error: 'Missing url or text' })
    }

    if (!text || text.trim().length === 0) return res.status(422).json({ error: 'No text to summarize' })

    const sentences = splitSentences(text).slice(0, 60) // limit sentences
    if (sentences.length === 0) return res.status(422).json({ error: 'No sentences' })
    if (sentences.length <= 3) return res.json({ summary: sentences.join(' ') })

    const { vectors } = buildSentenceVectors(sentences)
    const ranked = textRank(sentences, vectors, { damping: 0.85, iters: 30 })
    const topCount = Math.min(3, Math.max(1, Math.floor(sentences.length * 0.2)))
    const top = ranked.slice(0, topCount).sort((a, b) => a.idx - b.idx).map((t) => sentences[t.idx])
    const summary = top.join(' ')
    return res.json({ summary })
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timeout fetching remote' })
    console.error('summarize error', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
