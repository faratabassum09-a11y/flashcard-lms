const User      = require("../models/user");
const Test      = require("../models/test");
const Result    = require("../models/result");
const Flashcard = require("../models/flashcard");
const Upload    = require("../models/upload");
const xlsx      = require("xlsx");
const PDFDocument = require("pdfkit");

module.exports.getAdmin = async (req, res) => {
  const flashcards = await Flashcard.find({}).lean();
  const subjects   = [...new Set(flashcards.map(f => f.subject))];
  res.render("users/admin", { flashcards, subjects });
};

module.exports.uploadUsers = async (req, res) => {
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

    await Upload.create({ filename: req.file.originalname, type: "users", rows: data });
    req.flash("success", `Users created: ${created}, skipped: ${skipped}`);
    res.redirect("/admin");
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/admin");
  }
};

module.exports.getUploads = async (req, res) => {
  const userUploads      = await Upload.find({ type: "users"      }).sort({ uploadedAt: -1 }).lean();
  const flashcardUploads = await Upload.find({ type: "flashcards" }).sort({ uploadedAt: -1 }).lean();
  res.render("adminUploads", { userUploads, flashcardUploads });
};

module.exports.viewUpload = async (req, res) => {
  const uploadDoc = await Upload.findById(req.params.id).lean();
  if (!uploadDoc) {
    req.flash("error", "Upload not found");
    return res.redirect("/admin/uploads");
  }
  res.render("adminUploadView", { uploadDoc });
};

module.exports.deleteUpload = async (req, res) => {
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
    req.flash("error", err.message);
    res.redirect("/admin/uploads");
  }
};

module.exports.getResults = async (req, res) => {
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
};

module.exports.downloadResultPDF = async (req, res) => {
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
    res.status(500).send(err.message);
  }
};

module.exports.startTest = async (req, res) => {
  await Test.findByIdAndUpdate(req.params.id, { isActive: true, isEnded: false, startTime: new Date() });
  res.redirect("/tests");
};

module.exports.endTest = async (req, res) => {
  await Test.findByIdAndUpdate(req.params.id, { isActive: false, isEnded: true });
  res.redirect("/tests");
};

module.exports.deleteTest = async (req, res) => {
  await Test.findByIdAndDelete(req.params.id);
  await Result.deleteMany({ testId: req.params.id });
  req.flash("success", "Test deleted");
  res.redirect("/tests");
};