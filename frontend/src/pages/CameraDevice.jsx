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
const DCAST_WHIP_URL = import.meta.env.VITE_DCAST_WHIP_URL || "";

const waitForIceGatheringComplete = (peerConnection, timeoutMs = 10000) =>
  new Promise((resolve) => {
    if (peerConnection.iceGatheringState === "complete") return resolve();

    const timeoutId = window.setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", checkState);
      resolve();
    }, timeoutMs);

    const checkState = () => {
      if (peerConnection.iceGatheringState !== "complete") return;
      window.clearTimeout(timeoutId);
      peerConnection.removeEventListener("icegatheringstatechange", checkState);
      resolve();
    };

    peerConnection.addEventListener("icegatheringstatechange", checkState);
  });
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
  const whipPeerConnectionRef = useRef(null);
  const whipSessionUrlRef = useRef("");
  const whipStatsIntervalRef = useRef(null);
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

 const stopWhipStats = useCallback(() => {
  if (whipStatsIntervalRef.current) {
    window.clearInterval(whipStatsIntervalRef.current);
    whipStatsIntervalRef.current = null;
  }
 }, []);

 const startWhipStats = useCallback((peerConnection) => {
  stopWhipStats();

  const logStats = async () => {
    if (!peerConnection || peerConnection.signalingState === "closed") {
      stopWhipStats();
      return;
    }

    try {
      const stats = await peerConnection.getStats();
      const reports = [];

      stats.forEach((item) => {
        if (item.type === "outbound-rtp" &&
            (item.kind === "video" || item.mediaType === "video")) {
          const codec = item.codecId ? stats.get(item.codecId) : null;
          reports.push({
            type: "outbound-video",
            bytesSent: item.bytesSent ?? 0,
            packetsSent: item.packetsSent ?? 0,
            framesEncoded: item.framesEncoded ?? 0,
            framesSent: item.framesSent ?? 0,
            keyFramesEncoded: item.keyFramesEncoded ?? 0,
            frameWidth: item.frameWidth ?? null,
            frameHeight: item.frameHeight ?? null,
            framesPerSecond: item.framesPerSecond ?? null,
            qualityLimitationReason: item.qualityLimitationReason ?? null,
            codec: codec?.mimeType ?? null,
          });
        }

        if (item.type === "remote-inbound-rtp" &&
            (item.kind === "video" || item.mediaType === "video")) {
          reports.push({
            type: "remote-inbound-video",
            packetsReceived: item.packetsReceived ?? 0,
            packetsLost: item.packetsLost ?? 0,
            fractionLost: item.fractionLost ?? 0,
            roundTripTime: item.roundTripTime ?? null,
          });
        }

        if (item.type === "candidate-pair" &&
            item.state === "succeeded" && item.nominated) {
          reports.push({
            type: "selected-candidate-pair",
            currentRoundTripTime: item.currentRoundTripTime ?? null,
            availableOutgoingBitrate: item.availableOutgoingBitrate ?? null,
          });
        }
      });

      console.log("[DCAST WHIP STATS]", {
        connectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        signalingState: peerConnection.signalingState,
        reports,
      });
    } catch (statsError) {
      console.warn("[DCAST WHIP STATS] Could not read stats:", statsError);
    }
  };

  logStats();
  whipStatsIntervalRef.current = window.setInterval(logStats, 5000);
 }, [stopWhipStats]);

 const stopCamera = useCallback(() => {
  stopWhipStats();
  // Stop the DCAST WHIP publishing session.
  const peerConnection = whipPeerConnectionRef.current;
  const sessionUrl = whipSessionUrlRef.current;
  whipPeerConnectionRef.current = null;
  whipSessionUrlRef.current = "";

  if (peerConnection) {
    peerConnection.getSenders().forEach((sender) => {
      try { sender.track?.stop(); } catch { /* best-effort cleanup */ }
    });
    peerConnection.close();
  }

  if (sessionUrl) {
    fetch(sessionUrl, { method: "DELETE" }).catch((error) => {
      console.warn("[DCAST WHIP] Session cleanup failed:", error);
    });
  }

  // Stop legacy JPEG frame relay if it was started by an older build.
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

  if (videoRef.current) videoRef.current.srcObject = null;
  setCameraStatus("stopped");
}, [closeAllPeerConnections, stopWhipStats]);

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
      stopWhipStats();
      closeAllPeerConnections();
      if (whipPeerConnectionRef.current) {
        whipPeerConnectionRef.current.close();
        whipPeerConnectionRef.current = null;
      }
      if (whipSessionUrlRef.current) {
        fetch(whipSessionUrlRef.current, { method: "DELETE" }).catch(() => {});
        whipSessionUrlRef.current = "";
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (frameIntervalRef.current) {
        window.clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
    };
  }, [verifySavedDevice, closeAllPeerConnections, stopWhipStats]);

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

    if (!DCAST_WHIP_URL) {
      setError("DCAST WHIP is not configured. Add VITE_DCAST_WHIP_URL to the frontend environment and rebuild.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access requires HTTPS or localhost and a supported browser.");
      return;
    }

    let stream;
    let peerConnection;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      whipPeerConnectionRef.current = peerConnection;

      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      peerConnection.addEventListener("connectionstatechange", () => {
        console.log("[DCAST WHIP] Connection state:", peerConnection.connectionState);
        if (peerConnection.connectionState === "connected") {
          startWhipStats(peerConnection);
        }
        if (["failed", "closed"].includes(peerConnection.connectionState)) {
          stopWhipStats();
        }
        if (peerConnection.connectionState === "failed") {
          setCameraStatus("stopped");
          setError("DCAST WHIP connection failed. Check the phone network and WHIP URL.");
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const response = await fetch(DCAST_WHIP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: peerConnection.localDescription.sdp,
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(`DCAST WHIP rejected the offer (${response.status}). ${responseText.slice(0, 180)}`);
      }

      const answerSdp = await response.text();
      if (!answerSdp || !answerSdp.startsWith("v=")) {
        throw new Error("DCAST returned an invalid WHIP SDP answer.");
      }

      const locationHeader = response.headers.get("Location");
      if (locationHeader) {
        whipSessionUrlRef.current = new URL(locationHeader, DCAST_WHIP_URL).toString();
      }

      await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
      setCameraStatus("running");
      setNotice("Camera is publishing to DCAST Cloud. Open the Dashboard to verify the live video.");
    } catch (cameraError) {
      console.error("[DCAST WHIP] Publish error:", cameraError);
      stopWhipStats();

      if (peerConnection) {
        peerConnection.close();
        if (whipPeerConnectionRef.current === peerConnection) {
          whipPeerConnectionRef.current = null;
        }
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;

      setCameraStatus("stopped");
      const message = cameraError.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in Chrome settings."
        : cameraError.message || "Unable to publish camera to DCAST.";
      setError(message);
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
                Phone camera · DCAST Cloud publishing
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
          Keep this browser tab open while using the phone as a camera. Video is
          published directly from this phone to DCAST Cloud using WHIP; the
          Dashboard plays the DCAST stream.
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

