
const express = require("express");
const rateLimit = require("../../middlewares/rateLimit.middleware");

const router = express.Router();

const deviceAuth = require("../../middlewares/deviceAuth.middleware");
const { protect } = require("../../middlewares/auth.middleware");
const { checkCameraAccess,} = require("../../middlewares/cameraAccess.middleware");
const {
  generatePairingCode,
  registerDevice,
  getDeviceProfile,
  sendHeartbeat,
  getMyDevices,
  getCameraDetails,
  disableDevice,
  enableDevice,
  rotateDeviceSecret,
} = require("./device.controller");

const {
  inviteCameraMember,
  acceptCameraInvitation,
  removeCameraMember,
   getCameraMembers,
   cancelCameraInvitation,
   getSharedCameras,
   getCameraInvitations,
} = require("./cameraShare.controller");

// User authentication routes
router.post("/pairing/generate", protect, rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many pairing codes requested. Please wait." }), generatePairingCode);

// Camera registration using pairing code
router.post("/register", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many pairing attempts. Please wait and try again." }), registerDevice);

// Device authentication routes
router.get("/me", deviceAuth, getDeviceProfile);
router.post("/heartbeat", deviceAuth, sendHeartbeat);
// Get all cameras owned by authenticated user.
router.get("/", protect, getMyDevices);
// Owner can disable or enable their camera.
router.patch("/:deviceId/disable", protect, disableDevice);
router.patch("/:deviceId/enable", protect, enableDevice);
// Owner can rotate the camera device secret.
router.patch( "/:deviceId/rotate-secret", protect, rotateDeviceSecret);
// Camera sharing requires User JWT
router.post("/:deviceId/share", protect, inviteCameraMember);
// Accept camera invitation
router.post("/share/:invitationId/accept", protect, acceptCameraInvitation);
router.get("/shared", protect, getSharedCameras);
// Get camera details for owner or authorized member.
router.get(
  "/:deviceId",
  protect,
  checkCameraAccess("live_view"),
  getCameraDetails
);
// Get all camera invitations and history (Owner only)
router.get(
  "/:deviceId/invitations",
  protect,
  getCameraInvitations
);
// Owner can remove an active member or cancel an invitation.
router.delete(
  "/:deviceId/members/:memberId",
  protect,
  removeCameraMember
);
// Get camera members (Owner only)
router.get("/:deviceId/members", protect, getCameraMembers);
router.delete(
  "/:deviceId/invitations/:invitationId",
  protect,
  cancelCameraInvitation
);


module.exports = router;
