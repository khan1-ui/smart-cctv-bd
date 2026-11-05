
const User = require("./user.model");

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Validate required fields
    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    // Validate password length
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password must be between 8 and 128 characters",
      });
    }

    // Check whether email already exists
    const existingUser = await User.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    // Handle duplicate email race condition
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    next(error);
  }
};

const jwt = require("jsonwebtoken");

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user and explicitly include password
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    // Check credentials
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check account status
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account is disabled",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id.toString(),
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get authenticated user profile
// @route   GET /api/users/me
// @access  Private
const getMyProfile = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Profile fetched successfully",
    data: {
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    },
  });
};


module.exports = {
  registerUser,
  loginUser,
  getMyProfile,
};

