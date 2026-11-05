import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  authenticateCameraDevice,
  clearCameraDeviceCredentials,
  getCameraDeviceSocketConfig,
  getStoredCameraDeviceId,
  registerCameraDevice,
  sendCameraHeartbeat,
} from "../services/cameraDevice";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const monitorWebRTC = (pc, label) => {
  pc.addEventListener("iceconnectionstatechange", () => {
    console.log(`[${label}] ICE State:`, pc.iceConnectionState);
  });

  pc.addEventListener("connectionstatechange", () => {
    console.log(`[${label}] Connection State:`, pc.connectionState);
  });

  pc.addEventListener("signalingstatechange", () => {
    console.log(`[${label}] Signaling State:`, pc.signalingState);
  });

  pc.addEventListener("icegatheringstatechange", () => {
    console.log(`[${label}] Gathering State:`, pc.iceGatheringState);
  });

  pc.addEventListener("icecandidate", (event) => {
  if (event.candidate) {
    console.log(`[${label}] ICE Candidate:`, event.candidate.candidate);

    console.log(`[${label}] Candidate Details:`, {
      type: event.candidate.type,
      protocol: event.candidate.protocol,
      address: event.candidate.address,
      port: event.candidate.port,
    });
  } else {
    console.log(`[${label}] ICE Gathering Complete`);
  }
});

  pc.addEventListener("icecandidateerror", (event) => {
    console.error(`[${label}] ICE Candidate Error:`, {
      url: event.url,
      code: event.errorCode,
      message: event.errorText,
    });
  });

  pc.addEventListener("iceconnectionstatechange", async () => {
    if (pc.iceConnectionState !== "failed") return;

    const stats = await pc.getStats();

    stats.forEach((item) => {
      if (item.type === "candidate-pair") {
        console.log(`[${label}] Candidate Pair:`, item);
      }

      if (item.type === "local-candidate" ||
          item.type === "remote-candidate") {
        console.log(`[${label}] Candidate Detail:`, item);
      }
    });
  });
};

