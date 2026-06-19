module.exports.getLogin = (req, res) => {
  res.render("users/login.ejs");
};

module.exports.postLogin = (req, res) => {
  if (!req.user) return res.redirect("/login");
  return req.user.username === "admin"
    ? res.redirect("/admin")
    : res.redirect("/dashboard");
};

module.exports.getLogout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "Logged out successfully");
    res.redirect("/login");
  });
};