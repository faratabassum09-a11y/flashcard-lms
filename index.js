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
      // Index didn't exist — that's fine
      console.log(" Old index not found (already clean):", e.codeName || e.message);
    }
})
.catch((err) => {
    console.log("MongoDB error:", err);
});

require("dotenv").config();
const ejs = require("ejs");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const passportLocalMongoose = require("passport-local-mongoose");
const methodOverride = require("method-override");
const multer = require("multer");
const fs = require("fs");
const xlsx = require("xlsx");
const PDFDocument = require("pdfkit");
const app = express();
const isAdmin = require("./middleware/isAdmin");
const cron = require("node-cron");
const ExpressError = require("./utils/ExpressError.js");
const isLoggedIn = require("./middleware/isLoggedIn");

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");

const expressLayouts = require("express-ejs-layouts");


app.set("layout", "layouts/boilerplate");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {

    const uploadPath = path.join(__dirname, "uploads", "users");

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const flashcardStorage = multer.diskStorage({
  destination: (req, file, cb) => {

    const uploadPath = path.join(__dirname, "uploads", "flashcards");

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const uploadFlashcards = multer({ storage: flashcardStorage });
const uploadUsers = multer({ storage });
const upload = multer({ storage });
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const usersDir = path.join(__dirname, "uploads/users");
const flashcardsDir = path.join(__dirname, "uploads/flashcards");

if (!fs.existsSync(usersDir)) {
  fs.mkdirSync(usersDir);
}

if (!fs.existsSync(flashcardsDir)) {
  fs.mkdirSync(flashcardsDir);
}


const User = require("./models/user.js");
const Flashcard = require("./models/flashcard");
const Test = require("./models/test");
const Result = require("./models/result");

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));
app.use(session({
   secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
app.use(flash());
app.use(express.json());
app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currUser = req.user;
    next();
});

// uploads access
app.use("/uploads", express.static("uploads"));

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
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  return regex.test(userAnswer);
}


const STOPWORDS = new Set(["this","that","with","from","have","will","your","they","them","then",
  "than","when","what","which","into","also","been","were","more","some","such","each","both",
  "very","just","over","like","most","made","only","after","about","there","their","these",
  "those","other","would","could","should","being"]);

function extractKeywords(answerText) {
  if (!answerText) return [];
  const words = normalizeText(answerText).split(" ");
  const seen = new Set();
  return words.filter(w => {
    if (w.length < 4) return false;
    if (STOPWORDS.has(w)) return false;
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}


cron.schedule("* * * * *", async () => {
  const now = new Date();

  // Auto-start scheduled tests
  await Test.updateMany(
    {
      scheduledStart: { $lte: now },
      isActive: false,
      isEnded: false,
      scheduledStart: { $exists: true, $ne: null }
    },
    { isActive: true, startTime: now }
  );

  // Auto-end by scheduledEnd
  await Test.updateMany(
    { scheduledEnd: { $lte: now }, isActive: true, isEnded: false },
    { isActive: false, isEnded: true }
  );

  //  Auto-end tests where duration has elapsed (no scheduledEnd set)
  const activeTests = await Test.find({ isActive: true, isEnded: false });
  for (const t of activeTests) {
    if (!t.startTime) continue;
    const elapsed = (now - new Date(t.startTime)) / 1000 / 60; // in minutes
    if (elapsed >= t.duration) {
      await Test.findByIdAndUpdate(t._id, { isActive: false, isEnded: true });
      console.log(`⏰ Auto-ended test: ${t.name}`);
    }
  }
});


app.get("/", (req, res) => res.send("home page"));

app.get("/login", (req, res) => res.render("users/login.ejs"));

app.post("/login",
  passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }),
  (req, res) => {
    if (!req.user) return res.redirect("/login");
    if (req.user.username === "admin") return res.redirect("/admin");
    return res.redirect("/dashboard");
  }
);

app.get("/dashboard",isLoggedIn, (req, res) => {
  if(!req.user){
    req.flash(
      "error",
      "Please login first"
    );

    return res.redirect("/login");
  }
  if (!req.user) return res.redirect("/login");
  res.render("dashboard", { username: req.user.username });
});

app.get("/admin",isLoggedIn, isAdmin, async (req, res) => {

  const flashcards = await Flashcard.find({}).lean();

  //extracting unique subjects
  const subjects = [...new Set(flashcards.map(f => f.subject))];

  res.render("users/admin", {
    flashcards,
    subjects
  });

});




app.get("/admin/uploads", isLoggedIn, isAdmin, (req, res) => {
  res.render("uploadsHome");
});




app.post("/upload-flashcards", isLoggedIn, uploadFlashcards.single("file"), async (req, res) => {
  try {
    const subject = req.body.subject;

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheet]);

    console.log("EXCEL DATA:", data);

    for (let row of data) {
      const question = row.question || row.QUESTION || row.Question;
      const answer   = row.answer   || row.ANSWER   || row.Answer;

      if (!question || !answer) continue;

      // Keywords: explicit column takes priority, else auto-extract from answer
      let keywords = [];
      const rawKw = row.keywords || row.KEYWORDS || row.Keywords;
      if (rawKw) {
        keywords = String(rawKw).split(",").map(k => k.trim()).filter(Boolean);
      } else {
        keywords = extractKeywords(answer);
      }

      console.log(`Saving flashcard: "${question}" | keywords: [${keywords.join(", ")}]`);

      await Flashcard.create({ subject, question, answer, keywords });
    }

    req.flash("success", "Flashcards uploaded successfully");
    res.redirect("/flashcards");

  } catch (err) {
    console.log("UPLOAD ERROR:", err);
    res.status(500).send(err.message);
  }
});

