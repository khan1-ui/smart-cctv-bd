require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const socketUserAuth = require("./socket/socketAuth.middleware");
const deviceSocketAuth = require("./socket/deviceSocketAuth.middleware");
const cameraSocketAuth = require("./socket/cameraSocketAuth.middleware");

const app = require("./app");
const connectDB = require("./config/database");

const startDeviceStatusMonitor = require(
  "./modules/devices/deviceStatus.job"
);

const {
  startCameraShareExpiryJob,
} = require("./modules/devices/cameraShareExpiry.job");

const PORT = Number(process.env.PORT) || 5000;
const MAX_SIGNAL_BYTES = 256 * 1024;
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 256 * 1024,
  connectTimeout: 20_000,
});

app.set("io", io);

// Namespaces
const deviceNamespace = io.of("/devices");
app.set("deviceNamespace", deviceNamespace);

const getCameraRoom = (deviceId) => `camera:${deviceId}`;

const sendAck = (callback, payload) => {
  if (typeof callback === "function") callback(payload);
};

const validateDeviceId = (deviceId) =>
  typeof deviceId === "string" &&
  deviceId.trim().length > 0 &&
  deviceId.trim().length <= 128;

const isValidSignalObject = (value) => {
  if (!value || typeof value !== "object") return false;

  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <=
      MAX_SIGNAL_BYTES;
  } catch {
    return false;
  }
};

