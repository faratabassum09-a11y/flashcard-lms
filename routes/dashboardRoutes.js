const express     = require("express");
const router      = express.Router();
const isLoggedIn  = require("../middleware/isLoggedIn");
const dashboardController = require("../controllers/dashboardController");

router.get("/dashboard", isLoggedIn, dashboardController.getDashboard);

module.exports = router;