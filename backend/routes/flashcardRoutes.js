const express     = require("express");
const router      = express.Router();
const multer      = require("multer");
const isLoggedIn  = require("../middleware/isLoggedIn");
const isAdmin     = require("../middleware/isAdmin");
const flashcardController = require("../controllers/flashcardController");

const upload = multer({ storage: multer.memoryStorage() });

router.get("/flashcards",        isLoggedIn,          flashcardController.getFlashcards);
router.post("/upload-flashcards",isLoggedIn, isAdmin, upload.single("file"), flashcardController.uploadFlashcards);
router.post("/check-answer",     isLoggedIn,          flashcardController.checkAnswer);

module.exports = router;