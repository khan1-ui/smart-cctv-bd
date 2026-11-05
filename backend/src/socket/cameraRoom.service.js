
/**
 * Remove a user from a specific camera room.
 */
const removeUserFromCameraRoom = async (io, deviceId, userId) => {
  const roomName = `camera:${deviceId}`;

  const sockets = await io.in(roomName).fetchSockets();

  for (const socket of sockets) {
    if (socket.user?._id?.toString() === userId.toString()) {
      await socket.leave(roomName);

      console.log(
        `User ${userId} removed from ${roomName}`
      );
    }
  }

  // Verify that the user has left the camera room.
  const remainingSockets = await io.in(roomName).fetchSockets();

  const userStillInRoom = remainingSockets.some(
    (socket) => socket.user?._id?.toString() === userId.toString()
  );

  console.log("Camera Room Removal Verification:", {
    deviceId,
    userId,
    userStillInRoom,
  });
};

/**
 * Remove all users from a specific camera room.
 */
const clearCameraRoom = async (io, deviceId) => {
  const roomName = `camera:${deviceId}`;

  const sockets = await io.in(roomName).fetchSockets();

  for (const socket of sockets) {
    await socket.leave(roomName);
  }
};

module.exports = {
  removeUserFromCameraRoom,
  clearCameraRoom,
};