function CameraDevice() {
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState("My test Camera");
  const [deviceId, setDeviceId] = useState(getStoredCameraDeviceId() || "");
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking");
  const [cameraStatus, setCameraStatus] = useState("stopped");
  const [heartbeatStatus, setHeartbeatStatus] = useState("idle");
  const [socketStatus, setSocketStatus] = useState("disconnected");
  const [activeViewers, setActiveViewers] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const deviceSocketRef = useRef(null);
  // JPEG frame streaming refs
const frameCanvasRef = useRef(null);
const frameIntervalRef = useRef(null);
const frameInFlightRef = useRef(false);
  const peerConnectionsRef = useRef(new Map());
  const pendingIceCandidatesRef = useRef(new Map());

 const closePeerConnection = useCallback(
  (viewerSocketId, preservePendingCandidates = false) => {
    const pc = peerConnectionsRef.current.get(viewerSocketId);

    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();

      peerConnectionsRef.current.delete(viewerSocketId);

      setActiveViewers(peerConnectionsRef.current.size);
    }

    if (!preservePendingCandidates) {
      pendingIceCandidatesRef.current.delete(viewerSocketId);
    }
  },
  []
);

  const closeAllPeerConnections = useCallback(() => {
    for (const viewerSocketId of peerConnectionsRef.current.keys()) {
      const pc = peerConnectionsRef.current.get(viewerSocketId);
      if (pc) {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      }
    }
    peerConnectionsRef.current.clear();
    setActiveViewers(0);
  }, []);

 const stopCamera = useCallback(() => {
  // Stop JPEG frame streaming
  if (frameIntervalRef.current) {
    window.clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = null;
  }

  frameInFlightRef.current = false;

  closeAllPeerConnections();

  if (streamRef.current) {
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  if (videoRef.current) {
    videoRef.current.srcObject = null;
  }

  setCameraStatus("stopped");
}, [closeAllPeerConnections]);

  const verifySavedDevice = useCallback(async () => {
    const savedDeviceId = getStoredCameraDeviceId();

    if (!savedDeviceId) {
      setAuthStatus("unpaired");
      setDeviceId("");
      return;
    }

    setAuthStatus("checking");
    setError("");

    try {
      const profile = await authenticateCameraDevice();
      setDeviceInfo(profile);
      setDeviceId(profile.deviceId || savedDeviceId);
      setAuthStatus("authenticated");
      setNotice("Camera device authenticated successfully.");
    } catch (requestError) {
      setAuthStatus("failed");
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Device authentication failed."
      );
    }
  }, []);

  useEffect(() => {
    verifySavedDevice();

    return () => {
      closeAllPeerConnections();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (frameIntervalRef.current) {
  window.clearInterval(frameIntervalRef.current);
  frameIntervalRef.current = null;
}
    };
  }, [verifySavedDevice, closeAllPeerConnections]);

  // Device namespace Socket.IO connection and WebRTC signaling.
  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;

    let socket;
    let cancelled = false;

    try {
      const config = getCameraDeviceSocketConfig();
      socket = io(config.url, {
        auth: config.auth,
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      deviceSocketRef.current = socket;

      socket.on("connect", () => {
        if (!cancelled) setSocketStatus("connected");
      });

      socket.on("disconnect", () => {
        if (!cancelled) setSocketStatus("disconnected");
        closeAllPeerConnections();
      });

      socket.on("connect_error", (socketError) => {
        if (!cancelled) {
          setSocketStatus("error");
          setError(`Device Socket: ${socketError.message}`);
        }
      });

      socket.on("webrtc:offer", async ({ deviceId: incomingDeviceId, viewerSocketId, offer } = {}) => {
        if (
          !viewerSocketId ||
          !offer ||
          incomingDeviceId !== getStoredCameraDeviceId()
        ) {
          return;
        }

        const stream = streamRef.current;
        if (!stream || !stream.getTracks().some((track) => track.readyState === "live")) {
          setError("Dashboard requested video, but the phone camera is not running.");
          socket.emit("webrtc:device-error", {
            deviceId: incomingDeviceId,
            viewerSocketId,
            message: "Camera stream is not running.",
          });
          return;
        }

        try {
          closePeerConnection(viewerSocketId, true);

          const pc = new RTCPeerConnection(RTC_CONFIGURATION);
          monitorWebRTC(pc, "CAMERA");
          peerConnectionsRef.current.set(viewerSocketId, pc);
              
          stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
          });

          pc.onicecandidate = (event) => {
            if (!event.candidate) {
              console.log("[CAMERA] ICE gathering complete:", viewerSocketId);
              return;
            }

            console.log(
              "[CAMERA] Sending local ICE candidate:",
              viewerSocketId,
              event.candidate.candidate
            );

            if (socket.connected) {
              socket.emit("webrtc:ice-candidate", {
                deviceId: incomingDeviceId,
                viewerSocketId,
                candidate: event.candidate,
              });
            } else {
              console.warn(
                "[CAMERA] Candidate not sent; device socket is disconnected:",
                viewerSocketId
              );
            }
          };

          pc.onconnectionstatechange = () => {
            console.log(
              "[CAMERA] Peer connection state:",
              viewerSocketId,
              pc.connectionState
            );

            // "disconnected" can be temporary while ICE checks/recovery run.
            // Keep the peer alive unless it has definitively failed or closed.
            if (["failed", "closed"].includes(pc.connectionState)) {
              closePeerConnection(viewerSocketId);
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(offer));

          // Process ICE candidates received before remote description.
          const queuedCandidates =
            pendingIceCandidatesRef.current.get(viewerSocketId) || [];

          pendingIceCandidatesRef.current.delete(viewerSocketId);

          for (const candidate of queuedCandidates) {
            try {
  await pc.addIceCandidate(
    new RTCIceCandidate(candidate)
  );

  console.log("[CAMERA] Remote ICE candidate added");
} catch (error) {
  console.error("[CAMERA] Failed to add ICE candidate:", error);
};
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("webrtc:answer", {
            deviceId: incomingDeviceId,
            viewerSocketId,
            answer: pc.localDescription,
          });

          setActiveViewers(peerConnectionsRef.current.size);
          setError("");
          setNotice("Dashboard viewer connected to the camera signaling session.");
        } catch (rtcError) {
          closePeerConnection(viewerSocketId);
          setError(`WebRTC offer failed: ${rtcError.message}`);
        }
      });

      socket.on(
  "webrtc:ice-candidate",
  async ({ viewerSocketId, candidate } = {}) => {
    console.log("[CAMERA] ICE Candidate Received:", {
      viewerSocketId,
      candidate: candidate?.candidate,
    });

    if (!viewerSocketId || !candidate) return;

    const pc = peerConnectionsRef.current.get(viewerSocketId);

    if (!pc || !pc.remoteDescription) {
      const queued =
        pendingIceCandidatesRef.current.get(viewerSocketId) || [];

      queued.push(candidate);
      pendingIceCandidatesRef.current.set(viewerSocketId, queued);

      console.log("[CAMERA] ICE Candidate Queued:", queued.length);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));

      console.log(
        "[CAMERA] Remote ICE Candidate Added:",
        candidate.candidate
      );
    } catch (error) {
      console.error(
        "[CAMERA] Failed to add remote ICE Candidate:",
        error
      );
    }
  }
);

      socket.on("webrtc:leave", ({ viewerSocketId } = {}) => {
        if (viewerSocketId) closePeerConnection(viewerSocketId);
      });
    } catch (socketError) {
      setSocketStatus("error");
      setError(socketError.message || "Unable to initialize Device Socket.");
    }

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      if (deviceSocketRef.current === socket) {
        deviceSocketRef.current = null;
      }
      closeAllPeerConnections();
      setSocketStatus("disconnected");
    };
  }, [authStatus, closeAllPeerConnections, closePeerConnection]);

  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;

    let active = true;

    const sendHeartbeatRequest = async () => {
      try {
        await sendCameraHeartbeat();
        if (active) setHeartbeatStatus("success");
      } catch (requestError) {
        if (active) {
          setHeartbeatStatus("failed");
          setError(
            requestError.response?.data?.message ||
              "Heartbeat failed. Check the device connection."
          );
        }
      }
    };

    sendHeartbeatRequest();
    const intervalId = window.setInterval(
      sendHeartbeatRequest,
      HEARTBEAT_INTERVAL_MS
    );

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [authStatus]);

  const handleRegister = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const device = await registerCameraDevice(
        pairingCode.trim(),
        deviceName.trim()
      );

      setDeviceId(device.deviceId);
      setDeviceInfo(device);
      setPairingCode("");
      setAuthStatus("authenticated");
      setNotice("Camera registered and credentials saved for this tab.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Camera registration failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAuthenticate = async () => {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const profile = await authenticateCameraDevice();
      setDeviceInfo(profile);
      setDeviceId(profile.deviceId || getStoredCameraDeviceId() || "");
      setAuthStatus("authenticated");
      setNotice("Device authentication successful.");
    } catch (requestError) {
      setAuthStatus("failed");
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Device authentication failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const startCamera = async () => {
    setError("");
    setNotice("");

    if (authStatus !== "authenticated") {
      setError("Authenticate and pair this device before starting the camera.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access requires HTTPS or localhost and a supported browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // ==========================================
// JPEG FRAME STREAMING
// ==========================================

const canvas = document.createElement("canvas");

canvas.width = 640;
canvas.height = 360;

frameCanvasRef.current = canvas;

const context = canvas.getContext("2d");

if (frameIntervalRef.current) {
  window.clearInterval(frameIntervalRef.current);
}

frameIntervalRef.current = window.setInterval(async () => {
  const video = videoRef.current;
  const socket = deviceSocketRef.current;

  // Check camera and socket availability
  if (
    !video ||
    video.readyState < 2 ||
    !socket?.connected ||
    frameInFlightRef.current
  ) {
    return;
  }

  const currentDeviceId = getStoredCameraDeviceId();

  if (!currentDeviceId) return;

  frameInFlightRef.current = true;
  const captureStartedAt = performance.now();

  try {
    // Preserve original aspect ratio
    const scale = Math.min(
      640 / video.videoWidth,
      360 / video.videoHeight
    );

    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;

    const x = (640 - width) / 2;
    const y = (360 - height) / 2;

    context.fillStyle = "#000000";
    context.fillRect(0, 0, 640, 360);

    context.drawImage(video, x, y, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.55);
    });

    if (!blob || !socket.connected) return;

    if (blob.size > 200 * 1024) {
      console.warn("[CAMERA] Frame too large:", blob.size);
      return;
    }

    const frame = await blob.arrayBuffer();

    socket.emit(
  "camera:frame",
  {
    deviceId: currentDeviceId,
    frame,
  },
  (response) => {
    if (response?.success) {
      console.log("[CAMERA ACK]", {
        received: response.success,
        frameSize: response.frameSize,
        viewers: response.viewers,
        relayed: response.relayed,
      });
    } else {
      console.warn("[CAMERA ACK FAILED]", response);
    }
  }
);

    console.log("[CAMERA] JPEG frame sent:", blob.size, "bytes");

  } catch (frameError) {
    console.error("[CAMERA] Frame capture error:", frameError);
    
  } finally {
    console.log("[CAMERA CAPTURE PERFORMANCE]", {
  processingTimeMs: (
    performance.now() - captureStartedAt
  ).toFixed(2),
});
    frameInFlightRef.current = false;
  }

}, 200);

      setCameraStatus("running");
      setNotice("Camera preview started. The phone is ready to serve WebRTC viewers.");
    } catch (cameraError) {
      setCameraStatus("stopped");
      setError(
        cameraError.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in Chrome settings."
          : cameraError.message || "Unable to start the camera."
      );
    }
  };

  const handleDisconnect = () => {
    stopCamera();

    if (deviceSocketRef.current) {
      deviceSocketRef.current.disconnect();
      deviceSocketRef.current = null;
    }

    clearCameraDeviceCredentials();
    setDeviceId("");
    setDeviceInfo(null);
    setAuthStatus("unpaired");
    setHeartbeatStatus("idle");
    setSocketStatus("disconnected");
    setNotice("This browser session has been disconnected from the device.");
    setError("");
  };

  const statusLabel =
    authStatus === "authenticated"
      ? "Authenticated"
      : authStatus === "checking"
        ? "Checking..."
        : authStatus === "failed"
          ? "Authentication failed"
          : "Not paired";

  return (
    <main className="min-h-screen bg-[#080d1c] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.25em] text-emerald-400">
              SMART CCTV BD
            </p>
            <h1 className="mt-2 text-2xl font-bold">Mobile Camera Device</h1>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              authStatus === "authenticated"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {statusLabel}
          </span>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {notice}
          </div>
        )}

        {authStatus === "unpaired" || authStatus === "failed" ? (
          <form
            onSubmit={handleRegister}
            className="mb-5 space-y-4 rounded-2xl border border-slate-800 bg-[#10182b] p-5"
          >
            <div>
              <h2 className="text-lg font-semibold">Pair this phone</h2>
              <p className="mt-1 text-sm text-slate-400">
                Generate a one-time pairing code from your Dashboard, then
                enter it here. The code expires after five minutes.
              </p>
            </div>

            <label className="block text-sm text-slate-300">
              Camera name
              <input
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={50}
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-[#080d1c] px-3 py-3 text-white outline-none focus:border-emerald-400"
                placeholder="My test Camera"
              />
            </label>

            <label className="block text-sm text-slate-300">
              6-digit pairing code
              <input
                value={pairingCode}
                onChange={(event) =>
                  setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-[#080d1c] px-3 py-3 text-center text-xl tracking-[0.4em] text-white outline-none focus:border-emerald-400"
                placeholder="000000"
              />
            </label>

            <button
              type="submit"
              disabled={busy || pairingCode.length !== 6 || !deviceName.trim()}
              className="w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-[#06111a] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Pairing..." : "Register This Phone"}
            </button>
          </form>
        ) : (
          <section className="mb-5 rounded-2xl border border-slate-800 bg-[#10182b] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {deviceInfo?.deviceName || "Camera device"}
                </h2>
                <p className="mt-1 break-all text-xs text-slate-400">{deviceId}</p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
                Paired
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-[#080d1c] p-3">
                <p className="text-slate-400">Heartbeat</p>
                <p className="mt-1 font-medium">
                  {heartbeatStatus === "success"
                    ? "Sending"
                    : heartbeatStatus === "failed"
                      ? "Failed"
                      : "Starting"}
                </p>
              </div>
              <div className="rounded-lg bg-[#080d1c] p-3">
                <p className="text-slate-400">Device Socket</p>
                <p className="mt-1 font-medium">
                  {socketStatus === "connected"
                    ? "Connected"
                    : socketStatus === "error"
                      ? "Connection error"
                      : "Connecting"}
                </p>
              </div>
              <div className="rounded-lg bg-[#080d1c] p-3">
                <p className="text-slate-400">Camera</p>
                <p className="mt-1 font-medium">
                  {cameraStatus === "running" ? "Preview active" : "Stopped"}
                </p>
              </div>
              <div className="rounded-lg bg-[#080d1c] p-3">
                <p className="text-slate-400">Live Viewers</p>
                <p className="mt-1 font-medium">{activeViewers}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAuthenticate}
              disabled={busy}
              className="mt-4 w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Checking..." : "Verify Device Authentication"}
            </button>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#10182b]">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="font-semibold">Camera Preview</h2>
              <p className="mt-1 text-xs text-slate-400">
                Local preview on this phone
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${
                cameraStatus === "running"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              {cameraStatus === "running" ? "LIVE PREVIEW" : "STOPPED"}
            </span>
          </div>

          <div className="aspect-video bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 p-5">
            <button
              type="button"
              onClick={startCamera}
              disabled={cameraStatus === "running" || authStatus !== "authenticated"}
              className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-[#06111a] hover:bg-emerald-400 disabled:opacity-50"
            >
              Start Camera
            </button>
            <button
              type="button"
              onClick={stopCamera}
              disabled={cameraStatus !== "running"}
              className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              Stop Camera
            </button>
          </div>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-slate-500">
          Keep this browser tab open while using the phone as a camera. The
          device connects to the server for WebRTC signaling; video is sent
          directly to authorized Dashboard viewers.
        </p>

        {authStatus === "authenticated" && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="mt-5 w-full rounded-lg border border-red-500/30 px-4 py-3 text-sm text-red-300 hover:bg-red-500/10"
          >
            Disconnect This Device
          </button>
        )}
      </div>
    </main>
  );
}

export default CameraDevice;

