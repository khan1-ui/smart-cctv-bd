
const mongoose = require("mongoose");

const Device = require("./device.model");
const CameraShare = require("./cameraShare.model");
const User = require("../users/user.model");
const {removeUserFromCameraRoom,} = require("../../socket/cameraRoom.service");
/**
 * Send a camera sharing invitation securely.
 * @route POST /api/devices/:deviceId/share
 * @access Private (Camera Owner)
 */

const inviteCameraMember = async (req, res) => {
  let session;

  try {
    const { deviceId } = req.params;
    const { email } = req.body;

    // Validate email.
    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Member email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Set invitation expiry to 24 hours from creation.
    const invitationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    );

    session = await mongoose.startSession();

    let result = null;

    await session.withTransaction(async () => {
      // Verify camera ownership.
      const device = await Device.findOne({
        deviceId,
        ownerId: req.user._id,
        isPaired: true,
        status: { $ne: "disabled" },
      }).session(session);

      if (!device) {
        const error = new Error(
          "Camera not found or access denied"
        );
        error.statusCode = 404;
        throw error;
      }

      // Find the invited user.
      const member = await User.findOne({
        email: normalizedEmail,
        isActive: true,
      }).session(session);

      if (!member) {
        const error = new Error(
          "Registered member account not found"
        );
        error.statusCode = 404;
        throw error;
      }

      // Prevent owner from inviting themselves.
      if (member._id.equals(req.user._id)) {
        const error = new Error("You cannot invite yourself");
        error.statusCode = 400;
        throw error;
      }

      // Check existing invitation before reserving a slot.
      const existingShare = await CameraShare.findOne({
        deviceId: device._id,
        memberId: member._id,
      }).session(session);

      // Prevent duplicate pending or active invitations.
      if (
        existingShare &&
        ["pending", "active"].includes(existingShare.status)
      ) {
        const error = new Error(
          "This user already has a pending or active invitation"
        );
        error.statusCode = 409;
        throw error;
      }

      // Reserve one of the two member slots.
      const reservedDevice = await Device.findOneAndUpdate(
        {
          _id: device._id,
          ownerId: req.user._id,
          memberSlotsUsed: { $lt: 2 },
        },
        {
          $inc: { memberSlotsUsed: 1 },
        },
        {
          session,
          returnDocument: "after",
          runValidators: true,
        }
      );

      if (!reservedDevice) {
        const error = new Error(
          "Maximum of 2 camera members reached"
        );
        error.statusCode = 409;
        throw error;
      }

      let invitation;

      if (existingShare) {
        // Reactivate a previously revoked invitation.
        invitation = await CameraShare.findOneAndUpdate(
          {
            _id: existingShare._id,
            status: "revoked",
          },
          {
            $set: {
              ownerId: req.user._id,
              status: "pending",
              permissions: ["live_view"],
              expiresAt: invitationExpiresAt,
              acceptedAt: null,
            },
          },
          {
            session,
            returnDocument: "after",
            runValidators: true,
          }
        );

        if (!invitation) {
          const error = new Error(
            "Invitation could not be created"
          );
          error.statusCode = 409;
          throw error;
        }
      } else {
        // Create a new invitation.
        const [createdInvitation] = await CameraShare.create(
          [
            {
              deviceId: device._id,
              ownerId: req.user._id,
              memberId: member._id,
              status: "pending",
              permissions: ["live_view"],
              expiresAt: invitationExpiresAt,
              acceptedAt: null,
            },
          ],
          { session }
        );

        invitation = createdInvitation;
      }

      // Store response data after successful transaction operations.
      result = {
        invitationId: invitation._id,
        deviceId: device.deviceId,
        cameraName: device.deviceName,
        member: {
          id: member._id,
          name: member.name,
          email: member.email,
        },
        status: invitation.status,
        permissions: invitation.permissions,
        expiresAt: invitation.expiresAt,
        remainingMemberSlots: 2 - reservedDevice.memberSlotsUsed,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Camera invitation sent successfully",
      data: result,
    });
  } catch (error) {
    console.error("Camera Invitation Error:", error.message);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This user already has a pending or active invitation",
      });
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to send camera invitation",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};


/**
 * Accept a camera sharing invitation securely.
 * @route POST /api/devices/share/:invitationId/accept
 * @access Private (Invited Member)
 */
