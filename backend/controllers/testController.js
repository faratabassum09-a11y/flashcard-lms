const Test      = require("../models/test");
const Result    = require("../models/result");
const Flashcard = require("../models/flashcard");

function normalizeText(str) {
  return (str || "").toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchKeyword(userAnswer, keyword) {
  const kw = normalizeText(keyword);
  if (!kw) return false;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(userAnswer);
}

function shuffleArray(arr) {
  return arr.map(v => ({ v, s: Math.random() })).sort((a, b) => a.s - b.s).map(({ v }) => v);
}

module.exports.getTests = async (req, res) => {
  const tests = await Test.find({}).lean();
  const now   = new Date();
  const enriched = tests.map(t => {
    if (t.isActive && !t.isEnded && t.startTime) {
      const elapsed = (now - new Date(t.startTime)) / 60000;
      if (elapsed >= t.duration) { t.isActive = false; t.isEnded = true; }
    }
    return t;
  });
  res.set("Cache-Control", "no-store");
  res.render("tests", { tests: enriched, currUser: req.user });
};

module.exports.createTest = async (req, res) => {
  try {
    let { name, duration, subject, questionIds, marks, scheduledStart, scheduledEnd } = req.body;
    if (!Array.isArray(questionIds)) questionIds = questionIds ? [questionIds] : [];
    if (!Array.isArray(marks))       marks       = marks       ? [marks]       : [];

    const formatted = questionIds
      .map((id, i) => ({ questionId: id, marks: Number(marks[i] || 1) }))
      .filter(q => q.questionId);

    await Test.create({
      name, duration, subject,
      questions:      formatted,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
      scheduledEnd:   scheduledEnd   ? new Date(scheduledEnd)   : null
    });
    return res.redirect(303, "/tests?_t=" + Date.now());
  } catch (err) {
    res.send("Error creating test");
  }
};

module.exports.getStartTest = async (req, res) => {
  const test = await Test.findById(req.params.id).populate("questions.questionId");
  if (!test) return res.send("Test not found");

  const now      = Date.now();
  const start    = test.startTime ? new Date(test.startTime).getTime() : 0;
  const duration = test.duration * 60 * 1000;
  const elapsed  = now - start;

  if (!test.isActive && !test.isEnded) return res.send("❌ Test not started yet");
  if (test.isEnded || elapsed >= duration) return res.send("❌ Test has ended");

  const alreadyDone = await Result.findOne({ testId: test._id, userId: req.user._id });
  if (alreadyDone) {
    req.flash("error", "❌ You have already attempted this test");
    return res.redirect("/tests");
  }

  const remainingTime = Math.max(0, Math.floor((start + duration - now) / 1000));
  if (remainingTime <= 0) return res.send("❌ Test time expired");

  const questions = shuffleArray([...test.questions]);
  res.render("startTest", { test: { ...test.toObject(), questions }, currUser: req.user, remainingTime });
};

module.exports.submitTest = async (req, res) => {
  try {
    const { testId, answers } = req.body;
    const test = await Test.findById(testId);
    if (!test) return res.send("Invalid test");

    const already = await Result.findOne({ testId: testId.toString(), userId: req.user._id });
    if (already) return res.send("Already submitted");

    if (!test.startTime) return res.send("Test has not started");

    let totalScore = 0, totalMarks = 0;

    for (let q of test.questions) {
      totalMarks += q.marks;
      const qId      = q.questionId._id?.toString() || q.questionId.toString();
      const flashcard = await Flashcard.findById(qId);
      if (!flashcard) continue;

      const userAnswer    = normalizeText(answers?.[qId] || "");
      const correctAnswer = normalizeText(flashcard.answer || "");
      const keywords      = Array.isArray(flashcard.keywords) ? flashcard.keywords : [];

      let matchPercent = 0;
      if (keywords.length > 0) {
        const matchCount = keywords.filter(k => matchKeyword(userAnswer, k)).length;
        matchPercent = (matchCount / keywords.length) * 100;
      } else {
        const clean = s => (s || "").replace(/[^\d]/g, "");
        if (clean(userAnswer) && clean(userAnswer) === clean(correctAnswer)) matchPercent = 100;
      }

      if      (matchPercent >= 75) totalScore += q.marks;
      else if (matchPercent >= 50) totalScore += q.marks * 0.5;
    }

    await Result.create({
      userId: req.user._id,
      testId,
      score: Math.round(totalScore * 10) / 10,
      total: totalMarks
    });

    res.render("result", {
      totalScore,
      total: totalMarks,
      percentage: totalMarks > 0 ? Math.round((totalScore / totalMarks) * 100) : 0
    });
  } catch (err) {
    res.status(500).send("Submit error: " + err.message);
  }
};

module.exports.logEvent = (req, res) => {
  try {
    const { testId, reason, time } = req.body;
    console.log(`[VIOLATION] user=${req.user.username} test=${testId} reason="${reason}" time=${new Date(time).toISOString()}`);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
};