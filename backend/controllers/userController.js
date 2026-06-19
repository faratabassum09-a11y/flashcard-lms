const User   = require("../models/user");
const Result = require("../models/result");

module.exports.getProfile = async (req, res) => {
  const user          = await User.findById(req.user._id);
  const recentResults = await Result.find({ userId: req.user._id })
    .populate("testId").sort({ submittedAt: -1 }).limit(5);
  let totalMarks = 0;
  recentResults.forEach(r => { totalMarks += r.score || 0; });
  res.render("profile.ejs", { user, recentResults, totalMarks, totalTests: recentResults.length });
};

module.exports.getSettings = async (req, res) => {
  const user = await User.findById(req.user._id);
  let results = [], totalMarks = 0, totalTests = 0;
  if (user.username !== "admin") {
    results    = await Result.find({ userId: user._id }).populate("testId").sort({ submittedAt: -1 });
    totalTests = results.length;
    results.forEach(r => { totalMarks += r.score || 0; });
  }
  res.render("settings.ejs", { user, results, totalTests, totalMarks });
};

module.exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    await user.changePassword(currentPassword, newPassword);
    await user.save();
    req.flash("success", "Password changed successfully");
    res.redirect("/settings");
  } catch (err) {
    req.flash("error", "Current password incorrect");
    res.redirect("/settings");
  }
};