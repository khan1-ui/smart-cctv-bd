const mongoose = require("mongoose");
const crypto = require("crypto");
const Pairing = require("./pairing.model");
const Device = require("./device.model");
const CameraShare = require("./cameraShare.model"); 
const generateDeviceId = require("../../utils/generateDeviceId");
const { clearCameraRoom } = require("../../socket/cameraRoom.service");

/**
 * Disconnect all active sockets belonging to a camera device.
 */
const disconnectDeviceSockets = (deviceNamespace, deviceId) => {
  if (!deviceNamespace) return;

  const targetSocketIds = [];

  for (const socket of deviceNamespace.sockets.values()) {
    if (socket.device?.deviceId === deviceId) {
      targetSocketIds.push(socket.id);
    }
  }

  for (const socketId of targetSocketIds) {
    const socket = deviceNamespace.sockets.get(socketId);

    if (socket) {
      socket.disconnect(false);
    }
  }
};

/**
 * Generate a secure one-time pairing code.
 * @route POST /api/devices/pairing/generate
 * @access Private (Authenticated User)
 */
const generatePairingCode = async (req, res) => {
  try {
    // Generate a cryptographically secure 6-digit code.
    const code = crypto.randomInt(100000, 1000000).toString();

    // Store only the hashed pairing code.
    const codeHash = crypto
      .createHash("sha256")
      .update(code)
      .digest("hex");

    const pairing = await Pairing.create({
      codeHash,
      ownerId: req.user._id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return res.status(201).json({
      success: true,
      message: "Pairing code generated successfully",
      data: {
        pairingId: pairing._id,
        pairingCode: code,
        expiresAt: pairing.expiresAt,
      },
    });
  } catch (error) {
    console.error("Pairing Code Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to generate pairing code",
    });
  }
};


/**
 * Register a camera device using a valid pairing code.
 * @route POST /api/devices/register
 * @access Public (Device Registration)
 */
const registerDevice = async (req, res) => {
  let session;

  try {
    const { pairingCode, deviceName } = req.body;

    // Validate request fields.
    if (
      typeof pairingCode !== "string" ||
      typeof deviceName !== "string" ||
      !pairingCode ||
      !deviceName.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Pairing code and device name are required",
      });
    }

    if (!/^\d{6}$/.test(pairingCode)) {
      return res.status(400).json({
        success: false,
        message: "Invalid pairing code format",
      });
    }

    if (deviceName.trim().length > 50) {
      return res.status(400).json({
        success: false,
        message: "Device name must be within 50 characters",
      });
    }

    // Hash the provided pairing code.
    const codeHash = crypto
      .createHash("sha256")
      .update(pairingCode)
      .digest("hex");

    // Generate unique device credentials.
    const deviceId = generateDeviceId();
    const deviceSecret = crypto.randomBytes(32).toString("hex");

    const deviceSecretHash = crypto
      .createHash("sha256")
      .update(deviceSecret)
      .digest("hex");
    session = await mongoose.startSession();

    let registeredDevice = null;

    await session.withTransaction(async () => {
      // Atomically claim the unused and unexpired pairing code.
      const pairing = await Pairing.findOneAndUpdate(
        {
          codeHash,
          isUsed: false,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            isUsed: true,
          },
        },
        {
          session,
          returnDocument: "after",
          runValidators: true,
        }
      );

      if (!pairing) {
        const error = new Error(
          "Invalid, expired or already used pairing code"
        );
        error.statusCode = 400;
        throw error;
      }

      // Ensure that the pairing code has a valid owner.
      if (!pairing.ownerId) {
        const error = new Error(
          "Pairing code is not associated with an owner"
        );
        error.statusCode = 400;
        throw error;
      }

      // Create the paired camera device.
      const devices = await Device.create(
        [
          {
            deviceId,
            deviceName: deviceName.trim(),
            deviceType: "mobile_camera",
            deviceSecretHash,
            ownerId: pairing.ownerId,
            status: "offline",
            isPaired: true,
            memberSlotsUsed: 0,
          },
        ],
        { session }
      );

      registeredDevice = devices[0];
    });

    return res.status(201).json({
      success: true,
      message: "Camera registered successfully",
      data: {
        deviceId: registeredDevice.deviceId,
        deviceName: registeredDevice.deviceName,
        deviceSecret,
        status: registeredDevice.status,
        isPaired: registeredDevice.isPaired,
      },
    });
  } catch (error) {
    console.error("Device Registration Error:", error.message);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Device registration conflict",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Device registration failed",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};


