
const mongoose = require("mongoose");

const Device = require("./device.model");
const CameraShare = require("./cameraShare.model");

const EXPIRY_CHECK_INTERVAL = 60 * 1000;

// Prevent overlapping executions in the same server process.
let isProcessing = false;

/**
 * Process expired camera invitations.
 * Runs every minute.
 */
const processExpiredInvitations = async () => {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    const expiredInvitations = await CameraShare.find({
      status: "pending",
      expiresAt: {
        $ne: null,
        $lte: new Date(),
      },
    })
      .select("_id deviceId")
      .sort({ expiresAt: 1 })
      .limit(100)
      .lean();

    for (const item of expiredInvitations) {
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          // Recheck invitation inside the transaction.
          const invitation = await CameraShare.findOneAndUpdate(
            {
              _id: item._id,
              deviceId: item.deviceId,
              status: "pending",
              expiresAt: {
                $ne: null,
                $lte: new Date(),
              },
            },
            {
              $set: {
                status: "revoked",
              },
            },
            {
              session,
              returnDocument: "after",
              runValidators: true,
            }
          );

          // Another process may already have handled it.
          if (!invitation) {
            return;
          }

          // Release the reserved member slot exactly once.
          const updatedDevice = await Device.findOneAndUpdate(
            {
              _id: invitation.deviceId,
              memberSlotsUsed: { $gt: 0 },
            },
            {
              $inc: {
                memberSlotsUsed: -1,
              },
            },
            {
              session,
              returnDocument: "after",
              runValidators: true,
            }
          );

          if (!updatedDevice) {
            throw new Error(
              "Member slot counter inconsistency detected"
            );
          }
        });

      } catch (error) {
        console.error(
          `Invitation expiry failed (${item._id}):`,
          error.message
        );
      } finally {
        await session.endSession();
      }
    }
  } catch (error) {
    console.error(
      "Camera Invitation Expiry Job Error:",
      error.message
    );
  } finally {
    isProcessing = false;
  }
};

/**
 * Start the invitation expiry scheduler.
 */
const startCameraShareExpiryJob = () => {
  console.log("Camera Share Expiry Job started.");

  // Run once at startup.
  processExpiredInvitations();

  // Check every minute.
  const interval = setInterval(
    processExpiredInvitations,
    EXPIRY_CHECK_INTERVAL
  );

  interval.unref();

  return interval;
};

module.exports = {
  startCameraShareExpiryJob,
};
