const mongoose = require("mongoose");

const testSchema = new mongoose.Schema({
  name: String,
  subject: String,
  duration: Number,

  questions: [
    {
      questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Flashcard" },
      marks: { type: Number, default: 1 }
    }
  ],

  isActive: { type: Boolean, default: false },
  isEnded:  { type: Boolean, default: false },
  startTime: Date,

  //scheduled window
  scheduledStart: Date,   // e.g. "2025-05-07T10:00"
  scheduledEnd:   Date    // e.g. "2025-05-07T10:30"
});

module.exports = mongoose.model("Test", testSchema);