const express    = require("express");
const router     = express.Router();
const multer     = require("multer");
const isLoggedIn = require("../middleware/isLoggedIn");
const isAdmin    = require("../middleware/isAdmin");
const adminController = require("../controllers/adminController");

const upload = multer({ storage: multer.memoryStorage() });

router.get("/admin",                          isLoggedIn, isAdmin, adminController.getAdmin);
router.post("/upload-users",                  isLoggedIn, isAdmin, upload.single("file"), adminController.uploadUsers);
router.get("/admin/uploads",                  isLoggedIn, isAdmin, adminController.getUploads);
router.get("/admin/uploads/view/:id",         isLoggedIn, isAdmin, adminController.viewUpload);
router.delete("/admin/uploads/delete/:id",    isLoggedIn, isAdmin, adminController.deleteUpload);
router.get("/admin/results",                  isLoggedIn, isAdmin, adminController.getResults);
router.get("/admin/results/pdf/:testId",      isLoggedIn, isAdmin, adminController.downloadResultPDF);
router.post("/admin/start-test/:id",          isLoggedIn, isAdmin, adminController.startTest);
router.post("/admin/end-test/:id",            isLoggedIn, isAdmin, adminController.endTest);
router.delete("/admin/delete-test/:id",       isLoggedIn, isAdmin, adminController.deleteTest);

module.exports = router;