app.get("/flashcards",isLoggedIn, async (req, res) => {
  try {
    const flashcards = await Flashcard.find({});
    const subjects = [...new Set(flashcards.map(f => f.subject))];
    res.render("flashcards", { flashcards: flashcards || [], subjects: subjects || [] });
  } catch (err) {
    console.log(err);
    res.send("Error loading flashcards");
  }
});

app.post("/upload-users", isLoggedIn, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      req.flash("error", "No file uploaded");
      return res.redirect("/admin");
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheet]);

    let created = 0;
    let skipped = 0;

    for (let row of data) {

      const username = (
        row.username ||
        row.Username ||
        row.USERNAME ||
        row["user name"] ||
        row["User Name"]
      )?.toString().trim();

      const password = (
        row.password ||
        row.Password ||
        row.PASSWORD ||
        row.pass ||
        row.PASS ||
        row["user password"]
      )?.toString().trim();

      if (!username || !password) {
        console.log("SKIP ROW (missing data):", row);
        skipped++;
        continue;
      }

      const exists = await User.findOne({ username });

      if (exists) {
        console.log("SKIP (already exists):", username);
        skipped++;
        continue;
      }

      const user = new User({ username });

      await User.register(user, password);

      created++;
      console.log("CREATED USER:", username);
    }

    // fs.unlinkSync(req.file.path);

    console.log("UPLOAD RESULT => created:", created, "skipped:", skipped);

    req.flash("success", `Users created: ${created}, skipped: ${skipped}`);
    res.redirect("/admin");

  } catch (err) {
    console.log("UPLOAD ERROR:", err);

    // if (req.file?.path && fs.existsSync(req.file.path)) {
    //   fs.unlinkSync(req.file.path);
    // }

    req.flash("error", err.message);
    res.redirect("/admin");
  }
});