/**
 * Get authenticated camera device information.
 */
const getDeviceProfile = async (req, res) => {
  try {
    const device = req.device;

    return res.status(200).json({
      success: true,
      message: "Device authentication successful",
      data: {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        status: device.status,
        isPaired: device.isPaired,
        lastSeen: device.lastSeen,
      },
    });
  } catch (error) {
    console.error("Device Profile Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve device profile",
    });
  }
};

/**
 * Receive heartbeat from an authenticated camera device.
 */
const sendHeartbeat = async (req, res) => {
  try {
    const device = req.device;
    const now = new Date();
    const previousStatus = device.status;

    await Device.updateOne(
      { _id: device._id },
      {
        $set: {
          status: "online",
          lastSeen: now,
          lastHeartbeat: now,
        },
      }
    );

    // Notify the owner only when the camera transitions to online.
    if (previousStatus !== "online") {
      const io = req.app.get("io");

      if (io) {
        io.to(`user:${device.ownerId.toString()}`).emit(
          "camera:status",
          {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            status: "online",
            lastSeen: now,
            lastHeartbeat: now,
          }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Heartbeat received successfully",
      data: {
        deviceId: device.deviceId,
        status: "online",
        lastHeartbeat: now,
      },
    });
  } catch (error) {
    console.error("Heartbeat Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to process heartbeat",
    });
  }
};
/**
 * @desc    Get all cameras owned by authenticated user
 * @route   GET /api/devices
 * @access  Private (Authenticated User)
 */
const getMyDevices = async (req, res, next) => {
  try {
    const devices = await Device.find({
      ownerId: req.user._id,
      isPaired: true,
    })
      .select(
        "deviceId deviceName deviceType status isPaired lastSeen lastHeartbeat createdAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Camera list fetched successfully",
      data: {
        cameras: devices,
        total: devices.length,
      },
    });
  } catch (error) {
    next(error);
  }
};
/**
 * Get camera details for an authorized user.
 * @route GET /api/devices/:deviceId
 * @access Private (Owner or Active Member)
 */
