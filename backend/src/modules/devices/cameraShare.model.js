
const mongoose = require("mongoose");

const cameraShareSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "active", "revoked"],
      default: "pending",
    },

    permissions: {
      type: [String],
      enum: ["live_view", "recordings_view"],
      default: ["live_view"],
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate sharing records for the same camera and user.
cameraShareSchema.index(
  { deviceId: 1, memberId: 1 },
  { unique: true }
);

// Quickly find all members of a camera.
cameraShareSchema.index({ deviceId: 1, status: 1 });

// Quickly find all cameras shared with a user.
cameraShareSchema.index({ memberId: 1, status: 1 });

module.exports = mongoose.model("CameraShare", cameraShareSchema);