const authorizeViewerForCamera = async (socket, deviceId) => {
  if (!validateDeviceId(deviceId)) {
    throw new Error("Camera device ID is required");
  }

  socket.requestedCameraId = deviceId.trim();
  delete socket.cameraAccess;

  await new Promise((resolve, reject) => {
    cameraSocketAuth(socket, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  if (
    !socket.cameraAccess ||
    socket.cameraAccess.deviceId !== deviceId.trim() ||
    !socket.cameraAccess.permissions.includes("live_view")
  ) {
    throw new Error("Camera live-view access denied");
  }

  const roomName = getCameraRoom(deviceId.trim());

  if (!socket.rooms.has(roomName)) {
    throw new Error("Join the camera room before starting WebRTC");
  }

  return roomName;
};

const findConnectedDeviceSocket = (deviceId) => {
  for (const deviceSocket of deviceNamespace.sockets.values()) {
    if (
      deviceSocket.device?.deviceId === deviceId &&
      deviceSocket.connected
    ) {
      return deviceSocket;
    }
  }

  return null;
};

// ==========================================
// USER SOCKET NAMESPACE
// ==========================================

io.use(socketUserAuth);

io.on("connection", (socket) => {
  console.log(`User Socket Connected: ${socket.id}`);
  console.log(`Authenticated User: ${socket.user._id}`);

  socket.join(`user:${socket.user._id.toString()}`);

  // ========================================
  // CAMERA JOIN
  // ========================================

  socket.on("camera:join", async (deviceId, callback) => {
    let roomName = null;

    try {
      if (!validateDeviceId(deviceId)) {
        throw new Error("Camera device ID is required");
      }

      const requestedDeviceId = deviceId.trim();
      roomName = getCameraRoom(requestedDeviceId);

      delete socket.cameraAccess;
      socket.requestedCameraId = requestedDeviceId;

      await new Promise((resolve, reject) => {
        cameraSocketAuth(socket, (error) => {
          if (error) return reject(error);
          resolve();
        });
      });

      if (
        !socket.cameraAccess ||
        socket.cameraAccess.deviceId !== requestedDeviceId
      ) {
        throw new Error("Camera access denied");
      }

      if (
        process.env.NODE_ENV === "development" &&
        process.env.RACE_TEST_ENABLED === "true"
      ) {
        console.log("Race Condition Test Delay Started");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      await socket.join(roomName);

      // Re-check authorization after joining to prevent a race.
      await new Promise((resolve, reject) => {
        cameraSocketAuth(socket, (error) => {
          if (error) return reject(error);
          resolve();
        });
      });

      if (
        !socket.cameraAccess ||
        socket.cameraAccess.deviceId !== requestedDeviceId
      ) {
        throw new Error("Camera access denied");
      }

      console.log(`User ${socket.user._id} joined ${roomName}`);

      sendAck(callback, {
        success: true,
        message: "Camera room joined successfully",
      });
    } catch (error) {
      console.error("Camera Join Error:", error.message);

      if (roomName) {
        try {
          await socket.leave(roomName);
        } catch (leaveError) {
          console.error("Camera Room Cleanup Error:", leaveError.message);
        }
      }

      delete socket.cameraAccess;

      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  // ========================================
  // WEBRTC: OFFER (VIEWER -> DEVICE)
  // ========================================

  socket.on("webrtc:offer", async (payload, callback) => {
    try {
      const { deviceId, offer } = payload || {};

      if (!validateDeviceId(deviceId) || !isValidSignalObject(offer)) {
        throw new Error("A valid device ID and WebRTC offer are required");
      }

      await authorizeViewerForCamera(socket, deviceId.trim());

      const deviceSocket = findConnectedDeviceSocket(deviceId.trim());

      if (!deviceSocket) {
        throw new Error("Camera device is not connected");
      }

      deviceSocket.emit("webrtc:offer", {
        deviceId: deviceId.trim(),
        viewerSocketId: socket.id,
        offer,
      });

      sendAck(callback, {
        success: true,
        message: "WebRTC offer sent to camera device",
      });
    } catch (error) {
      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  // ========================================
  // WEBRTC: ICE CANDIDATE (VIEWER -> DEVICE)
  // ========================================

  socket.on("webrtc:ice-candidate", async (payload, callback) => {
    try {
      const { deviceId, candidate } = payload || {};

      if (
        !validateDeviceId(deviceId) ||
        !isValidSignalObject(candidate)
      ) {
        throw new Error("A valid device ID and ICE candidate are required");
      }

      await authorizeViewerForCamera(socket, deviceId.trim());

      const deviceSocket = findConnectedDeviceSocket(deviceId.trim());

      if (!deviceSocket) {
        throw new Error("Camera device is not connected");
      }

      deviceSocket.emit("webrtc:ice-candidate", {
        deviceId: deviceId.trim(),
        viewerSocketId: socket.id,
        candidate,
      });

      sendAck(callback, {
        success: true,
        message: "ICE candidate sent to camera device",
      });
    } catch (error) {
      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  // ========================================
  // WEBRTC: LEAVE
  // ========================================

  socket.on("webrtc:leave", async (payload, callback) => {
    try {
      const { deviceId } = payload || {};

      if (!validateDeviceId(deviceId)) {
        throw new Error("Camera device ID is required");
      }

      const roomName = getCameraRoom(deviceId.trim());

      if (!socket.rooms.has(roomName)) {
        throw new Error("You have not joined this camera");
      }

      const deviceSocket = findConnectedDeviceSocket(deviceId.trim());

      if (deviceSocket) {
        deviceSocket.emit("webrtc:leave", {
          deviceId: deviceId.trim(),
          viewerSocketId: socket.id,
        });
      }

      sendAck(callback, {
        success: true,
        message: "WebRTC leave signal sent",
      });
    } catch (error) {
      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  // ========================================
  // CAMERA LEAVE
  // ========================================

  socket.on("camera:leave", async (deviceId, callback) => {
    try {
      if (!validateDeviceId(deviceId)) {
        throw new Error("Camera device ID is required");
      }

      const normalizedDeviceId = deviceId.trim();
      const roomName = getCameraRoom(normalizedDeviceId);

      if (socket.rooms.has(roomName)) {
        const deviceSocket = findConnectedDeviceSocket(normalizedDeviceId);

        if (deviceSocket) {
          deviceSocket.emit("webrtc:leave", {
            deviceId: normalizedDeviceId,
            viewerSocketId: socket.id,
          });
        }
      }

      await socket.leave(roomName);

      if (socket.requestedCameraId === normalizedDeviceId) {
        delete socket.requestedCameraId;
        delete socket.cameraAccess;
      }

      console.log(`User ${socket.user._id} left ${roomName}`);

      sendAck(callback, {
        success: true,
        message: "Camera room left successfully",
      });
    } catch (error) {
      console.error("Camera Leave Error:", error.message);

      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`User Socket Disconnected: ${socket.id}`, reason);
  });
});

// ==========================================
// DEVICE SOCKET NAMESPACE
// ==========================================

deviceNamespace.use(deviceSocketAuth);

deviceNamespace.on("connection", (socket) => {
  const deviceId = socket.device.deviceId;
  const roomName = getCameraRoom(deviceId);
// ==========================================
// CAMERA FRAME STREAMING (JPEG RELAY)
// ==========================================

// ==========================================
// CAMERA FRAME STREAMING (JPEG RELAY)
// ==========================================

let frameCount = 0;
let windowStart = Date.now();


socket.on("camera:frame", (payload, ack) => {
  try {
    const { deviceId: payloadDeviceId, frame } = payload || {};

    if (payloadDeviceId !== socket.device.deviceId) {
      ack?.({ success: false, reason: "Invalid device ID" });
      return;
    }

    const isBinary =
      Buffer.isBuffer(frame) ||
      frame instanceof Uint8Array ||
      frame instanceof ArrayBuffer;

    if (!isBinary) {
      ack?.({ success: false, reason: "Invalid frame format" });
      return;
    }

    const frameSize = Buffer.isBuffer(frame)
      ? frame.length
      : frame.byteLength;

    if (frameSize === 0 || frameSize > 200 * 1024) {
      ack?.({ success: false, reason: "Invalid frame size" });
      return;
    }

    frameCount++;

    const viewerCount =
      io.sockets.adapter.rooms.get(roomName)?.size || 0;

    if (viewerCount > 0) {
      io.to(roomName).emit("camera:frame", {
        deviceId,
        frame,
        timestamp: Date.now(),
      });
    }

    // Confirm frame received by backend
    ack?.({
      success: true,
      receivedAt: Date.now(),
      frameSize,
      viewers: viewerCount,
      relayed: viewerCount > 0,
    });

    const now = Date.now();

    if (now - windowStart >= 5000) {
      console.log("[BACKEND CAMERA RELAY]", {
        FPS: (frameCount / ((now - windowStart) / 1000)).toFixed(2),
        viewers: viewerCount,
        totalFrames: frameCount,
      });

      frameCount = 0;
      windowStart = now;
    }

  } catch (error) {
    console.error("[CAMERA STREAM] Frame relay error:", error);

    ack?.({
      success: false,
      reason: "Backend processing error",
    });
  }
});

  console.log(`Device Socket Connected: ${socket.id}`);
  console.log(`Authenticated Device: ${deviceId}`);

  // Device joins only its own camera room in the /devices namespace.
  socket.join(roomName);

  // ========================================
  // WEBRTC: ANSWER (DEVICE -> VIEWER)
  // ========================================

  socket.on("webrtc:answer", async (payload, callback) => {
    try {
      const { deviceId: payloadDeviceId, viewerSocketId, answer } =
        payload || {};

      if (
        payloadDeviceId !== socket.device.deviceId ||
        typeof viewerSocketId !== "string" ||
        !isValidSignalObject(answer)
      ) {
        throw new Error("Invalid WebRTC answer payload");
      }

      const viewerSocket = io.sockets.sockets.get(viewerSocketId);

      if (
        !viewerSocket ||
        !viewerSocket.connected ||
        !viewerSocket.rooms.has(getCameraRoom(socket.device.deviceId))
      ) {
        throw new Error("Authorized camera viewer is no longer connected");
      }

      await authorizeViewerForCamera(
        viewerSocket,
        socket.device.deviceId
      );

      viewerSocket.emit("webrtc:answer", {
        deviceId: socket.device.deviceId,
        answer,
      });

      sendAck(callback, {
        success: true,
        message: "WebRTC answer sent to viewer",
      });
    } catch (error) {
      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  // ========================================
  // WEBRTC: ICE CANDIDATE (DEVICE -> VIEWER)
  // ========================================

  socket.on("webrtc:ice-candidate", async (payload, callback) => {
    try {
      const { deviceId: payloadDeviceId, viewerSocketId, candidate } =
        payload || {};

      if (
        payloadDeviceId !== socket.device.deviceId ||
        typeof viewerSocketId !== "string" ||
        !isValidSignalObject(candidate)
      ) {
        throw new Error("Invalid ICE candidate payload");
      }

      const viewerSocket = io.sockets.sockets.get(viewerSocketId);

      if (
        !viewerSocket ||
        !viewerSocket.connected ||
        !viewerSocket.rooms.has(getCameraRoom(socket.device.deviceId))
      ) {
        throw new Error("Authorized camera viewer is no longer connected");
      }

      await authorizeViewerForCamera(
        viewerSocket,
        socket.device.deviceId
      );

      viewerSocket.emit("webrtc:ice-candidate", {
        deviceId: socket.device.deviceId,
        candidate,
      });

      sendAck(callback, {
        success: true,
        message: "ICE candidate sent to viewer",
      });
    } catch (error) {
      sendAck(callback, {
        success: false,
        message: error.message,
      });
    }
  });

  // ========================================
  // WEBRTC: LEAVE (DEVICE RECEIVES)
  // ========================================

  socket.on("webrtc:leave", (payload, callback) => {
    const { deviceId: payloadDeviceId, viewerSocketId } = payload || {};

    if (
      payloadDeviceId !== socket.device.deviceId ||
      typeof viewerSocketId !== "string"
    ) {
      return sendAck(callback, {
        success: false,
        message: "Invalid WebRTC leave payload",
      });
    }

    socket.emit("webrtc:viewer-left", {
      deviceId: socket.device.deviceId,
      viewerSocketId,
    });

    sendAck(callback, {
      success: true,
      message: "Viewer leave signal received",
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`Device Socket Disconnected: ${socket.id}`, reason);
  });
});

 

// ==========================================
// START SERVER
// ==========================================

const startServer = async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error("JWT_SECRET must be configured with at least 32 characters");
    }

    await connectDB();

    startDeviceStatusMonitor(io);
    startCameraShareExpiryJob();

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`Smart CCTV BD Server listening on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error("Server Startup Failed:", error.message);
    process.exit(1);
  }
};

startServer();
