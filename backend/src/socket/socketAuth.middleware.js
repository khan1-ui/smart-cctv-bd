const jwt = require("jsonwebtoken");
const User = require("../modules/users/user.model");

/**
 * Authenticate user socket connections using JWT.
 * @access Private
 */
const socketUserAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    if (!process.env.JWT_SECRET) {
      return next(new Error("Authentication configuration error"));
    }

    // Verify JWT token.
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // Find authenticated user.
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return next(
        new Error("User not found or account disabled")
      );
    }

    // Attach authenticated user to socket.
    socket.user = user;

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return next(new Error("Invalid or expired token"));
    }

    console.error("Socket Authentication Error:", error.message);

    return next(new Error("Socket authentication failed"));
  }
};

module.exports = socketUserAuth;