const getCameraDetails = async (req, res, next) => {
  try {
    const device = req.device;

    return res.status(200).json({
      success: true,
      message: "Camera details fetched successfully",
      data: {
        camera: {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
          status: device.status,
          isPaired: device.isPaired,
          lastSeen: device.lastSeen,
          lastHeartbeat: device.lastHeartbeat,
        },
        access: {
          role: req.cameraAccess.role,
          permissions: req.cameraAccess.permissions,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Disable a camera device
 * @route   PATCH /api/devices/:deviceId/disable
 * @access  Private (Owner only)
 */
const disableDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOneAndUpdate(
      {
        deviceId,
        ownerId: req.user._id,
        isPaired: true,
        status: { $ne: "disabled" },
      },
      {
        $set: {
          status: "disabled",
          lastHeartbeat: null,
          lastSeen: null,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Camera not found or already disabled",
      });
    }

    const io = req.app.get("io");
    const deviceNamespace = req.app.get("deviceNamespace");

    // Remove all connected users from the camera room.
    await clearCameraRoom(io, deviceId);

    // Disconnect only the device namespace socket.
    disconnectDeviceSockets(deviceNamespace, deviceId);

    // Notify the owner that the camera has been disabled.
    if (io) {
      io.to(`user:${device.ownerId.toString()}`).emit(
        "camera:status",
        {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          status: "disabled",
          lastSeen: device.lastSeen,
          lastHeartbeat: device.lastHeartbeat,
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Camera disabled successfully",
      data: {
        deviceId: device.deviceId,
        status: device.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Enable a disabled camera device
 * @route   PATCH /api/devices/:deviceId/enable
 * @access  Private (Owner only)
 */
const enableDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOneAndUpdate(
      {
        deviceId,
        ownerId: req.user._id,
        isPaired: true,
        status: "disabled",
      },
      {
        $set: {
          status: "offline",
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Camera not found or not disabled",
      });
    }

    // Notify the owner that the camera is enabled but still offline.
    const io = req.app.get("io");

    if (io) {
      io.to(`user:${device.ownerId.toString()}`).emit(
        "camera:status",
        {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          status: "offline",
          lastSeen: device.lastSeen,
          lastHeartbeat: device.lastHeartbeat,
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Camera enabled successfully",
      data: {
        deviceId: device.deviceId,
        status: device.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Rotate camera device secret
 * @route   PATCH /api/devices/:deviceId/rotate-secret
 * @access  Private (Owner only)
 */
const rotateDeviceSecret = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    // Generate a cryptographically secure device secret.
    const newDeviceSecret = crypto.randomBytes(32).toString("hex");

    // Hash the new device secret before storing it.
    const newDeviceSecretHash = crypto
      .createHash("sha256")
      .update(newDeviceSecret, "utf8")
      .digest("hex");

    // Update credentials only for the authenticated owner.
    const device = await Device.findOneAndUpdate(
      {
        deviceId,
        ownerId: req.user._id,
        isPaired: true,
        status: { $ne: "disabled" },
      },
      {
        $set: {
          deviceSecretHash: newDeviceSecretHash,
          status: "offline",
          lastHeartbeat: null,
          lastSeen: null,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Camera not found or unavailable",
      });
    }

    // Disconnect all existing sockets using old credentials.
    const deviceNamespace = req.app.get("deviceNamespace");

    disconnectDeviceSockets(deviceNamespace, deviceId);

    return res.status(200).json({
      success: true,
      message: "Device secret rotated successfully",
      data: {
        deviceId: device.deviceId,
        deviceSecret: newDeviceSecret,
        status: device.status,
      },
    });
  } catch (error) {
    next(error);
  }
};


/**
 * Rename a camera owned by the authenticated user.
 */
const renameDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { deviceName } = req.body || {};
    if (typeof deviceName !== "string" || !deviceName.trim() || deviceName.trim().length > 50) {
      return res.status(400).json({ success: false, message: "Device name must be between 1 and 50 characters" });
    }
    const device = await Device.findOneAndUpdate(
      { deviceId, ownerId: req.user._id, isPaired: true },
      { $set: { deviceName: deviceName.trim() } },
      { new: true, runValidators: true }
    );
    if (!device) return res.status(404).json({ success: false, message: "Camera not found" });
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${device.ownerId}`).emit("camera:renamed", { deviceId, deviceName: device.deviceName });
    }
    return res.json({ success: true, message: "Camera renamed successfully", data: { deviceId, deviceName: device.deviceName } });
  } catch (error) { next(error); }
};

/**
 * Permanently remove an owned camera and its sharing/recording metadata.
 * Media files remain on the camera storage and must be removed by its device agent.
 */
const removeDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await Device.findOneAndDelete({ deviceId, ownerId: req.user._id });
    if (!device) return res.status(404).json({ success: false, message: "Camera not found" });
    await Promise.all([
      CameraShare.deleteMany({ deviceId: device._id }),
      require("../recordings/recording.model").deleteMany({ device: device._id }),
    ]);
    const io = req.app.get("io");
    const deviceNamespace = req.app.get("deviceNamespace");
    await clearCameraRoom(io, deviceId);
    disconnectDeviceSockets(deviceNamespace, deviceId);
    if (io) io.to(`user:${device.ownerId}`).emit("camera:removed", { deviceId });
    return res.json({ success: true, message: "Camera removed successfully" });
  } catch (error) { next(error); }
};

/**
 * Export the new controller.
 */
module.exports = {
  generatePairingCode,
  registerDevice,
  getDeviceProfile,
  sendHeartbeat,
  getMyDevices,
  getCameraDetails,
  disableDevice,
  enableDevice,
  rotateDeviceSecret,
  renameDevice,
  removeDevice,
};
