
const Device = require("../modules/devices/device.model");
const CameraShare = require("../modules/devices/cameraShare.model");

/**
 * Authorize a user before allowing camera room access.
 *
 * Owners get full access.
 * Active members require the live_view permission.
 */
const cameraSocketAuth = async (socket, next) => {
  try {
    const deviceId = socket.requestedCameraId;

    // Validate camera device ID.
    if (
      typeof deviceId !== "string" ||
      !deviceId.trim()
    ) {
      return next(new Error("Camera device ID is required"));
    }

    // Find an active and paired camera.
    const device = await Device.findOne({
      deviceId: deviceId.trim(),
      isPaired: true,
      status: { $ne: "disabled" },
    });

    // Reject unavailable cameras.
    if (!device) {
      return next(
        new Error("Camera not found or unavailable")
      );
    }

    // Allow the camera owner.
    if (device.ownerId.equals(socket.user._id)) {
      socket.cameraAccess = {
        deviceId: device.deviceId,
        deviceObjectId: device._id,
        role: "owner",
        permissions: [
          "live_view",
          "manage_camera",
          "share_camera",
        ],
      };

      return next();
    }

    // Verify active member permission.
    const share = await CameraShare.findOne({
      deviceId: device._id,
      memberId: socket.user._id,
      status: "active",
      permissions: "live_view",
    });

    // Reject unauthorized members.
    if (!share) {
      return next(
        new Error(
          "You do not have permission to access this camera"
        )
      );
    }

    // Attach authorized camera access to socket.
    socket.cameraAccess = {
      deviceId: device.deviceId,
      deviceObjectId: device._id,
      role: "member",
      permissions: share.permissions,
    };

    return next();
  } catch (error) {
    console.error(
      "Camera Socket Authorization Error:",
      error.message
    );

    return next(error);
  }
};

module.exports = cameraSocketAuth;
