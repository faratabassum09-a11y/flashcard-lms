const mongoose = require("mongoose");
const flashcardSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true,
    trim: true
  },

  question: {
    type: String,
    required: true,
    trim: true
  },

  answer: {
    type: String,
    required: true,
    trim: true
  },

  keywords: {
    type: [String],
    default: []
  }
});

flashcardSchema.index({ subject: 1 });

module.exports = mongoose.model("Flashcard", flashcardSchema);