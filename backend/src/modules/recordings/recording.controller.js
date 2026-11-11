const mongoose = require("mongoose");
const Device = require("../devices/device.model");
const Recording = require("./recording.model");
const CameraShare = require("../devices/cameraShare.model");

const canAccess = async (device, userId, permission = "recordings_view") => {
  if (device.ownerId.equals(userId)) return true;
  const share = await CameraShare.findOne({
    deviceId: device._id, memberId: userId, status: "active", permissions: permission,
  }).select("_id");
  return Boolean(share);
};

const listRecordings = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await Device.findOne({ deviceId, isPaired: true, status: { $ne: "disabled" } });
    if (!device || !(await canAccess(device, req.user._id))) {
      return res.status(404).json({ success: false, message: "Camera not found or recording access denied" });
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const filter = { device: device._id, status: "available" };
    if (req.query.from || req.query.to) {
      filter.startedAt = {};
      if (req.query.from && !Number.isNaN(Date.parse(req.query.from))) filter.startedAt.$gte = new Date(req.query.from);
      if (req.query.to && !Number.isNaN(Date.parse(req.query.to))) filter.startedAt.$lte = new Date(req.query.to);
    }
    const recordings = await Recording.find(filter)
      .select("deviceId fileName mimeType sizeBytes durationSeconds startedAt endedAt expiresAt status storageType createdAt")
      .sort({ startedAt: -1 }).limit(limit).lean();
    res.json({ success: true, data: { recordings, total: recordings.length } });
  } catch (error) { next(error); }
};

const createRecordingMetadata = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { fileName, mimeType = "video/mp4", sizeBytes, durationSeconds, startedAt, endedAt, expiresAt, storageType = "device_local" } = req.body || {};
    if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 180 ||
        !Number.isFinite(sizeBytes) || sizeBytes < 0 ||
        !Number.isFinite(durationSeconds) || durationSeconds < 0 ||
        !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt)) ||
        new Date(endedAt) <= new Date(startedAt) ||
        !["device_local", "hardware_local", "remote"].includes(storageType)) {
      return res.status(400).json({ success: false, message: "Invalid recording metadata" });
    }
    const device = await Device.findOne({ deviceId, isPaired: true, ownerId: req.user._id });
    if (!device) return res.status(404).json({ success: false, message: "Camera not found or owner access required" });
    const recording = await Recording.create({
      device: device._id, deviceId, ownerId: req.user._id, fileName: fileName.trim(),
      mimeType, sizeBytes, durationSeconds, startedAt: new Date(startedAt), endedAt: new Date(endedAt),
      expiresAt: expiresAt && Number.isFinite(Date.parse(expiresAt)) ? new Date(expiresAt) : null, storageType,
    });
    return res.status(201).json({ success: true, message: "Recording metadata saved", data: { recording } });
  } catch (error) { next(error); }
};


const createDeviceRecordingMetadata = async (req, res, next) => {
  try {
    const device = req.device;
    if (req.params.deviceId !== device.deviceId) {
      return res.status(403).json({ success: false, message: "Device identity mismatch" });
    }
    const { fileName, mimeType = "video/mp4", sizeBytes, durationSeconds, startedAt, endedAt, expiresAt, storageType = "device_local" } = req.body || {};
    if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 180 ||
        !Number.isFinite(sizeBytes) || sizeBytes < 0 ||
        !Number.isFinite(durationSeconds) || durationSeconds < 0 ||
        !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt)) ||
        new Date(endedAt) <= new Date(startedAt) ||
        !["device_local", "hardware_local", "remote"].includes(storageType)) {
      return res.status(400).json({ success: false, message: "Invalid recording metadata" });
    }
    const recording = await Recording.create({
      device: device._id, deviceId: device.deviceId, ownerId: device.ownerId,
      fileName: fileName.trim(), mimeType, sizeBytes, durationSeconds,
      startedAt: new Date(startedAt), endedAt: new Date(endedAt),
      expiresAt: expiresAt && Number.isFinite(Date.parse(expiresAt)) ? new Date(expiresAt) : null,
      storageType,
    });
    return res.status(201).json({ success: true, message: "Device recording metadata saved", data: { recordingId: recording._id } });
  } catch (error) { next(error); }
};

const deleteRecordingMetadata = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.recordingId)) {
      return res.status(400).json({ success: false, message: "Invalid recording ID" });
    }
    const recording = await Recording.findOneAndUpdate(
      { _id: req.params.recordingId, ownerId: req.user._id, status: "available" },
      { $set: { status: "deleted" } }, { new: true }
    );
    if (!recording) return res.status(404).json({ success: false, message: "Recording not found" });
    return res.json({ success: true, message: "Recording metadata marked as deleted" });
  } catch (error) { next(error); }
};

module.exports = { listRecordings, createRecordingMetadata, createDeviceRecordingMetadata, deleteRecordingMetadata };
