const express    = require("express");
const router     = express.Router();
const isLoggedIn = require("../middleware/isLoggedIn");
const userController = require("../controllers/userController");

router.get("/profile",         isLoggedIn, userController.getProfile);
router.get("/settings",        isLoggedIn, userController.getSettings);
router.post("/change-password",isLoggedIn, userController.changePassword);

module.exports = router;