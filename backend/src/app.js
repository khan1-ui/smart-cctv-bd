const express = require("express");
const cors = require("cors");
const rateLimit = require("./middlewares/rateLimit.middleware");

const deviceRoutes = require("./modules/devices/device.routes");
const userRoutes = require("./modules/users/user.routes");
const recordingRoutes = require("./modules/recordings/recording.routes");

const app = express();

// Render terminates TLS at its edge and forwards the original client IP.
if (process.env.TRUST_PROXY === "true" || process.env.RENDER === "true") {
  app.set("trust proxy", 1);
}

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(cors({
  origin(origin, callback) {
    // Permit non-browser clients without an Origin header (health checks/device apps).
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-Device-Secret"],
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb", parameterLimit: 100 }));

app.use("/api", rateLimit({ windowMs: 60_000, max: 120 }));

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Smart CCTV BD API is running!",
    environment: process.env.NODE_ENV || "development",
  });
});

app.use("/api/users", userRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/recordings", recordingRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: "Route not found" }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Origin is not allowed" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body is too large" });
  }
  console.error("API Error:", error.message);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message,
  });
});

module.exports = app;
