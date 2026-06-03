const mongoose = require("mongoose");
const uploadSchema = new mongoose.Schema({
  filename: String,
  url: String,
  publicId: String,

  type: {
    type: String,
    enum: ["users", "flashcards"]
  },

  createdIds: [{
    type: mongoose.Schema.Types.ObjectId
  }]
}, {
  timestamps: true
});