const acceptCameraInvitation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { invitationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(invitationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invitation ID",
      });
    }

    let result = null;

    await session.withTransaction(async () => {
      // Find the pending invitation belonging to this user.
      const invitation = await CameraShare.findOne({
          _id: invitationId,
          memberId: req.user._id,
          status: "pending",
          expiresAt: { $gt: new Date() },
        }).session(session);

      if (!invitation) {
        const error = new Error(
          "Invitation not found or already processed"
        );
        error.statusCode = 404;
        throw error;
      }

      // Verify camera availability before accepting.
      const device = await Device.findOne({
        _id: invitation.deviceId,
        isPaired: true,
        status: { $ne: "disabled" },
      })
        .select("deviceId deviceName status isPaired")
        .session(session);

      if (!device) {
        const error = new Error("Camera is no longer available");
        error.statusCode = 404;
        throw error;
      }

      // Atomically accept the invitation.
      const updatedInvitation = await CameraShare.findOneAndUpdate(
        {
          _id: invitation._id,
          memberId: req.user._id,
          status: "pending",
        },
        {
          $set: {
            status: "active",
            acceptedAt: new Date(),
          },
        },
        {
          returnDocument: "after",
          runValidators: true,
          session,
        }
      );

      if (!updatedInvitation) {
        const error = new Error(
          "Invitation could not be accepted"
        );
        error.statusCode = 409;
        throw error;
      }

      result = {
        invitationId: updatedInvitation._id,
        camera: device,
        status: updatedInvitation.status,
        permissions: updatedInvitation.permissions,
        acceptedAt: updatedInvitation.acceptedAt,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Camera invitation accepted successfully",
      data: result,
    });
  } catch (error) {
    console.error("Accept Invitation Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to accept camera invitation",
    });
  } finally {
    await session.endSession();
  }
};



/**
 * Remove a camera member or cancel a pending invitation.
 * @route DELETE /api/devices/:deviceId/members/:memberId
 * @access Private (Camera Owner)
 */
const removeCameraMember = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { deviceId, memberId } = req.params;

    // Validate member ID.
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid member ID",
      });
    }

    let result = null;

    await session.withTransaction(async () => {
      // Verify camera ownership.
      const device = await Device.findOne({
        deviceId,
        ownerId: req.user._id,
      }).session(session);

      if (!device) {
        const error = new Error("Camera not found or access denied");
        error.statusCode = 404;
        throw error;
      }

      // Find pending or active membership.
      const share = await CameraShare.findOne({
        deviceId: device._id,
        memberId,
        status: { $in: ["pending", "active"] },
      }).session(session);

      if (!share) {
        const error = new Error(
          "Member not found or access already revoked"
        );
        error.statusCode = 404;
        throw error;
      }

      // Revoke member access.
      share.status = "revoked";
      share.expiresAt = null;

      await share.save({ session });

      // Release exactly one reserved member slot.
      const updatedDevice = await Device.findOneAndUpdate(
        {
          _id: device._id,
          memberSlotsUsed: { $gt: 0 },
        },
        {
          $inc: { memberSlotsUsed: -1 },
        },
        {
          session,
          returnDocument: "after",
        }
      );

      if (!updatedDevice) {
        throw new Error(
          "Member slot counter inconsistency detected"
        );
      }

      result = {
        deviceId: device.deviceId,
        memberId,
        status: "revoked",
        remainingMemberSlots: 2 - updatedDevice.memberSlotsUsed,
      };
    });
  // Remove revoked member from the camera room.
    const io = req.app.get("io");

    await removeUserFromCameraRoom(
      io,
      result.deviceId,
      result.memberId
    );

// Send success response.
return res.status(200).json({
  success: true,
  message: "Camera member access revoked successfully",
  data: result,
});
  } catch (error) {
    console.error("Remove Camera Member Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to remove camera member",
    });
  } finally {
    await session.endSession();
  }
};
/**
 * @desc    Get all members of an owner's camera
 * @route   GET /api/devices/:deviceId/members
 * @access  Private (Camera Owner Only)
 */
const getCameraMembers = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    // Find camera owned by the authenticated user
    const device = await Device.findOne({
      deviceId,
      ownerId: req.user._id,
      isPaired: true,
    }).select("_id deviceId deviceName");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Camera not found or access denied",
      });
    }

    // Fetch camera members and populate safe user information
    const members = await CameraShare.find({
      deviceId: device._id,
    })
      .populate("memberId", "name email")
      .select("memberId status permissions acceptedAt createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Camera members fetched successfully",
      data: {
        camera: device,
        totalMembers: members.length,
        members,
      },
    });
  } catch (error) {
    next(error);
  }
};
/**
 * @desc    Cancel a pending camera invitation
 * @route   DELETE /api/devices/:deviceId/invitations/:invitationId
 * @access  Private (Camera Owner Only)
 */
