const express    = require("express");
const router     = express.Router();
const passport   = require("passport");
const authController = require("../controllers/authController");

router.get("/login", authController.getLogin);
router.post("/login",
  passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }),
  authController.postLogin
);
router.get("/logout", authController.getLogout);

module.exports = router;