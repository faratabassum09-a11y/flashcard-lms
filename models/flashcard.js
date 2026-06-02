const mongoose = require("mongoose");

const flashcardSchema = new mongoose.Schema({
  subject: String,
  question: String,
  answer: String,
  keywords: [String]
});

module.exports = mongoose.model("Flashcard", flashcardSchema);