app.post("/create-test",isLoggedIn, async (req, res) => {
  try {
    let { name, duration, subject, questionIds, marks, scheduledStart, scheduledEnd } = req.body;
    console.log("CREATE TEST — questionIds received:", questionIds); 
    if (!Array.isArray(questionIds)) questionIds = questionIds ? [questionIds] : [];
    if (!Array.isArray(marks)) marks = marks ? [marks] : [];

    const formatted = questionIds
      .map((id, i) => ({ questionId: id, marks: Number(marks[i] || 1) }))
      .filter(q => q.questionId);

    await Test.create({
      name,
      duration,
      subject,
      questions: formatted,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
      scheduledEnd:   scheduledEnd   ? new Date(scheduledEnd)   : null
    });

   return res.redirect(303, "/tests?_t=" + Date.now());
  } catch (err) {
    console.log(err);
    res.send("Error creating test");
  }
});

app.get("/admin/test-started", isLoggedIn,(req, res) => {
  res.render("adminTestStarted");
});


app.get("/tests", isLoggedIn, async (req, res) => {
  const tests = await Test.find({}).lean(); 

  const now = new Date();

  const enrichedTests = tests.map(t => {
    if (t.isActive && !t.isEnded && t.startTime) {
      const elapsedMin = (now - new Date(t.startTime)) / 60000;
      if (elapsedMin >= t.duration) {
        t.isActive = false;
        t.isEnded = true;
      }
    }
    return t;
  });

  res.set("Cache-Control", "no-store");
  res.render("tests", { tests: enrichedTests, currUser: req.user });
});

app.get("/read", isLoggedIn,async (req, res) => {
  if (!req.user) return res.redirect("/login");
  const flashcards = await Flashcard.find();
  res.render("read", { flashcards, currUser: req.user });
});