const cancelCameraInvitation = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { deviceId, invitationId } = req.params;

    // Validate invitation ID
    if (!mongoose.Types.ObjectId.isValid(invitationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invitation ID",
      });
    }

    let result = null;

    await session.withTransaction(async () => {
      // Find camera owned by authenticated user
      const device = await Device.findOne({
        deviceId,
        ownerId: req.user._id,
        isPaired: true,
      }).session(session);

      if (!device) {
        result = { notFound: "camera" };
        return;
      }

      // Atomically revoke only a pending invitation
      const invitation = await CameraShare.findOneAndUpdate(
        {
          _id: invitationId,
          deviceId: device._id,
          ownerId: req.user._id,
          status: "pending",
        },
        {
          $set: {
            status: "revoked",
            expiresAt: null,
          },
        },
        {
          session,
          returnDocument: "after",
          runValidators: true,
        }
      );

      if (!invitation) {
        result = { notFound: "invitation" };
        return;
      }

      // Release the reserved member slot
      const updatedDevice = await Device.findOneAndUpdate(
        {
          _id: device._id,
          memberSlotsUsed: { $gt: 0 },
        },
        {
          $inc: { memberSlotsUsed: -1 },
        },
        {
          session,
          returnDocument: "after",
          runValidators: true,
        }
      );

      // Throwing an error rolls back both operations
      if (!updatedDevice) {
        const error = new Error(
          "Member slot counter inconsistency detected"
        );
        error.statusCode = 500;
        throw error;
      }

      result = {
        invitation,
        remainingMemberSlots: 2 - updatedDevice.memberSlotsUsed,
      };
    });

    if (result?.notFound === "camera") {
      return res.status(404).json({
        success: false,
        message: "Camera not found or access denied",
      });
    }

    if (result?.notFound === "invitation") {
      return res.status(404).json({
        success: false,
        message: "Pending invitation not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Camera invitation cancelled successfully",
      data: {
        invitationId: result.invitation._id,
        status: result.invitation.status,
        remainingMemberSlots: result.remainingMemberSlots,
      },
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};
/**
 * @desc    Get all cameras shared with the logged-in user
 * @route   GET /api/devices/shared
 * @access  Private (Authenticated User)
 */
const getSharedCameras = async (req, res, next) => {
  try {
    const sharedCameras = await CameraShare.find({
      memberId: req.user._id,
      status: "active",
    })
      .populate({
        path: "deviceId",
        select: "deviceId deviceName deviceType status isPaired lastSeen",
        match: {
          isPaired: true,
          status: { $ne: "disabled" },
        },
      })
      .populate("ownerId", "name email")
      .select("deviceId ownerId permissions acceptedAt")
      .sort({ acceptedAt: -1 })
      .lean();

    // Exclude shares whose camera is no longer available
    const availableCameras = sharedCameras.filter(
      (share) => share.deviceId !== null
    );

    return res.status(200).json({
      success: true,
      message: "Shared cameras fetched successfully",
      data: {
        totalCameras: availableCameras.length,
        cameras: availableCameras,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all camera invitations and sharing history
 * @route   GET /api/devices/:deviceId/invitations
 * @access  Private (Camera Owner Only)
 */
const getCameraInvitations = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    // Verify camera ownership.
    const device = await Device.findOne({
      deviceId,
      ownerId: req.user._id,
      isPaired: true,
    }).select("_id deviceId deviceName");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Camera not found or access denied",
      });
    }

    // Fetch all invitation records for this camera.
    const invitations = await CameraShare.find({
      deviceId: device._id,
    })
      .populate("memberId", "name email")
      .select(
        "memberId status permissions expiresAt acceptedAt createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    const now = new Date();

    // Determine the effective invitation status.
    const formattedInvitations = invitations.map((invitation) => {
      const expired =
        invitation.expiresAt &&
        new Date(invitation.expiresAt) <= now;

      let displayStatus = invitation.status;

      if (
        expired &&
        ["pending", "revoked"].includes(invitation.status)
      ) {
        displayStatus = "expired";
      }

      return {
        ...invitation,
        displayStatus,
        isExpired: Boolean(expired),
      };
    });

    return res.status(200).json({
      success: true,
      message: "Camera invitations fetched successfully",
      data: {
        camera: device,
        totalInvitations: formattedInvitations.length,
        invitations: formattedInvitations,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  inviteCameraMember,
  acceptCameraInvitation,
  removeCameraMember,
   getCameraMembers,
   cancelCameraInvitation,
   getSharedCameras,
   getCameraInvitations,
};
