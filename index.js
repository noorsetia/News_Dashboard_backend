const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')
const dotenv = require('dotenv')

dotenv.config()

const app = express()
app.use(express.json())

// Allow all origins in development to avoid Vite dev port CORS issues; in production restrict to CLIENT_ORIGIN
const isProd = process.env.NODE_ENV === 'production'
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5174'
app.use(cors({ origin: isProd ? clientOrigin : true }))

// Log whether NewsData key exists (do not print the key itself)
if (process.env.NEWSDATA_API_KEY) {
  console.log('Server: NEWSDATA_API_KEY is present')
} else {
  console.log('Server: NEWSDATA_API_KEY is not set')
}

// Routes
app.use('/api/auth', require('./routes/auth'))
app.use('/api/bookmarks', require('./routes/bookmarks'))
app.use('/api/fetch-article', require('./routes/fetchArticle'))
app.use('/api/summarize', require('./routes/summarize'))
// server-side news proxy
app.use('/api/news', require('./routes/news'))

// basic health
app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }))

const PORT = process.env.PORT || 4000
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/news_dashboard'

function startServer() {
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`))
}

// Try to connect to MongoDB, but do not exit if it fails — allow server to run in degraded mode.
mongoose
  .connect(MONGO, { autoIndex: true })
  .then(() => {
    console.log('Connected to MongoDB')
    startServer()
  })
  .catch((err) => {
    console.error('Mongo connection failed', err)
    console.warn('Continuing without MongoDB - running in degraded mode')
    startServer()
  })
