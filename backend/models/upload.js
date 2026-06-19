const mongoose = require("mongoose");

const uploadSchema = new mongoose.Schema({
  filename:    { type: String, required: true },
  type:        { type: String, enum: ["users", "flashcards"], required: true },
  subject:     { type: String },                  // only for flashcard uploads
  uploadedAt:  { type: Date, default: Date.now },
  // store the raw rows so we can delete the exact records later
  rows:        { type: mongoose.Schema.Types.Mixed, required: true }
});

module.exports = mongoose.model("Upload", uploadSchema);