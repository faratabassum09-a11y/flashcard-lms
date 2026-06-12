require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected");
    try {
      await mongoose.connection.db.collection("results").dropIndex("rollNo_1_testId_1");
      console.log("Dropped old bad index: rollNo_1_testId_1");
    } catch (e) {
      console.log("Old index not found (already clean):", e.codeName || e.message);
    }
  })
  .catch((err) => console.log("MongoDB error:", err));

const ejs              = require("ejs");
const ejsMate          = require("ejs-mate");
const session          = require("express-session");
const MongoStore       = require("connect-mongo").default;
const flash            = require("connect-flash");
const passport         = require("passport");
const LocalStrategy    = require("passport-local");
const methodOverride   = require("method-override");
const multer           = require("multer");
const fs               = require("fs");
const xlsx             = require("xlsx");
const PDFDocument      = require("pdfkit");
const app              = express();
const isAdmin          = require("./middleware/isAdmin");
const cron             = require("node-cron");
const ExpressError     = require("./utils/ExpressError.js");
const isLoggedIn       = require("./middleware/isLoggedIn");
const expressLayouts   = require("express-ejs-layouts");

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("layout", "layouts/boilerplate");

//  multer: memory storage (no disk → works on Render) 
const storage       = multer.memoryStorage();
const upload        = multer({ storage });
const uploadUsers      = multer({ storage });
const uploadFlashcards = multer({ storage });

//  Models ─
const User      = require("./models/user.js");
const Flashcard = require("./models/flashcard");
const Test      = require("./models/test");
const Result    = require("./models/result");
const Upload    = require("./models/upload");   // ← new upload-tracker model

//  Core middleware 
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));
app.use(express.json());

//  Session / Passport ─
const store = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  crypto: { secret: process.env.SESSION_SECRET },
  touchAfter: 24 * 3600
});
store.on("error", (err) => console.log("Session store error", err));

app.use(session({
  store,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge:  1000 * 60 * 60 * 24 * 7,
    httpOnly: true
  }
}));

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
app.use(flash());

app.use((req, res, next) => {
  res.locals.success  = req.flash("success");
  res.locals.error    = req.flash("error");
  res.locals.currUser = req.user;
  next();
});

//  Helpers 
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

function shuffleArray(arr) {
  return arr
    .map(v => ({ v, s: Math.random() }))
    .sort((a, b) => a.s - b.s)
    .map(({ v }) => v);
}

//  Cron: auto-start / auto-end tests 
cron.schedule("* * * * *", async () => {
  const now = new Date();
  await Test.updateMany(
    { scheduledStart: { $lte: now }, isActive: false, isEnded: false },
    { isActive: true, startTime: now }
  );
  await Test.updateMany(
    { scheduledEnd: { $lte: now }, isActive: true, isEnded: false },
    { isActive: false, isEnded: true }
  );
  const active = await Test.find({ isActive: true, isEnded: false });
  for (const t of active) {
    if (!t.startTime) continue;
    const elapsed = (now - new Date(t.startTime)) / 60000;
    if (elapsed >= t.duration) {
      await Test.findByIdAndUpdate(t._id, { isActive: false, isEnded: true });
      console.log(`Auto-ended test: ${t.name}`);
    }
  }
});

//  Auth routes ─
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => res.render("users/login.ejs"));

app.post("/login",
  passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }),
  (req, res) => {
    if (!req.user) return res.redirect("/login");
    return req.user.username === "admin"
      ? res.redirect("/admin")
      : res.redirect("/dashboard");
  }
);

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "Logged out successfully");
    res.redirect("/login");
  });
});

//  Dashboard / Admin ─
app.get("/dashboard", isLoggedIn, (req, res) => {
  res.render("dashboard", { username: req.user.username });
});

app.get("/admin", isLoggedIn, isAdmin, async (req, res) => {
  const flashcards = await Flashcard.find({}).lean();
  const subjects   = [...new Set(flashcards.map(f => f.subject))];
  res.render("users/admin", { flashcards, subjects });
});

