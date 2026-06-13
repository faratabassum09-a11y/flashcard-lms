const express    = require("express");
const router     = express.Router();
const isLoggedIn = require("../middleware/isLoggedIn");
const isAdmin    = require("../middleware/isAdmin");
const testController = require("../controllers/testController");

router.get("/tests",          isLoggedIn,          testController.getTests);
router.post("/create-test",   isLoggedIn, isAdmin, testController.createTest);
router.get("/test/:id",       isLoggedIn,          testController.getStartTest);
router.post("/submit-test",   isLoggedIn,          testController.submitTest);
router.post("/log-event",     isLoggedIn,          testController.logEvent);

module.exports = router;