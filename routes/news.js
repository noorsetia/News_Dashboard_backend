const express = require('express')
const router = express.Router()
const fetch = global.fetch || require('node-fetch')

// Helper: map NewsData result to unified article shape
function mapNewsData(results) {
  return (results || []).map((a, i) => ({
    id: a.link || `${Date.now()}-${i}`,
    title: a.title,
    url: a.link,
    source: a.source_id || (a.source && a.source.name) || 'NewsData',
    provider: 'newsdata',
    time: a.pubDate,
    description: a.description || a.content || '',
    image: a.image_url || '',
    original: a,
  }))
}

// Helper: map NewsAPI articles
function mapNewsAPI(results) {
  return (results || []).map((a, i) => ({
    id: a.url || `${Date.now()}-${i}`,
    title: a.title,
    url: a.url,
    source: a.source && a.source.name,
    provider: 'newsapi',
    time: a.publishedAt,
    description: a.description || a.content || '',
    image: a.urlToImage || '',
    original: a,
  }))
}

// Helper: map Hacker News (Algolia)
function mapHN(results) {
  return (results || []).map((h) => ({
    id: h.objectID,
    title: h.title || h.story_title || 'Untitled',
    url: h.url || h.story_url || '',
    source: h.author || 'Hacker News',
    provider: 'hackernews',
    time: h.created_at,
    description: h.story_text || h.comment_text || '',
    image: '',
    original: h,
  }))
}

// Helper: map Mediastack
function mapMediastack(results) {
  return (results || []).map((a, i) => ({
    id: a.url || `${Date.now()}-${i}`,
    title: a.title,
    url: a.url,
    source: a.source || a.author || 'Mediastack',
    provider: 'mediastack',
    time: a.published_at || a.publishedAt || '',
    description: a.description || '',
    image: a.image || '',
    original: a,
  }))
}

// Helper: map GNews
function mapGNews(results) {
  return (results || []).map((a, i) => ({
    id: a.url || `${Date.now()}-${i}`,
    title: a.title,
    url: a.url,
    source: (a.source && a.source.name) || 'GNews',
    provider: 'gnews',
    time: a.publishedAt || a.published_at || '',
    description: a.description || '',
    image: a.image || '',
    original: a,
  }))
}

// Lightweight server-side country matcher to ensure country dropdown affects results
function matchesCountry(article, country) {
  if (!country) return true
  const c = country.toString().toLowerCase()
  const tryFields = []
  if (article.source) tryFields.push(String(article.source))
  if (article.title) tryFields.push(String(article.title))
  if (article.description) tryFields.push(String(article.description))
  if (article.provider) tryFields.push(String(article.provider))
  if (article.original) tryFields.push(JSON.stringify(article.original))
  for (const f of tryFields) {
    if (!f) continue
    try {
      if (f.toLowerCase().includes(c)) return true
    } catch (e) {}
  }
  // also check URL host TLD (e.g., .in, .us) as a heuristic
  try {
    if (article.url) {
      const host = new URL(article.url).hostname.toLowerCase()
      if (host.endsWith('.' + c)) return true
    }
  } catch (e) {}
  return false
}

// GET /api/news?q=&category=&country=&page=&pageSize=&provider=
router.get('/', async (req, res) => {
  const newsdataKey = process.env.NEWSDATA_API_KEY
  const newsapiKey = process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY
  const mediastackKey = process.env.MEDIASTACK_API_KEY || process.env.MEDIASTACK_KEY
  const gnewsKey = process.env.GNEWS_API_KEY || process.env.VITE_GNEWS_KEY

  const { q = '', category = '', country = '', page = '0', pageSize = '20', language = 'en', provider = 'auto' } = req.query

  console.log('News route: request', { q, category, country, page, pageSize, provider })

  // helper fetchers for each provider (server-side)
  async function tryNewsData() {
    if (!newsdataKey) throw new Error('NewsData key missing')
    const params = new URLSearchParams()
    params.set('apikey', newsdataKey)
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (country) params.set('country', country)
    if (language) params.set('language', language)
    const p = Math.max(1, Number(page) + 1)
    params.set('page', String(p))
    const url = `https://newsdata.io/api/1/news?${params.toString()}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('NewsData fetch failed')
    const data = await r.json()
    if (!Array.isArray(data.results)) throw new Error('NewsData returned unexpected payload')
    return mapNewsData(data.results)
  }

  async function tryNewsAPI() {
    if (!newsapiKey) throw new Error('NewsAPI key missing')
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (country) params.set('country', country)
    params.set('page', String(Number(page) + 1))
    params.set('pageSize', String(pageSize))
    params.set('apiKey', newsapiKey)
    const url = `https://newsapi.org/v2/top-headlines?${params.toString()}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('NewsAPI fetch failed')
    const data = await r.json()
    return mapNewsAPI(data.articles || [])
  }

  async function tryMediastack() {
    if (!mediastackKey) throw new Error('Mediastack key missing')
    const params = new URLSearchParams()
    params.set('access_key', mediastackKey)
    if (q) params.set('keywords', q)
    if (category) params.set('categories', category)
    if (country) params.set('countries', country)
    params.set('limit', String(pageSize))
    params.set('offset', String(Math.max(0, Number(page)) * Number(pageSize)))
    const url = `http://api.mediastack.com/v1/news?${params.toString()}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('Mediastack fetch failed')
    const data = await r.json()
    return mapMediastack(data.data || [])
  }

  async function tryGNews() {
    if (!gnewsKey) throw new Error('GNews key missing')
    const params = new URLSearchParams()
    params.set('token', gnewsKey)
    if (q) params.set('q', q)
    if (country) params.set('country', country)
    // gnews uses max and page
    params.set('max', String(pageSize))
    params.set('page', String(Number(page) + 1))
    const url = `https://gnews.io/api/v4/top-headlines?${params.toString()}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('GNews fetch failed')
    const data = await r.json()
    return mapGNews(data.articles || [])
  }

  async function tryHackerNews() {
    const qParam = q ? `&query=${encodeURIComponent(q)}` : ''
    const api = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${encodeURIComponent(pageSize)}&page=${encodeURIComponent(page)}${qParam}`
    const r = await fetch(api)
    if (!r.ok) throw new Error('Hacker News fetch failed')
    const data = await r.json()
    return mapHN(data.hits || [])
  }

  // order of providers to try when provider=auto
  const order = ['newsdata', 'newsapi', 'mediastack', 'gnews', 'hackernews']

  // build list of attempts: if a specific provider requested, try it first
  const attempts = []
  if (provider && provider !== 'auto') attempts.push(provider.toString().toLowerCase())
  for (const p of order) if (!attempts.includes(p)) attempts.push(p)

  for (const p of attempts) {
    try {
      let articles = []
      if (p === 'newsdata') articles = await tryNewsData()
      else if (p === 'newsapi') articles = await tryNewsAPI()
      else if (p === 'mediastack') articles = await tryMediastack()
      else if (p === 'gnews') articles = await tryGNews()
      else if (p === 'hackernews') articles = await tryHackerNews()

      if (articles && articles.length >= 0) {
        // if country was requested but provider doesn't support server-side country filtering reliably,
        // apply a lightweight server-side filter so users still get country-specific results
        let out = articles
        if (country) {
          out = articles.filter((a) => matchesCountry(a, country))
        }
        console.log('News route: provider=', p, 'articles=', out.length)
        return res.json({ provider: p, articles: out })
      }
    } catch (err) {
      console.warn(`Provider ${p} failed:`, err.message || err)
      // continue to next
    }
  }

  return res.status(502).json({ error: 'No news provider available' })
})

module.exports = router
