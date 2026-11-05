
const express = require("express");
const rateLimit = require("../../middlewares/rateLimit.middleware");
const router = express.Router();

const {
  registerUser,
  loginUser,
  getMyProfile,
} = require("./user.controller");

const  {protect} = require("../../middlewares/auth.middleware");

router.post("/register", rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }), registerUser);
router.post("/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many login attempts. Please wait before trying again." }), loginUser);

// Protected route
router.get("/me", protect, getMyProfile);

module.exports = router;
