const mongoose = require("mongoose");

const recordingSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: "Device", required: true, index: true },
  deviceId: { type: String, required: true, trim: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  storageType: { type: String, enum: ["device_local", "hardware_local", "remote"], default: "device_local" },
  fileName: { type: String, required: true, trim: true, maxlength: 180 },
  filePath: { type: String, default: null, select: false },
  mimeType: { type: String, default: "video/mp4", maxlength: 100 },
  sizeBytes: { type: Number, required: true, min: 0 },
  durationSeconds: { type: Number, required: true, min: 0, max: 86400 },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, required: true },
  expiresAt: { type: Date, default: null, index: true },
  status: { type: String, enum: ["available", "deleted", "unavailable"], default: "available", index: true },
}, { timestamps: true });

recordingSchema.index({ device: 1, startedAt: -1 });
recordingSchema.index({ ownerId: 1, startedAt: -1 });
module.exports = mongoose.model("Recording", recordingSchema);