app.get("/test/:id", isLoggedIn,async (req, res) => {
  if (!req.user) return res.redirect("/login");

const test = await Test.findById(req.params.id)
  .populate("questions.questionId");

if (!test) return res.send("Test not found");

// SHUFFLE QUESTIONS HERE
test.questions = shuffleArray(test.questions);

  //  IMPORTANT: Create a COPY so DB is NOT modified
  let questions = [...test.questions];

  // SHUFFLE (Fisher-Yates - best method)
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  // timing logic unchanged
  const now = Date.now();
  const start = test.startTime ? new Date(test.startTime).getTime() : 0;
  const duration = test.duration * 60 * 1000;
  const elapsed = now - start;

  if (!test.isActive && !test.isEnded)
    return res.send("❌ Test not started yet");

  if (test.isEnded || elapsed >= duration)
    return res.send("❌ Test has ended");

  const alreadyDone = await Result.findOne({
    testId: test._id,
    userId: req.user._id
  });

  if (alreadyDone) {
  req.flash("error", "❌ You have already attempted this test");
  return res.redirect("/tests");
}

  const remainingTime = Math.max(
    0,
    Math.floor((start + duration - now) / 1000)
  );

  if (remainingTime <= 0)
    return res.send("❌ Test time expired");
    function shuffleArray(arr) {
  return arr
    .map(value => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}
  // SEND SHUFFLED QUESTIONS ONLY
  res.render("startTest", {
    test: {
      ...test.toObject(),
      questions
    },
    currUser: req.user,
    remainingTime
  });
});


app.post("/submit-test",isLoggedIn, async (req, res) => {
  try {
    if (!req.user) return res.redirect("/login");

    const { testId, answers } = req.body;
    console.log("SUBMIT — testId:", testId);
    console.log("SUBMIT — body keys:", Object.keys(req.body));
    console.log("SUBMIT — answers type:", typeof answers);
    console.log("SUBMIT — answers:", JSON.stringify(answers));
    const test = await Test.findById(testId);
    if (!test) return res.send("Invalid test");

    const already = await Result.findOne({ testId: testId.toString(), userId: req.user._id });
    if (already) return res.send("❌ Already submitted");

    // Server-side time check
    const now = Date.now();
    if (!test.startTime) {
  return res.send("❌ Test has not started");
}

const start = new Date(test.startTime).getTime();
    const duration = test.duration * 60 * 1000;
    if (now - start > duration + 30000) {
      return res.send("⏰ Time ended");
    }

    let totalScore = 0;
    let totalMarks = 0;

  for (let q of test.questions) {
  totalMarks += q.marks;

  const qId = q.questionId._id?.toString() || q.questionId.toString();
  const flashcard = await Flashcard.findById(qId);
  if (!flashcard) continue;

  const userAnswer = normalizeText(answers?.[qId] || "");
  const correctAnswer = normalizeText(flashcard.answer || "");

  const keywords = Array.isArray(flashcard.keywords)
    ? flashcard.keywords
    : [];

  let matchPercent = 0;
  let matchCount = 0;
  let keywordCount = keywords.length;

  //  CASE 1: Keyword-based question
  if (keywords.length > 0) {

    matchCount = keywords.filter(k =>
      matchKeyword(userAnswer, k)
    ).length;

    matchPercent = (matchCount / keywordCount) * 100;
  }

  //  CASE 2: Number-based question
  else {

    const cleanNumber = (str) =>
      (str || "").replace(/[^\d]/g, "");

    const userDigits = cleanNumber(userAnswer);
    const correctDigits = cleanNumber(correctAnswer);

    if (userDigits && userDigits === correctDigits) {
      matchPercent = 100;
    }
  }

  //  SCORING RULE
  let awarded = 0;

  if (matchPercent >= 75) {
    awarded = q.marks;
  } else if (matchPercent >= 50) {
    awarded = q.marks * 0.5;
  }

  totalScore += awarded;

  //  SAFE LOGS (NO ERRORS NOW)
  console.log(`Q: ${flashcard.question}`);
  console.log(`keywords: [${keywords.join(", ")}]`);
  console.log(`userAnswer: "${userAnswer}"`);
  console.log(`matched: ${matchCount}/${keywordCount}`);
  console.log(`percent: ${Math.round(matchPercent)}%`);
  console.log(`awarded: ${awarded}/${q.marks}`);
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


// CHECK ANSWER (live % match during exam)

app.post("/check-answer", isLoggedIn, async (req, res) => {
  try {

    const { questionId, answer } = req.body;

    const flashcard = await Flashcard.findById(questionId);

    if (!flashcard) {
      return res.json({
        percent: 0,
        error: "Flashcard not found"
      });
    }

    console.log(
      "CHECK-ANSWER — stored keywords:",
      flashcard.keywords
    );

    //  REPLACE OLD BLOCK WITH THIS
    if (!flashcard.keywords || flashcard.keywords.length === 0) {

      const autoKw = extractKeywords(flashcard.answer || "");

      console.log(
        "CHECK-ANSWER — no stored keywords, using auto:",
        autoKw
      );

      const userAnswer = normalizeText(answer || "");
      const correctAnswer = normalizeText(flashcard.answer || "");

      // CASE 1: auto keywords exist
      if (autoKw.length > 0) {

        await Flashcard.findByIdAndUpdate(questionId, {
          keywords: autoKw
        });

        const match = autoKw.filter(k =>
          matchKeyword(userAnswer, k)
        ).length;

        const percent = Math.round(
          (match / autoKw.length) * 100
        );

        return res.json({ percent });
      }

      // CASE 2: no keywords → digit compare
      const userDigits =
        (userAnswer.match(/\d+/g) || []).join("");

      const correctDigits =
        (correctAnswer.match(/\d+/g) || []).join("");

      console.log(
        "CHECK-ANSWER — digit compare:",
        userDigits,
        correctDigits
      );

      if (
        userDigits &&
        correctDigits &&
        userDigits === correctDigits
      ) {
        return res.json({ percent: 100 });
      }

      return res.json({ percent: 0 });
    }

    // NORMAL KEYWORD MATCHING
    const userAnswer = normalizeText(answer || "");

    let match = 0;

    for (const k of flashcard.keywords) {
      if (matchKeyword(userAnswer, k)) {
        match++;
      }
    }

    const percent = Math.round(
      (match / flashcard.keywords.length) * 100
    );

    console.log(
      `CHECK-ANSWER: ${match}/${flashcard.keywords.length} = ${percent}%`
    );

    res.json({ percent });

  } catch (err) {

    console.log("CHECK-ANSWER ERROR:", err);

    res.json({ percent: 0 });

  }
});

app.post("/admin/start-test/:id",isLoggedIn, isAdmin, async (req, res) => {
  await Test.findByIdAndUpdate(req.params.id, {
    isActive: true,
    isEnded: false,
    startTime: new Date()
  });
  res.redirect("/tests");
});

app.post("/admin/end-test/:id",isLoggedIn, isAdmin, async (req, res) => {
  await Test.findByIdAndUpdate(req.params.id, {
    isActive: false,
    isEnded: true
  });
  res.redirect("/tests");
});

app.delete("/admin/delete-test/:id",isLoggedIn, isAdmin, async (req, res) => {
  await Test.findByIdAndDelete(req.params.id);
  await Result.deleteMany({ testId: req.params.id });
  req.flash("success", "Test deleted");
  res.redirect("/tests");
});

app.get("/admin/results", isLoggedIn, isAdmin, async (req, res) => {
  const tests = await Test.find({}).populate("questions.questionId");
  const results = await Result.find({})
    .populate("userId")
    .populate("testId");

  const users = await User.find({ username: { $ne: "admin" } });

  const grouped = {};

  for (let test of tests) {
    const subject = test.subject || "Unknown";

    if (!grouped[subject]) grouped[subject] = {};

    if (!grouped[subject][test.name]) {
      grouped[subject][test.name] = {
        testId: test._id,
        duration: test.duration,
        isEnded: test.isEnded,
        rows: []
      };
    }

    for (let user of users) {

      const result = results.find(r => {
        if (!r.userId || !r.testId) return false;

        return (
          r.userId._id &&
          r.testId._id &&
          r.userId._id.toString() === user._id.toString() &&
          r.testId._id.toString() === test._id.toString()
        );
      });

      grouped[subject][test.name].rows.push({
        username: user.username,
        score: result?.score ?? null,
        total: result?.total ?? null,
        attempted: !!result
      });
    }
  }

  res.render("adminResults", { grouped });
});


app.get(
  "/admin/results/pdf/:testId",
  isLoggedIn,
  isAdmin,
  async (req, res) => {

    try {

      const test = await Test.findById(req.params.testId);

      if (!test) {
        return res.send("Test not found");
      }

      const users = await User.find({
        username: { $ne: "admin" }
      });

      const results = await Result.find({
        testId: req.params.testId
      }).populate("userId");

      const doc = new PDFDocument({
        margin: 40,
        size: "A4"
      });

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${test.name}-results.pdf"`
      );

      doc.pipe(res);

     

      doc
        .fontSize(20)
        .text("TEST RESULT REPORT", {
          align: "center"
        });

      doc.moveDown();

      doc.fontSize(12);

      doc.text(`Test Name : ${test.name}`);
      doc.text(`Subject   : ${test.subject}`);
      doc.text(`Duration  : ${test.duration} Minutes`);

      doc.moveDown(2);

      // TABLE HEADER
  

      let y = doc.y;

      doc.rect(40, y, 520, 25).stroke();

      doc.moveTo(80, y).lineTo(80, y + 25).stroke();
      doc.moveTo(260, y).lineTo(260, y + 25).stroke();
      doc.moveTo(340, y).lineTo(340, y + 25).stroke();
      doc.moveTo(420, y).lineTo(420, y + 25).stroke();
      doc.moveTo(480, y).lineTo(480, y + 25).stroke();

      doc.text("No", 50, y + 7);
      doc.text("Student", 90, y + 7);
      doc.text("Score", 280, y + 7);
      doc.text("Total", 360, y + 7);
      doc.text("%", 440, y + 7);
      doc.text("Status", 490, y + 7);

      y += 25;

      // TABLE ROWS
     

      users.forEach((user, index) => {

        const result = results.find(r =>
          r.userId &&
          r.userId._id.toString() === user._id.toString()
        );

        const score =
          result?.score ?? "";

        const total =
          result?.total ?? "";

        const percentage =
          result && result.total > 0
            ? Math.round(
                (result.score / result.total) * 100
              ) + "%"
            : "";

        const status =
          result
            ? "Submitted"
            : "NA";

        // New page if needed
        if (y > 730) {

          doc.addPage();

          y = 50;

          doc.rect(40, y, 520, 25).stroke();

          doc.moveTo(80, y).lineTo(80, y + 25).stroke();
          doc.moveTo(260, y).lineTo(260, y + 25).stroke();
          doc.moveTo(340, y).lineTo(340, y + 25).stroke();
          doc.moveTo(420, y).lineTo(420, y + 25).stroke();
          doc.moveTo(480, y).lineTo(480, y + 25).stroke();

          doc.text("No", 50, y + 7);
          doc.text("Student", 90, y + 7);
          doc.text("Score", 280, y + 7);
          doc.text("Total", 360, y + 7);
          doc.text("%", 440, y + 7);
          doc.text("Status", 490, y + 7);

          y += 25;
        }

        // Row border
        doc.rect(40, y, 520, 25).stroke();

        // Vertical lines
        doc.moveTo(80, y).lineTo(80, y + 25).stroke();
        doc.moveTo(260, y).lineTo(260, y + 25).stroke();
        doc.moveTo(340, y).lineTo(340, y + 25).stroke();
        doc.moveTo(420, y).lineTo(420, y + 25).stroke();
        doc.moveTo(480, y).lineTo(480, y + 25).stroke();

        // Data
        doc.text(index + 1, 50, y + 7);

        doc.text(
          user.username,
          90,
          y + 7,
          {
            width: 160
          }
        );

        doc.text(
          String(score),
          280,
          y + 7
        );

        doc.text(
          String(total),
          360,
          y + 7
        );

        doc.text(
          percentage,
          440,
          y + 7
        );

        doc.text(
          status,
          490,
          y + 7
        );

        y += 25;

      });

      doc.end();

    } catch (err) {

      console.log(err);

      res.status(500).send(err.message);

    }

  }
);
app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }

    req.flash("success", "Logged out successfully");

    res.redirect("/login");
  });
});