//  Upload flashcards ─
app.post("/upload-flashcards", isLoggedIn, isAdmin, uploadFlashcards.single("file"), async (req, res) => {
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

      let keywords  = [];
      const rawKw   = row.keywords || row.KEYWORDS || row.Keywords;
      keywords      = rawKw
        ? String(rawKw).split(",").map(k => k.trim()).filter(Boolean)
        : extractKeywords(answer);

      await Flashcard.create({ subject, question, answer, keywords });
    }

    // Save upload record to MongoDB
    await Upload.create({
      filename:   req.file.originalname,
      type:       "flashcards",
      subject,
      rows:       data
    });

    req.flash("success", "Flashcards uploaded successfully");
    res.redirect("/flashcards");
  } catch (err) {
    console.log("UPLOAD ERROR:", err);
    req.flash("error", err.message);
    res.redirect("/flashcards");
  }
});

//  Upload users 
app.post("/upload-users", isLoggedIn, isAdmin, uploadUsers.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      req.flash("error", "No file uploaded");
      return res.redirect("/admin");
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheet    = workbook.SheetNames[0];
    const data     = xlsx.utils.sheet_to_json(workbook.Sheets[sheet]);

    let created = 0, skipped = 0;

    for (let row of data) {
      const username = (
        row.username || row.Username || row.USERNAME ||
        row["user name"] || row["User Name"]
      )?.toString().trim();

      const password = (
        row.password || row.Password || row.PASSWORD ||
        row.pass || row.PASS || row["user password"]
      )?.toString().trim();

      if (!username || !password) { skipped++; continue; }

      const exists = await User.findOne({ username });
      if (exists) { skipped++; continue; }

      await User.register(new User({ username }), password);
      created++;
    }

    // Save upload record to MongoDB
    await Upload.create({
      filename: req.file.originalname,
      type:     "users",
      rows:     data
    });

    req.flash("success", `Users created: ${created}, skipped: ${skipped}`);
    res.redirect("/admin");
  } catch (err) {
    console.log("UPLOAD ERROR:", err);
    req.flash("error", err.message);
    res.redirect("/admin");
  }
});

//  Upload manager: list all uploads ─
app.get("/admin/uploads", isLoggedIn, isAdmin, async (req, res) => {
  const userUploads      = await Upload.find({ type: "users"      }).sort({ uploadedAt: -1 }).lean();
  const flashcardUploads = await Upload.find({ type: "flashcards" }).sort({ uploadedAt: -1 }).lean();
  res.render("adminUploads", { userUploads, flashcardUploads });
});

//  View a single upload (show rows) ─
app.get("/admin/uploads/view/:id", isLoggedIn, isAdmin, async (req, res) => {
  const uploadDoc = await Upload.findById(req.params.id).lean();
  if (!uploadDoc) {
    req.flash("error", "Upload not found");
    return res.redirect("/admin/uploads");
  }
  res.render("adminUploadView", { uploadDoc });
});

//  Delete a user upload (removes DB users created by that file) 
app.delete("/admin/uploads/delete/:id", isLoggedIn, isAdmin, async (req, res) => {
  try {
    const uploadDoc = await Upload.findById(req.params.id);
    if (!uploadDoc) {
      req.flash("error", "Upload record not found");
      return res.redirect("/admin/uploads");
    }

    let removed = 0;

    if (uploadDoc.type === "users") {
      for (let row of uploadDoc.rows) {
        const username = (
          row.username || row.Username || row.USERNAME ||
          row["user name"] || row["User Name"]
        )?.toString().trim();
        if (!username) continue;
        const r = await User.deleteOne({ username });
        removed += r.deletedCount || 0;
      }
      req.flash("success", `Upload deleted. ${removed} user(s) removed.`);
    } else if (uploadDoc.type === "flashcards") {
      for (let row of uploadDoc.rows) {
        const question = row.question || row.Question || row.QUESTION;
        if (!question) continue;
        const r = await Flashcard.deleteMany({ question });
        removed += r.deletedCount || 0;
      }
      req.flash("success", `Upload deleted. ${removed} flashcard(s) removed.`);
    }

    await Upload.findByIdAndDelete(req.params.id);
    res.redirect("/admin/uploads");
  } catch (err) {
    console.log(err);
    req.flash("error", err.message);
    res.redirect("/admin/uploads");
  }
});

