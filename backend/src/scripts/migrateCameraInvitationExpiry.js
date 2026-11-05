
require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("../config/database");

const CameraShare = require(
  "../modules/devices/cameraShare.model"
);

/**
 * Migrate existing pending invitations
 * to the 24-hour expiry system.
 */
const migrateInvitationExpiry = async () => {
  try {
    // Connect to MongoDB.
    await connectDB();

    // Find old pending invitations without expiry.
    const pendingInvitations = await CameraShare.find({
      status: "pending",
      expiresAt: null,
    }).select("_id createdAt");

    if (pendingInvitations.length === 0) {
      console.log("No invitations require migration.");
      return;
    }

    // Preserve the original invitation creation time.
    const operations = pendingInvitations.map((invitation) => {
      const expiryDate = new Date(
        invitation.createdAt.getTime() +
        24 * 60 * 60 * 1000
      );

      return {
        updateOne: {
          filter: {
            _id: invitation._id,
            status: "pending",
            expiresAt: null,
          },
          update: {
            $set: {
              expiresAt: expiryDate,
            },
          },
        },
      };
    });

    const result = await CameraShare.bulkWrite(operations);

    console.log("Invitation Expiry Migration Completed.");
    console.log("Matched Invitations:", result.matchedCount);
    console.log("Updated Invitations:", result.modifiedCount);

  } catch (error) {
    console.error("Migration Failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

migrateInvitationExpiry();