app.get("/profile",isLoggedIn, async (req, res) => {
   if(!req.user){
    req.flash(
      "error",
      "Please login first"
    );

    return res.redirect("/login");
  }
  if(!req.user){
    return res.redirect("/login");
  }

  const user = await User.findById(req.user._id);

  let totalMarks = 0;
  let totalTests = 0;

  const recentResults = await Result.find({
    userId: req.user._id
  })
  .populate("testId")
  .sort({ submittedAt: -1 })
  .limit(5);

  recentResults.forEach(r => {
    totalMarks += r.score || 0;
  });

  totalTests = recentResults.length;

  res.render("profile.ejs", {
    user,
    recentResults,
    totalMarks,
    totalTests
  });

});
app.get("/settings",isLoggedIn, async (req, res) => {
   if(!req.user){
    req.flash(
      "error",
      "Please login first"
    );

    return res.redirect("/login");
  }

  if (!req.user) {
    return res.redirect("/login");
  }

  const user = await User.findById(req.user._id);

  let results = [];
  let totalMarks = 0;
  let totalTests = 0;

  // DON'T SHOW FOR ADMIN
  if (user.username !== "admin") {

    results = await Result.find({
      userId: user._id
    })
    .populate("testId")
    .sort({ submittedAt: -1 });

    totalTests = results.length;

    results.forEach(r => {
      totalMarks += r.score || 0;
    });

  }

  res.render("settings.ejs", {
    user,
    results,
    totalTests,
    totalMarks
  });

});

