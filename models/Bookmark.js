const mongoose = require('mongoose')

const BookmarkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  url: { type: String, required: true },
  source: { type: String },
  savedAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' },
}, { timestamps: true })

module.exports = mongoose.model('Bookmark', BookmarkSchema)
