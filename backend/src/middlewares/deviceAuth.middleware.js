
const crypto = require("crypto");
const Device = require("../modules/devices/device.model");

/**
 * Authenticate registered camera devices.
 */
const deviceAuth = async (req, res, next) => {
  try {
    const deviceId = req.headers["x-device-id"];
    const deviceSecret = req.headers["x-device-secret"];

    if (
      typeof deviceId !== "string" ||
      typeof deviceSecret !== "string" ||
      !deviceId ||
      !deviceSecret
    ) {
      return res.status(401).json({
        success: false,
        message: "Device credentials are required",
      });
    }

    const device = await Device.findOne({
      deviceId,
    }).select("+deviceSecretHash");

    if (!device) {
      return res.status(401).json({
        success: false,
        message: "Invalid device credentials",
      });
    }

    if (device.status === "disabled") {
      return res.status(403).json({
        success: false,
        message: "This device has been disabled",
      });
    }

    // Generate hash from received secret.
    const providedHash = crypto
      .createHash("sha256")
      .update(deviceSecret, "utf8")
      .digest();

    // Retrieve stored hash.
    const storedHash = Buffer.from(
      device.deviceSecretHash,
      "hex"
    );
    // Verify credentials.
    const isValid =
      /^[a-f0-9]{64}$/i.test(device.deviceSecretHash) &&
      storedHash.length === providedHash.length &&
      crypto.timingSafeEqual(providedHash, storedHash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid device credentials",
      });
    }

    req.device = device;

    next();
  } catch (error) {
    console.error(
      "Device Authentication Error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Device authentication failed",
    });
  }
};

module.exports = deviceAuth;