app.post("/change-password", isLoggedIn,async (req, res) => {

  try{

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id);

    await user.changePassword(
      currentPassword,
      newPassword
    );

    await user.save();

   

    res.redirect("/settings");

  }
  catch(err){

    console.log(err);

    req.flash(
      "error",
      "Current password incorrect "
    );

    res.redirect("/settings");

  }

});


// app.get("/admin/uploads", (req, res) => {
//   const uploadPath = path.join(__dirname, "uploads");

//   let files = fs.existsSync(uploadPath)
//     ? fs.readdirSync(uploadPath)
//     : [];

//   res.set("Cache-Control", "no-store");
//   res.render("uploads", { files });
// });

app.get("/admin/uploads/users", isLoggedIn, isAdmin, (req, res) => {
  const dir = path.join(__dirname, "uploads", "users");

  console.log("LOOKING INSIDE:", dir);

  let files = [];

  if (fs.existsSync(dir)) {
    files = fs.readdirSync(dir);

    // IMPORTANT: remove system junk files if any
    files = files.filter(f => f.endsWith(".xlsx"));
  }

  console.log("FOUND FILES:", files);

  res.set("Cache-Control", "no-store");
  res.render("uploadsUsers", { files });
});


app.get("/admin/uploads/flashcards", isLoggedIn, isAdmin, (req, res) => {

  const dir = path.join(__dirname, "uploads/flashcards");

  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir)
    : [];

  res.render("uploadsFlashcards", { files });

});


