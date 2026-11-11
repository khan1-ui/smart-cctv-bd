const express = require("express");
const { protect } = require("../../middlewares/auth.middleware");
const { listRecordings, createRecordingMetadata, deleteRecordingMetadata } = require("./recording.controller");
const router = express.Router();
router.use(protect);
router.get("/:deviceId", listRecordings);
router.post("/:deviceId", createRecordingMetadata);
router.delete("/:recordingId", deleteRecordingMetadata);
module.exports = router;
