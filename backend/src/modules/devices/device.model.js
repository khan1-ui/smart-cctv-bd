const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    deviceName: {
      type: String,
      required: true,
      trim: true,
    },

    deviceType: {
      type: String,
      enum: ["mobile_camera", "ip_camera"],
      default: "mobile_camera",
    },

    deviceSecretHash: {
      type: String,
      required: true,
      select: false,
    },

   ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: ["offline", "online", "disabled"],
      default: "offline",
    },

    isPaired: {
      type: Boolean,
      default: false,
    },

    lastSeen: {
      type: Date,
      default: null,
    },
    lastHeartbeat: {
      type: Date,
      default: null,
    },
    // Number of reserved member slots.
    // Pending invitations and active members both occupy a slot.
    memberSlotsUsed: {
      type: Number,
      default: 0,
      min: 0,
      max: 2,
    },
  },
  {
    timestamps: true,
  }
);
deviceSchema.index({ ownerId: 1 });
module.exports = mongoose.model("Device", deviceSchema);