//  Flashcards 
app.get("/flashcards", isLoggedIn, async (req, res) => {
  try {
    const flashcards = await Flashcard.find({});
    const subjects   = [...new Set(flashcards.map(f => f.subject))];
    res.render("flashcards", { flashcards, subjects });
  } catch (err) {
    console.log(err);
    res.send("Error loading flashcards");
  }
});

//  Tests 
app.post("/create-test", isLoggedIn, isAdmin, async (req, res) => {
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
    console.log(err);
    res.send("Error creating test");
  }
});

app.get("/tests", isLoggedIn, async (req, res) => {
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
});

app.get("/read", isLoggedIn, async (req, res) => {
  const flashcards = await Flashcard.find();
  res.render("read", { flashcards, currUser: req.user });
});

app.get("/test/:id", isLoggedIn, async (req, res) => {
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
  res.render("startTest", {
    test: { ...test.toObject(), questions },
    currUser: req.user,
    remainingTime
  });
});

app.post("/submit-test", isLoggedIn, async (req, res) => {
  try {
    const { testId, answers } = req.body;
    const test = await Test.findById(testId);
    if (!test) return res.send("Invalid test");

    const already = await Result.findOne({ testId: testId.toString(), userId: req.user._id });
    if (already) return res.send("❌ Already submitted");

    const now   = Date.now();
    if (!test.startTime) return res.send("❌ Test has not started");

    const start    = new Date(test.startTime).getTime();
    const duration = test.duration * 60 * 1000;
    if (now - start > duration + 30000) return res.send("⏰ Time ended");

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
    console.log("SUBMIT ERROR:", err);
    res.status(500).send("Submit error: " + err.message);
  }
});

app.post("/check-answer", isLoggedIn, async (req, res) => {
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
    console.log("CHECK-ANSWER ERROR:", err);
    res.json({ percent: 0 });
  }
});

