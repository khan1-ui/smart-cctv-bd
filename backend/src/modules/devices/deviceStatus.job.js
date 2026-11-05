const Device = require("./device.model");

const HEARTBEAT_TIMEOUT_MS = 90 * 1000;
const CHECK_INTERVAL_MS = 15 * 1000;

/**
 * Automatically mark inactive devices as offline and notify their owners.
 * @param {import("socket.io").Server} io - Socket.IO server instance.
 */
const startDeviceStatusMonitor = (io) => {
  console.log("Device Status Monitor Started");

  if (!io) {
    console.error("Device Status Monitor: Socket.IO instance is required");
    return null;
  }

  let isRunning = false;

  const monitor = setInterval(async () => {
    if (isRunning) return;

    isRunning = true;

    try {
      const cutoffTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

      // Find online devices whose heartbeat has expired.
      const inactiveDevices = await Device.find({
        status: "online",
        $or: [
          { lastHeartbeat: { $lt: cutoffTime } },
          { lastHeartbeat: null },
        ],
      })
        .select("_id deviceId deviceName ownerId")
        .lean();

      for (const candidate of inactiveDevices) {
        // Atomically recheck the heartbeat so a fresh heartbeat is not
        // overwritten by this monitor after the initial query.
        const device = await Device.findOneAndUpdate(
          {
            _id: candidate._id,
            status: "online",
            $or: [
              { lastHeartbeat: { $lt: cutoffTime } },
              { lastHeartbeat: null },
            ],
          },
          {
            $set: {
              status: "offline",
            },
          },
          {
            returnDocument: "after",
          }
        );

        if (!device) continue;

        console.log(`Device marked offline: ${device.deviceId}`);

        // Send the status change only to the authenticated owner's room.
        io.to(`user:${device.ownerId.toString()}`).emit("camera:status", {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          status: "offline",
          lastSeen: device.lastSeen,
          lastHeartbeat: device.lastHeartbeat,
        });
      }
    } catch (error) {
      console.error("Device Status Monitor Error:", error.message);
    } finally {
      isRunning = false;
    }
  }, CHECK_INTERVAL_MS);

  monitor.unref();
  return monitor;
};

module.exports = startDeviceStatusMonitor;
