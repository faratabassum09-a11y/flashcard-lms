const Flashcard = require("../models/flashcard");
const Upload    = require("../models/upload");
const xlsx      = require("xlsx");

function normalizeText(str) {
  return (str || "").toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "this","that","with","from","have","will","your","they","them","then",
  "than","when","what","which","into","also","been","were","more","some",
  "such","each","both","very","just","over","like","most","made","only",
  "after","about","there","their","these","those","other","would","could",
  "should","being"
]);

function extractKeywords(answerText) {
  if (!answerText) return [];
  const words = normalizeText(answerText).split(" ");
  const seen  = new Set();
  return words.filter(w => {
    if (w.length < 4 || STOPWORDS.has(w) || seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}

function matchKeyword(userAnswer, keyword) {
  const kw = normalizeText(keyword);
  if (!kw) return false;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(userAnswer);
}

module.exports.getFlashcards = async (req, res) => {
  const flashcards = await Flashcard.find({});
  const subjects   = [...new Set(flashcards.map(f => f.subject))];
  res.render("flashcards", { flashcards, subjects });
};

module.exports.uploadFlashcards = async (req, res) => {
  try {
    const subject = req.body.subject;
    if (!req.file) {
      req.flash("error", "No file uploaded");
      return res.redirect("/flashcards");
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheet    = workbook.SheetNames[0];
    const data     = xlsx.utils.sheet_to_json(workbook.Sheets[sheet]);

    for (let row of data) {
      const question = row.question || row.QUESTION || row.Question;
      const answer   = row.answer   || row.ANSWER   || row.Answer;
      if (!question || !answer) continue;

      const rawKw  = row.keywords || row.KEYWORDS || row.Keywords;
      const keywords = rawKw
        ? String(rawKw).split(",").map(k => k.trim()).filter(Boolean)
        : extractKeywords(answer);

      await Flashcard.create({ subject, question, answer, keywords });
    }

    await Upload.create({ filename: req.file.originalname, type: "flashcards", subject, rows: data });
    req.flash("success", "Flashcards uploaded successfully");
    res.redirect("/flashcards");
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/flashcards");
  }
};

module.exports.checkAnswer = async (req, res) => {
  try {
    const { questionId, answer } = req.body;
    const flashcard = await Flashcard.findById(questionId);
    if (!flashcard) return res.json({ percent: 0, error: "Flashcard not found" });

    const userAnswer    = normalizeText(answer || "");
    const correctAnswer = normalizeText(flashcard.answer || "");

    if (!flashcard.keywords || flashcard.keywords.length === 0) {
      const autoKw = extractKeywords(flashcard.answer || "");
      if (autoKw.length > 0) {
        await Flashcard.findByIdAndUpdate(questionId, { keywords: autoKw });
        const match = autoKw.filter(k => matchKeyword(userAnswer, k)).length;
        return res.json({ percent: Math.round((match / autoKw.length) * 100) });
      }
      const ud = (userAnswer.match(/\d+/g) || []).join("");
      const cd = (correctAnswer.match(/\d+/g) || []).join("");
      return res.json({ percent: (ud && ud === cd) ? 100 : 0 });
    }

    const match   = flashcard.keywords.filter(k => matchKeyword(userAnswer, k)).length;
    const percent = Math.round((match / flashcard.keywords.length) * 100);
    return res.json({ percent });
  } catch (err) {
    res.json({ percent: 0 });
  }
};