app.post("/log-event", isLoggedIn, async (req, res) => {
  try {
    const { testId, reason, time } = req.body;
    console.log(`[VIOLATION] user=${req.user.username} test=${testId} reason="${reason}" time=${new Date(time).toISOString()}`);
    // Optional: persist to DB for instructor review
    // await Violation.create({ userId: req.user._id, testId, reason, time: new Date(time) });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

//  Admin test controls ─
app.post("/admin/start-test/:id", isLoggedIn, isAdmin, async (req, res) => {
  await Test.findByIdAndUpdate(req.params.id, { isActive: true, isEnded: false, startTime: new Date() });
  res.redirect("/tests");
});
app.post("/admin/end-test/:id", isLoggedIn, isAdmin, async (req, res) => {
  await Test.findByIdAndUpdate(req.params.id, { isActive: false, isEnded: true });
  res.redirect("/tests");
});
app.delete("/admin/delete-test/:id", isLoggedIn, isAdmin, async (req, res) => {
  await Test.findByIdAndDelete(req.params.id);
  await Result.deleteMany({ testId: req.params.id });
  req.flash("success", "Test deleted");
  res.redirect("/tests");
});

//  Admin results ─
app.get("/admin/results", isLoggedIn, isAdmin, async (req, res) => {
  const tests   = await Test.find({}).populate("questions.questionId");
  const results = await Result.find({}).populate("userId").populate("testId");
  const users   = await User.find({ username: { $ne: "admin" } });

  const grouped = {};
  for (let test of tests) {
    const subject = test.subject || "Unknown";
    if (!grouped[subject]) grouped[subject] = {};
    if (!grouped[subject][test.name]) {
      grouped[subject][test.name] = { testId: test._id, duration: test.duration, isEnded: test.isEnded, rows: [] };
    }
    for (let user of users) {
      const result = results.find(r =>
        r.userId && r.testId &&
        r.userId._id.toString() === user._id.toString() &&
        r.testId._id.toString() === test._id.toString()
      );
      grouped[subject][test.name].rows.push({
        username:  user.username,
        score:     result?.score ?? null,
        total:     result?.total ?? null,
        attempted: !!result
      });
    }
  }
  res.render("adminResults", { grouped });
});

app.get("/admin/results/pdf/:testId", isLoggedIn, isAdmin, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    if (!test) return res.send("Test not found");
    const users   = await User.find({ username: { $ne: "admin" } });
    const results = await Result.find({ testId: req.params.testId }).populate("userId");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${test.name}-results.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).text("TEST RESULT REPORT", { align: "center" });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Test Name : ${test.name}`);
    doc.text(`Subject   : ${test.subject}`);
    doc.text(`Duration  : ${test.duration} Minutes`);
    doc.moveDown(2);

    const drawHeader = (y) => {
      doc.rect(40, y, 520, 25).stroke();
      [80, 260, 340, 420, 480].forEach(x => doc.moveTo(x, y).lineTo(x, y + 25).stroke());
      doc.text("No", 50, y + 7); doc.text("Student", 90, y + 7);
      doc.text("Score", 280, y + 7); doc.text("Total", 360, y + 7);
      doc.text("%", 440, y + 7); doc.text("Status", 490, y + 7);
      return y + 25;
    };

    let y = drawHeader(doc.y);

    users.forEach((user, i) => {
      if (y > 730) { doc.addPage(); y = drawHeader(50); }
      const result = results.find(r => r.userId && r.userId._id.toString() === user._id.toString());
      const score  = result?.score ?? "";
      const total  = result?.total ?? "";
      const pct    = result && result.total > 0 ? Math.round((result.score / result.total) * 100) + "%" : "";
      doc.rect(40, y, 520, 25).stroke();
      [80, 260, 340, 420, 480].forEach(x => doc.moveTo(x, y).lineTo(x, y + 25).stroke());
      doc.text(i + 1, 50, y + 7);
      doc.text(user.username, 90, y + 7, { width: 160 });
      doc.text(String(score), 280, y + 7);
      doc.text(String(total), 360, y + 7);
      doc.text(pct, 440, y + 7);
      doc.text(result ? "Submitted" : "NA", 490, y + 7);
      y += 25;
    });

    doc.end();
  } catch (err) {
    console.log(err);
    res.status(500).send(err.message);
  }
});

//  Profile / Settings 
app.get("/profile", isLoggedIn, async (req, res) => {
  const user          = await User.findById(req.user._id);
  const recentResults = await Result.find({ userId: req.user._id })
    .populate("testId").sort({ submittedAt: -1 }).limit(5);
  let totalMarks = 0;
  recentResults.forEach(r => { totalMarks += r.score || 0; });
  res.render("profile.ejs", { user, recentResults, totalMarks, totalTests: recentResults.length });
});

app.get("/settings", isLoggedIn, async (req, res) => {
  const user = await User.findById(req.user._id);
  let results = [], totalMarks = 0, totalTests = 0;
  if (user.username !== "admin") {
    results    = await Result.find({ userId: user._id }).populate("testId").sort({ submittedAt: -1 });
    totalTests = results.length;
    results.forEach(r => { totalMarks += r.score || 0; });
  }
  res.render("settings.ejs", { user, results, totalTests, totalMarks });
});

app.post("/change-password", isLoggedIn, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    await user.changePassword(currentPassword, newPassword);
    await user.save();
    req.flash("success", "Password changed successfully");
    res.redirect("/settings");
  } catch (err) {
    console.log(err);
    req.flash("error", "Current password incorrect");
    res.redirect("/settings");
  }
});

//  Cache headers ─
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

//  Error handlers 
app.use((req, res, next) => next(new ExpressError(404, "Page not found")));
app.use((err, req, res, next) => {
  const { statusCode = 500 } = err;
  res.status(statusCode).render("error.ejs", { err });
});

app.listen(5000, "0.0.0.0", () => console.log("Server running on port 5000"));