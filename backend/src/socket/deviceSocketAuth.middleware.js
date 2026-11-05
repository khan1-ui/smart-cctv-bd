
const crypto = require("crypto");
const Device = require("../modules/devices/device.model");

/**
 * Authenticate registered camera devices using Device ID and Secret.
 * @access Private
 */
const deviceSocketAuth = async (socket, next) => {
  try {
    const { deviceId, deviceSecret } = socket.handshake.auth || {};

    // Validate device credentials.
    if (
      typeof deviceId !== "string" ||
      typeof deviceSecret !== "string" ||
      !deviceId.trim() ||
      !deviceSecret
    ) {
      return next(new Error("Device credentials are required"));
    }

    // Find registered and paired device.
    const device = await Device.findOne({
      deviceId: deviceId.trim(),
      isPaired: true,
    }).select("+deviceSecretHash");

    if (!device || !device.ownerId) {
      return next(new Error("Invalid device credentials"));
    }

    // Reject disabled devices.
    if (device.status === "disabled") {
      return next(new Error("This device has been disabled"));
    }

    // Generate hash from provided device secret.
    const providedHash = crypto
      .createHash("sha256")
      .update(deviceSecret, "utf8")
      .digest();

    // Convert stored hexadecimal hash into Buffer.
    const storedHash = Buffer.from(device.deviceSecretHash, "hex");

    // Validate hash format and compare securely.
    const isValid =
      /^[a-f0-9]{64}$/i.test(device.deviceSecretHash) &&
      storedHash.length === providedHash.length &&
      crypto.timingSafeEqual(providedHash, storedHash);

    if (!isValid) {
      return next(new Error("Invalid device credentials"));
    }

    // Attach authenticated device to socket.
    socket.device = device;

    next();
  } catch (error) {
    console.error("Device Socket Authentication Error:", error.message);

    return next(new Error("Device authentication failed"));
  }
};

module.exports = deviceSocketAuth;
