const User      = require("../models/user");
const Test      = require("../models/test");
const Result    = require("../models/result");
const Flashcard = require("../models/flashcard");

module.exports.getDashboard = async (req, res) => {
  const username = req.user.username;

  if (username === "admin") {
    const totalStudents   = await User.countDocuments({ username: { $ne: "admin" } });
    const totalTests      = await Test.countDocuments({});
    const activeTests     = await Test.countDocuments({ isActive: true, isEnded: false });
    const totalFlashcards = await Flashcard.countDocuments({});

    const upcomingTests = await Test.find({ isEnded: false })
      .sort({ isActive: -1, scheduledStart: 1 })
      .limit(5)
      .lean();

    return res.render("dashboard", {
      username,
      stats: { totalStudents, totalTests, activeTests, totalFlashcards, upcomingTests }
    });
  }

  const results = await Result.find({ userId: req.user._id })
    .populate("testId")
    .sort({ submittedAt: -1 });

  const totalTests = results.length;
  let totalMarks = 0, totalPossible = 0;
  results.forEach(r => {
    totalMarks    += r.score || 0;
    totalPossible += r.total || 0;
  });

  const avgScore = totalPossible > 0 ? Math.round((totalMarks / totalPossible) * 100) : 0;

  const attemptedTestIds = results.map(r => r.testId?._id?.toString()).filter(Boolean);
  const availableTests = await Test.countDocuments({
    isEnded: false,
    _id: { $nin: attemptedTestIds }
  });

  const recentResults = results.slice(0, 5);

  res.render("dashboard", {
    username,
    stats: {
      totalTests,
      totalMarks: Math.round(totalMarks * 10) / 10,
      avgScore,
      availableTests,
      recentResults
    }
  });
};