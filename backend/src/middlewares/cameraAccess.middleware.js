
const Device = require("../modules/devices/device.model");
const CameraShare = require("../modules/devices/cameraShare.model");

/**
 * Verify whether the authenticated user can access a camera.
 *
 * Owner gets full access.
 * Active members get only their assigned permissions.
 */
const checkCameraAccess = (requiredPermission = "live_view") => {
  return async (req, res, next) => {
    try {
      const { deviceId } = req.params;

      // Find the registered camera.
      const device = await Device.findOne({
        deviceId,
        isPaired: true,
        status: { $ne: "disabled" },
      });

      if (!device) {
        return res.status(404).json({
          success: false,
          message: "Camera not found or unavailable",
        });
      }

      // Camera owner has full access.
      if (device.ownerId.equals(req.user._id)) {
        req.device = device;
        req.cameraAccess = {
          role: "owner",
          permissions: ["live_view", "manage_camera", "share_camera"],
        };

        return next();
      }

      // Check active member access.
      const share = await CameraShare.findOne({
        deviceId: device._id,
        memberId: req.user._id,
        status: "active",
        permissions: requiredPermission,
      });

      if (!share) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to access this camera",
        });
      }

      req.device = device;
      req.cameraAccess = {
        role: "member",
        permissions: share.permissions,
      };

      next();
    } catch (error) {
      console.error("Camera Access Error:", error.message);
      next(error);
    }
  };
};

module.exports = { checkCameraAccess };
