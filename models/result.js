const mongoose = require("mongoose");

const resultSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  testId:   { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  score:    Number,
  total:    Number,
  submittedAt: { type: Date, default: Date.now }
});
resultSchema.index({ userId: 1, testId: 1 }, { unique: true });

module.exports = mongoose.model("Result", resultSchema);