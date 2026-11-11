
const jwt = require("jsonwebtoken");
const User = require("../modules/users/user.model");

// @desc    Protect routes using JWT
const protect = async (req, res, next) => {
  try {
    let token;

    // Read token from Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find authenticated user
    const user = await User.findById(decoded.userId).select("+tokenVersion");

    if (!user || !user.isActive || (decoded.tokenVersion ?? 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({
        success: false,
        message: "User not found or account disabled",
      });
    }

    // Attach user to request
    req.user = user;

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    next(error);
  }
};

module.exports = { protect };