app.delete("/delete-user-upload/:filename", isLoggedIn, isAdmin, async (req, res) => {
  try {

    let deletedUsers = 0;

    const filePath = path.join(
      __dirname,
      "uploads/users",
      req.params.filename
    );

    if (!fs.existsSync(filePath)) {
      req.flash("error", "File not found");
      return res.redirect("/admin/uploads/users");
    }

    // 1. Read Excel file
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheet]);

    for (let row of data) {

      const username = (
        row.username ||
        row.Username ||
        row.USERNAME ||
        row["user name"] ||
        row["User Name"]
      )?.toString().trim();

      if (!username) continue;

      // 2. DELETE FROM DB
      const result = await User.deleteOne({ username });

      if (result.deletedCount > 0) {
        deletedUsers++;
      }
    }

    // 3. Delete file from disk
    fs.unlinkSync(filePath);

    req.flash(
      "success",
      `User upload deleted. Users removed from DB: ${deletedUsers}`
    );

    res.redirect("/admin/uploads/users");

  } catch (err) {
    console.log(err);
    req.flash("error", err.message);
    res.redirect("/admin/uploads/users");
  }
});


app.delete("/delete-flashcard-upload/:filename", isLoggedIn, isAdmin, async (req, res) => {
  try {

    const filePath = path.join(
      __dirname,
      "uploads/flashcards",
      req.params.filename
    );

    if (!fs.existsSync(filePath)) {
      req.flash("error", "File not found");
      return res.redirect("/admin/uploads/flashcards");
    }

    // 1. Read Excel BEFORE deleting file
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheet]);

    let deletedCount = 0;

    for (let row of data) {

      const question = row.question || row.Question || row.QUESTION;

      if (!question) continue;

      // 2. Delete matching flashcards from DB
      const result = await Flashcard.deleteMany({ question });

      deletedCount += result.deletedCount || 0;
    }

    // 3. Delete file from disk
    fs.unlinkSync(filePath);

    req.flash(
      "success",
      `Flashcard upload deleted. DB removed: ${deletedCount}`
    );

    res.redirect("/admin/uploads/flashcards");

  } catch (err) {
    console.log(err);
    req.flash("error", err.message);
    res.redirect("/admin/uploads/flashcards");
  }
});
// app.get("/help", (req, res) => {
//   res.render("help.ejs");
// });
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use((req, res, next) => {
    next(new ExpressError(404, "Page not found"));
});
app.use((err, req, res, next) => {
    let { statusCode = 500, message = "something went wrong" } = err;
    res.status(statusCode).render("error.ejs", { err });
});
app.listen(5000, "0.0.0.0", () => {
    console.log("Server running on port 5000");
});