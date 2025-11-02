const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const Bookmark = require('../models/Bookmark')

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret'

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const parts = auth.split(' ')
  if (parts.length !== 2) return res.status(401).json({ error: 'Unauthorized' })
  const token = parts[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.userId, email: payload.email }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// Get bookmarks for current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const list = await Bookmark.find({ userId: req.user.id }).sort({ createdAt: -1 })
    res.json({ bookmarks: list })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Create bookmark
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, url, source, savedAt, notes } = req.body
    if (!title || !url) return res.status(400).json({ error: 'Missing title or url' })
    // avoid duplicates for same user+url
    const exists = await Bookmark.findOne({ userId: req.user.id, url })
    if (exists) return res.status(409).json({ error: 'Already saved', bookmark: exists })

    const bm = await Bookmark.create({ userId: req.user.id, title, url, source, savedAt: savedAt || Date.now(), notes: notes || '' })
    res.status(201).json({ bookmark: bm })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Update notes or title
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const { notes, title } = req.body
    const bm = await Bookmark.findOne({ _id: id, userId: req.user.id })
    if (!bm) return res.status(404).json({ error: 'Not found' })
    if (notes !== undefined) bm.notes = notes
    if (title) bm.title = title
    await bm.save()
    res.json({ bookmark: bm })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Delete bookmark
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const bm = await Bookmark.findOneAndDelete({ _id: id, userId: req.user.id })
    if (!bm) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Stats for current user: total and counts by source
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const agg = await Bookmark.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(req.user.id) } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $project: { source: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])
    const total = await Bookmark.countDocuments({ userId: req.user.id })
    res.json({ total, bySource: agg })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
