import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyDevices, renameCamera, removeCamera, getCameraRecordings } from "../services/device";
import { connectSocket, disconnectSocket } from "../services/socket";
import api from "../services/api";
import "../styles/dashboard.css";
const DCAST_EMBED_URL = "https://dcast.tv/embed/deb044115dd6f6b0f66ca02cea1e41be";


const events = [
  {
    id: 1,
    title: "Motion Detected",
    time: "Sample event",
    camera: "Event API not connected yet",
    type: "motion",
  },
  {
    id: 2,
    title: "Camera Connected",
    time: "Sample event",
    camera: "Event API not connected yet",
    type: "success",
  },
  {
    id: 3,
    title: "Device Offline",
    time: "Sample event",
    camera: "Event API not connected yet",
    type: "warning",
  },
  {
    id: 4,
    title: "Camera Disabled",
    time: "Sample event",
    camera: "Event API not connected yet",
    type: "danger",
  },
];

const views = [
  "My Views",
  "Recent Views",
  "Maps View",
  "Events View",
  "Airport View",
  "Shared Views",
];
const monitorWebRTC = (pc, label) => {

  const logState = (eventName) => {
    console.log(`[${label}] ${eventName}`, {
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
      iceConnectionState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      hasLocalDescription: Boolean(pc.localDescription),
      hasRemoteDescription: Boolean(pc.remoteDescription),
    });
  };

  pc.addEventListener("iceconnectionstatechange", async () => {
    logState("ICE state changed");
    if (pc.iceConnectionState !== "failed") return;

    try {
      const stats = await pc.getStats();
      stats.forEach((item) => {
        if (item.type === "candidate-pair" ||
            item.type === "local-candidate" ||
            item.type === "remote-candidate") {
          console.log(`[${label}] ICE diagnostic:`, item);
        }
      });
    } catch (error) {
      console.error(`[${label}] getStats failed:`, error);
    }
  });

  pc.addEventListener("connectionstatechange", () => logState("Connection state changed"));
  pc.addEventListener("signalingstatechange", () => logState("Signaling state changed"));
  pc.addEventListener("icegatheringstatechange", () => logState("Gathering state changed"));
  pc.addEventListener("icecandidate", (event) => {
    console.log(`[${label}] ICE candidate event:`, {
      candidate: event.candidate?.candidate ?? null,
      candidateType: event.candidate?.type ?? null,
      protocol: event.candidate?.protocol ?? null,
      gatheringState: pc.iceGatheringState,
    });
  });
  pc.addEventListener("icecandidateerror", (event) => {
    console.error(`[${label}] ICE candidate error:`, {
      url: event.url,
      code: event.errorCode,
      message: event.errorText,
    });
  });
};

function Dashboard() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState("Recent Views");

  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [recordingsError, setRecordingsError] = useState("");
  const [recordingsLoading, setRecordingsLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [showDevicePanel, setShowDevicePanel] = useState(true);
  const [showEvents, setShowEvents] = useState(true);

  const [loadingCameras, setLoadingCameras] = useState(true);
  const [cameraError, setCameraError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);

  // WebRTC viewer state.
  const [streamStatus, setStreamStatus] = useState("idle");
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const viewerContainerRef = useRef(null);
  const [streamError, setStreamError] = useState("");
  const [remoteStream, setRemoteStream] = useState(null);
  const [jpegFrameUrl, setJpegFrameUrl] = useState(null);
const jpegFrameUrlRef = useRef(null);
const jpegStatsRef = useRef({
  startedAt: 0,
  frames: 0,
  bytes: 0,
  latencyTotal: 0,
  latencySamples: 0,
});
  const dashboardSocketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const selectedCameraRef = useRef(selectedCamera);

  useEffect(() => {
    selectedCameraRef.current = selectedCamera;
  }, [selectedCamera]);

  // One-time camera pairing code state.
  const [pairingCode, setPairingCode] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState(null);
  const [pairingSecondsLeft, setPairingSecondsLeft] = useState(0);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [pairingCopied, setPairingCopied] = useState(false);

  const closeViewerConnection = () => {
    pendingIceCandidatesRef.current = [];

    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setRemoteStream(null);
    setStreamStatus("idle");
  };

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !remoteStream) return;

    if (video.srcObject !== remoteStream) {
      video.srcObject = remoteStream;
    }
    video.muted = true;
    video.playsInline = true;

    video.play().catch((error) => {
      console.warn("[DASHBOARD] Remote video autoplay was blocked:", error);
      setStreamError("Tap the video to start playback if the browser blocks autoplay.");
    });
  }, [remoteStream]);

  const handleRenameCamera = async () => {
    if (!selectedCamera) return;
    const nextName = window.prompt("Enter a new camera name", selectedCamera.deviceName);
    if (nextName === null) return;
    try {
      await renameCamera(selectedCamera.deviceId, nextName);
      setSelectedCamera((current) => current?.deviceId === selectedCamera.deviceId ? { ...current, deviceName: nextName.trim() } : current);
      setCameras((current) => current.map((camera) => camera.deviceId === selectedCamera.deviceId ? { ...camera, deviceName: nextName.trim() } : camera));
    } catch (error) {
      window.alert(error.response?.data?.message || "Unable to rename camera.");
    }
  };

  const handleRemoveCamera = async () => {
    if (!selectedCamera) return;
    const confirmed = window.confirm(`Permanently remove "${selectedCamera.deviceName}"? This also removes its sharing and recording metadata.`);
    if (!confirmed) return;
    try {
      await removeCamera(selectedCamera.deviceId);
      setSelectedCamera(null);
      await loadCameras();
    } catch (error) {
      window.alert(error.response?.data?.message || "Unable to remove camera.");
    }
  };

  // Fetch the authenticated user's paired cameras.
  const loadCameras = async () => {
    try {
      setLoadingCameras(true);
      setCameraError("");

      const result = await getMyDevices();
      const cameraList = Array.isArray(result?.cameras)
        ? result.cameras
        : [];

      setCameras(cameraList);

      setSelectedCamera((previous) => {
        if (!cameraList.length) return null;

        return (
          cameraList.find(
            (camera) => camera.deviceId === previous?.deviceId
          ) || cameraList[0]
        );
      });
    } catch (error) {
      setCameraError(
        error.response?.data?.message ||
          error.message ||
          "Unable to load cameras. Please try again."
      );
    } finally {
      setLoadingCameras(false);
    }
  };

  useEffect(() => {
    loadCameras();
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedCamera?.deviceId) {
      setRecordings([]);
      setRecordingsError("");
      return undefined;
    }
    setRecordingsLoading(true);
    setRecordingsError("");
    getCameraRecordings(selectedCamera.deviceId)
      .then((result) => {
        if (active) setRecordings(Array.isArray(result?.recordings) ? result.recordings : []);
      })
      .catch((error) => {
        if (active) {
          setRecordings([]);
          setRecordingsError(error.response?.data?.message || "Recording list is not available for this account.");
        }
      })
      .finally(() => { if (active) setRecordingsLoading(false); });
    return () => { active = false; };
  }, [selectedCamera?.deviceId]);

  // Listen for authorized, owner-specific camera status updates.
  useEffect(() => {
    let socket;

    const handleConnect = () => {
      setSocketConnected(true);
      // Refresh once after reconnect to recover any missed status events.
      loadCameras();
    };

    const handleDisconnect = () => {
      setSocketConnected(false);
    };

    const handleConnectError = (error) => {
      setSocketConnected(false);
      console.error("Dashboard Socket Connection Error:", error.message);
    };

    const handleCameraStatus = (payload) => {
      if (!payload?.deviceId || !payload?.status) return;

      const allowedStatuses = ["online", "offline", "disabled"];
      if (!allowedStatuses.includes(payload.status)) return;

      setCameras((previousCameras) =>
        previousCameras.map((camera) =>
          camera.deviceId === payload.deviceId
            ? {
                ...camera,
                status: payload.status,
                ...(payload.deviceName
                  ? { deviceName: payload.deviceName }
                  : {}),
                ...(payload.lastSeen !== undefined
                  ? { lastSeen: payload.lastSeen }
                  : {}),
                ...(payload.lastHeartbeat !== undefined
                  ? { lastHeartbeat: payload.lastHeartbeat }
                  : {}),
              }
            : camera
        )
      );

      setSelectedCamera((previousCamera) => {
        if (previousCamera?.deviceId !== payload.deviceId) {
          return previousCamera;
        }

        return {
          ...previousCamera,
          status: payload.status,
          ...(payload.deviceName
            ? { deviceName: payload.deviceName }
            : {}),
          ...(payload.lastSeen !== undefined
            ? { lastSeen: payload.lastSeen }
            : {}),
          ...(payload.lastHeartbeat !== undefined
            ? { lastHeartbeat: payload.lastHeartbeat }
            : {}),
        };
      });
    };

      
const handleCameraAccessRevoked = (payload) => {
  if (
    !payload?.deviceId ||
    payload.deviceId !== selectedCameraRef.current?.deviceId
  ) {
    return;
  }

  console.warn(
    "[DASHBOARD] Camera access revoked:",
    payload.deviceId
  );

  // Close the active WebRTC connection
  closeViewerConnection();

  // Remove the previously received JPEG frame
  if (jpegFrameUrlRef.current) {
    URL.revokeObjectURL(jpegFrameUrlRef.current);
    jpegFrameUrlRef.current = null;
  }

  setJpegFrameUrl(null);

  setStreamStatus("error");
  setStreamError(
    payload.message ||
      "Your access to this camera has been revoked."
  );
};

    try {
      socket = connectSocket();
      dashboardSocketRef.current = socket;

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("connect_error", handleConnectError);
      socket.on("camera:status", handleCameraStatus);
      socket.on("camera:access-revoked",handleCameraAccessRevoked);
      // Receive JPEG camera frames
const handleCameraFrame = (payload) => {
  if (
    !payload?.deviceId ||
    payload.deviceId !== selectedCameraRef.current?.deviceId ||
    !payload.frame
  ) {
    return;
  }

  try {
    const frame = payload.frame;

    if (
      !(frame instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(frame)
    ) {
      return;
    }
// ==========================================
// JPEG STREAM PERFORMANCE MONITOR
// ==========================================

const now = performance.now();

const frameBytes = frame.byteLength;

const stats = jpegStatsRef.current;

if (!stats.startedAt) {
  stats.startedAt = now;
}

stats.frames += 1;
stats.bytes += frameBytes;

if (payload.timestamp) {
  stats.latencyTotal += Date.now() - payload.timestamp;
  stats.latencySamples += 1;
}

// Report performance every 5 seconds
const elapsed = now - stats.startedAt;

if (elapsed >= 5000) {
  const fps = (stats.frames / elapsed) * 1000;

  const kbPerSecond =
    (stats.bytes / 1024 / elapsed) * 1000;

  const mbps =
    (stats.bytes * 8 / elapsed) / 1000;

  const avgLatency =
    stats.latencySamples > 0
      ? stats.latencyTotal / stats.latencySamples
      : 0;

  console.log("[SMART CCTV PERFORMANCE]", {
    FPS: fps.toFixed(2),
    Bandwidth_KBps: kbPerSecond.toFixed(2),
    Bandwidth_Mbps: mbps.toFixed(3),
    Average_Latency_ms: avgLatency.toFixed(2),
    Total_Frames: stats.frames,
  });

  // Reset measurement window
  stats.startedAt = now;
  stats.frames = 0;
  stats.bytes = 0;
  stats.latencyTotal = 0;
  stats.latencySamples = 0;
}
    const blob = new Blob([frame], {
      type: "image/jpeg",
    });

    const newUrl = URL.createObjectURL(blob);

    if (jpegFrameUrlRef.current) {
      URL.revokeObjectURL(jpegFrameUrlRef.current);
    }

    jpegFrameUrlRef.current = newUrl;

    setJpegFrameUrl(newUrl);
    setStreamStatus("live");
    setStreamError("");

  } catch (error) {
    console.error("[DASHBOARD] JPEG frame error:", error);
  }
};

socket.on("camera:frame", handleCameraFrame);

      const handleWebRtcAnswer = async (payload) => {
        if (
          !payload?.deviceId ||
          payload.deviceId !== selectedCameraRef.current?.deviceId ||
          !payload.answer
        ) return;

        const pc = peerConnectionRef.current;
        if (!pc) return;

        try {
          console.log("[DASHBOARD TEST] Before Remote Description:", {
  sameConnection: peerConnectionRef.current === pc,
  signalingState: pc.signalingState,
  iceGatheringState: pc.iceGatheringState,
  connectionState: pc.connectionState,
  remoteDescription: pc.remoteDescription,
});

await pc.setRemoteDescription(payload.answer);

console.log("[DASHBOARD TEST] After Remote Description:", {
  sameConnection: peerConnectionRef.current === pc,
  signalingState: pc.signalingState,
  iceGatheringState: pc.iceGatheringState,
  connectionState: pc.connectionState,
  remoteDescription: pc.remoteDescription?.type,
});;
          const queuedCandidates = pendingIceCandidatesRef.current;
          pendingIceCandidatesRef.current = [];

       for (const candidate of queuedCandidates) {
            try {
              await pc.addIceCandidate(
                new RTCIceCandidate(candidate)
              );

              console.log(
                "[DASHBOARD] Remote ICE candidate added:",
                candidate
              );
            } catch (error) {
              console.error(
                "[DASHBOARD] Failed to add ICE candidate:",
                error
              );
            }
          }
          
          setStreamStatus("connecting");
        } catch (error) {
          console.error("WebRTC answer error:", error);
          setStreamStatus("error");
          setStreamError(error.message || "Unable to process camera answer.");
        }
      };

      const handleWebRtcIceCandidate = async (payload) => {
        console.log("[DASHBOARD] ICE Candidate Received:", payload);
        if (
          !payload?.deviceId ||
          payload.deviceId !== selectedCameraRef.current?.deviceId ||
          !payload.candidate
        ) return;

        const pc = peerConnectionRef.current;
        if (!pc) return;

        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            console.log("[DASHBOARD] Remote ICE Candidate Added");
          } else {
            pendingIceCandidatesRef.current.push(payload.candidate);
            
          }
        } catch (error) {
          console.error("Dashboard ICE candidate error:", error);
        }
      };

      socket.on("webrtc:answer", handleWebRtcAnswer);
      socket.on("webrtc:ice-candidate", handleWebRtcIceCandidate);

      if (socket.connected) {
        handleConnect();
      }
    } catch (error) {
      console.error("Dashboard Socket Setup Error:", error.message);
      setSocketConnected(false);
    }

    return () => {
      if (socket) {
        socket.off("connect", handleConnect);
        socket.off("disconnect", handleDisconnect);
        socket.off("connect_error", handleConnectError);
        socket.off("camera:status", handleCameraStatus);
        socket.off("camera:access-revoked",handleCameraAccessRevoked);
        socket.off("webrtc:answer");
        socket.off("webrtc:ice-candidate");
        if (dashboardSocketRef.current === socket) {
          dashboardSocketRef.current = null;
        }
        disconnectSocket();
      }
    };
  }, []);
useEffect(() => {
  return () => {
    if (jpegFrameUrlRef.current) {
      URL.revokeObjectURL(jpegFrameUrlRef.current);
      jpegFrameUrlRef.current = null;
    }
  };
}, []);
  // Start a WebRTC viewer session for the currently selected online camera.
  useEffect(() => {
    const socket = dashboardSocketRef.current;
    const camera = selectedCamera;

    closeViewerConnection();
    console.log("[DASHBOARD] closeViewerConnection CALLED");
console.trace();
    setStreamError("");

    if (!socketConnected || !socket?.connected || !camera) return undefined;

    if (camera.status !== "online") {
      setStreamStatus("offline");
      return undefined;
    }

    let cancelled = false;
    setStreamStatus("joining");

    socket.emit("camera:join", camera.deviceId, async (joinResult) => {
      if (cancelled) return;

      if (!joinResult?.success) {
        setStreamStatus("error");
        setStreamError(joinResult?.message || "Camera access was denied or the camera could not be joined.");
        return;
      }

      try {
      const pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
});

        peerConnectionRef.current = pc;
        monitorWebRTC(pc, "DASHBOARD");

        console.log("[DASHBOARD] PeerConnection created", {
          deviceId: camera.deviceId,
          configuration: pc.getConfiguration(),
          signalingState: pc.signalingState,
          iceGatheringState: pc.iceGatheringState,
        });

        pc.ontrack = (event) => {
  if (cancelled || peerConnectionRef.current !== pc) return;

  console.log("[DASHBOARD] VIDEO TRACK RECEIVED:", {
    trackKind: event.track?.kind,
    trackId: event.track?.id,
    readyState: event.track?.readyState,
    muted: event.track?.muted,
    streamsCount: event.streams?.length,
    receiverTrack: event.receiver?.track?.kind,
  });

  // Use the browser-provided stream when available. Some WebRTC senders
  // deliver a track without an associated stream, so create one in that case.
  const stream = event.streams?.[0] || new MediaStream([event.track]);

  if (event.track?.kind === "video") {
    event.track.onunmute = () => {
      if (cancelled || peerConnectionRef.current !== pc) return;
      console.log("[DASHBOARD] Remote video track unmuted; frames can now render.");
      setStreamStatus("live");
      setStreamError("");
      const video = remoteVideoRef.current;
      if (video && video.srcObject !== stream) video.srcObject = stream;
      video?.play?.().catch((error) => {
        console.warn("[DASHBOARD] Video playback after unmute failed:", error);
      });
    };

    event.track.onmute = () => {
      if (!cancelled && peerConnectionRef.current === pc) {
        console.warn("[DASHBOARD] Remote video track muted.");
        setStreamStatus("connecting");
      }
    };

    event.track.onended = () => {
      if (!cancelled && peerConnectionRef.current === pc) {
        setStreamStatus("offline");
        setStreamError("The camera video track has ended.");
      }
    };
  }

  setRemoteStream(stream);
  setStreamStatus(event.track?.muted ? "connecting" : "live");
  setStreamError("");

  const video = remoteVideoRef.current;
  if (video) {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.play().catch((error) => {
      console.warn("[DASHBOARD] Video playback request was blocked:", error);
      setStreamError("Video is connected, but browser playback was blocked. Tap the video or refresh the viewer.");
    });
  }
};

        // Trickle ICE: send each Dashboard candidate to the Camera via Socket.IO.
        // Candidates may arrive before the offer; CameraDevice queues them by viewerSocketId.
        pc.onicecandidate = (event) => {
          if (!event.candidate) {
            console.log("[DASHBOARD] ICE gathering complete");
            return;
          }

          if (
            cancelled ||
            !socket?.connected ||
            peerConnectionRef.current !== pc
          ) {
            return;
          }

          const candidate = event.candidate.toJSON();
          console.log("[DASHBOARD] Sending local ICE candidate:", {
            candidate: candidate.candidate,
            type: event.candidate.type,
            protocol: event.candidate.protocol,
          });

          socket.emit(
            "webrtc:ice-candidate",
            { deviceId: camera.deviceId, candidate },
            (result) => {
              if (!result?.success) {
                console.error(
                  "[DASHBOARD] ICE candidate delivery failed:",
                  result?.message || "No acknowledgement from server"
                );
              }
            }
          );
        };

        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          if (pc.connectionState === "connected") {
            setStreamStatus("live");
            setStreamError("");
          } else if (pc.connectionState === "connecting") {
            setStreamStatus("connecting");
          } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
            setStreamStatus(pc.connectionState === "failed" ? "error" : "offline");
            if (pc.connectionState === "failed") {
              setStreamError("WebRTC ICE connection failed. Check the ICE diagnostics; a TURN relay may be needed on this network.");
            }
          }
        };

        pc.addTransceiver("video", { direction: "recvonly" });

        console.log("[DASHBOARD] Creating offer", {
          transceivers: pc.getTransceivers().map((transceiver) => ({
            direction: transceiver.direction,
            mid: transceiver.mid,
          })),
        });

        const offer = await pc.createOffer();
        if (cancelled || peerConnectionRef.current !== pc) {
          pc.close();
          return;
        }

        console.log("[DASHBOARD] Offer created", {
          type: offer.type,
          sdpLength: offer.sdp?.length ?? 0,
          signalingState: pc.signalingState,
        });

        await pc.setLocalDescription(offer);
        console.log("[DASHBOARD] Local description applied", {
  signalingState: pc.signalingState,
  iceGatheringState: pc.iceGatheringState,
  connectionState: pc.connectionState,
  samePC: peerConnectionRef.current === pc,
  cancelled,
});
       

        if (cancelled || peerConnectionRef.current !== pc || pc.signalingState === "closed") {
          pc.close();
          return;
        }

        if (!pc.localDescription?.sdp) {
          throw new Error("Dashboard could not create a local SDP offer.");
        }

        // Do not wait for ICE gathering. Send the SDP now; candidates are
        // delivered independently by pc.onicecandidate above.
        setStreamStatus("connecting");
        console.log("[DASHBOARD] Sending WebRTC offer", {
          deviceId: camera.deviceId,
          signalingState: pc.signalingState,
          iceGatheringState: pc.iceGatheringState,
          sdpLength: pc.localDescription.sdp.length,
        });

        socket.emit(
          "webrtc:offer",
          { deviceId: camera.deviceId, offer: pc.localDescription },
          (offerResult) => {
            if (cancelled) return;
            if (!offerResult?.success) {
              setStreamStatus("error");
              setStreamError(offerResult?.message || "The camera did not accept the WebRTC offer.");
              closeViewerConnection();
              return;
            }
            console.log("[DASHBOARD] WebRTC offer delivered successfully");
            setStreamStatus("connecting");
          }
        );
      } catch (error) {
        console.error("Unable to start WebRTC viewer:", error);
        setStreamStatus("error");
        setStreamError(error.message || "Unable to start the live video connection.");
        closeViewerConnection();
      }
    });

    return () => {
      cancelled = true;
      console.warn("[DASHBOARD] WEBRTC EFFECT CLEANUP", {
  deviceId: camera?.deviceId,
  cancelled,
  socketConnected,
  time: new Date().toISOString(),
  pcState: peerConnectionRef.current
    ? {
        signalingState: peerConnectionRef.current.signalingState,
        iceGatheringState: peerConnectionRef.current.iceGatheringState,
        connectionState: peerConnectionRef.current.connectionState,
      }
    : null,
});
      if (socket?.connected) {
        socket.emit("webrtc:leave", { deviceId: camera.deviceId }, () => {});
        socket.emit("camera:leave", camera.deviceId, () => {});
      }
      closeViewerConnection();
    };
  }, [selectedCamera?.deviceId, selectedCamera?.status, socketConnected]);

  const generateCameraPairingCode = async () => {
    try {
      setPairingLoading(true);
      setPairingError("");
      setPairingCopied(false);

      const response = await api.post("/devices/pairing/generate");
      const data = response.data?.data;

      if (!data?.pairingCode || !data?.expiresAt) {
        throw new Error("Pairing code response is incomplete.");
      }

      setPairingCode(data.pairingCode);
      setPairingExpiresAt(new Date(data.expiresAt).getTime());
    } catch (error) {
      setPairingError(
        error.response?.data?.message ||
          error.message ||
          "Unable to generate pairing code."
      );
    } finally {
      setPairingLoading(false);
    }
  };

  const copyPairingCode = async () => {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setPairingCopied(true);
    } catch {
      setPairingError("Clipboard access is unavailable in this browser.");
    }
  };

  useEffect(() => {
    if (!pairingExpiresAt) {
      setPairingSecondsLeft(0);
      return undefined;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((pairingExpiresAt - Date.now()) / 1000)
      );
      setPairingSecondsLeft(remaining);

      if (remaining === 0) {
        setPairingCode("");
        setPairingExpiresAt(null);
      }
    };

    updateCountdown();
    const timerId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(timerId);
  }, [pairingExpiresAt]);

  const formatPairingCountdown = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  };

  const onlineCount = cameras.filter(
    (camera) => camera.status === "online"
  ).length;

  const offlineCount = cameras.filter(
    (camera) => camera.status === "offline"
  ).length;

  const disabledCount = cameras.filter(
    (camera) => camera.status === "disabled"
  ).length;

  const filteredCameras = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return cameras;

    return cameras.filter(
      (camera) =>
        (camera.deviceName || "").toLowerCase().includes(query) ||
        (camera.deviceId || "").toLowerCase().includes(query)
    );
  }, [cameras, search]);

  const openFullscreenViewer = () => {
    setViewerFullscreen(true);
    const viewer = viewerContainerRef.current;
    if (viewer?.requestFullscreen) {
      viewer.requestFullscreen().catch((error) => {
        console.warn("[DASHBOARD] Native fullscreen unavailable; using expanded viewer.", error);
      });
    }
  };

  const selectCamera = (camera, openFullscreen = false) => {
    setSelectedCamera(camera);
    if (openFullscreen) openFullscreenViewer();
  };

  const closeFullscreenViewer = async () => {
    setViewerFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.warn("[DASHBOARD] Could not exit native fullscreen:", error);
      }
    }
  };

  useEffect(() => {
    const syncFullscreenState = () => {
      if (!document.fullscreenElement) setViewerFullscreen(false);
    };
    const handleEscape = (event) => {
      if (event.key === "Escape" && viewerFullscreen && !document.fullscreenElement) {
        setViewerFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [viewerFullscreen]);

  const getStatusClasses = (status) => {
    if (status === "online") {
      return {
        dot: "border-emerald-400 bg-emerald-400",
        text: "text-emerald-400",
        label: "Online",
      };
    }

    if (status === "offline") {
      return {
        dot: "border-red-400 bg-red-400",
        text: "text-red-400",
        label: "Offline",
      };
    }

    return {
      dot: "border-slate-500 bg-slate-500",
      text: "text-slate-400",
      label: status === "disabled" ? "Disabled" : "Unknown",
    };
  };

  const formatLastSeen = (value) => {
    if (!value) return "Not available";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Not available";

    return date.toLocaleString();
  };

  return (
    <div className="dashboard-app min-h-screen bg-[#101521] text-slate-200">
      <div className="flex min-h-screen">
        {/* Icon Sidebar */}
        <aside className="hidden w-[58px] shrink-0 flex-col items-center border-r border-white/5 bg-[#171a20] py-5 md:flex">
          <div className="mb-9 flex h-9 w-9 items-center justify-center rounded-full border-2 border-emerald-400 bg-slate-700 text-sm font-bold text-white">
            A
          </div>

          <div className="flex flex-1 flex-col gap-5">
            {[
              ["▦", "Views"],
              ["⚙", "Settings"],
              ["♙", "Users"],
              ["⬡", "Security"],
            ].map(([icon, label], index) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => { if (label === "Settings") navigate("/settings"); }}
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg transition ${
                  index === 0
                    ? "bg-blue-500/15 text-blue-400"
                    : "text-slate-500 hover:bg-white/5 hover:text-white"
                }`}
              >
                {icon}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="text-xl text-slate-500 hover:text-white"
            title="Settings"
            onClick={() => navigate("/settings")}
          >
            ⚙
          </button>
        </aside>

        {/* Views Sidebar */}
        <aside className="hidden w-[165px] shrink-0 flex-col border-r border-white/5 bg-[#191c22] px-3 py-6 sm:flex">
          <div className="mb-7 flex items-center justify-between px-2">
            <h1 className="text-xl font-semibold text-white">Views</h1>
            <button
              type="button"
              onClick={() => setShowDevicePanel((value) => !value)}
              className="text-blue-400"
              title="Toggle device panel"
            >
              ▣
            </button>
          </div>

          <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            My Workspace
          </p>

          <div className="space-y-1">
            {views.map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-2.5 text-left text-xs transition ${
                  activeView === view
                    ? "bg-[#30343c] text-blue-400"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{view}</span>
                {activeView === view && <span>›</span>}
              </button>
            ))}
          </div>

          <div className="mt-auto border-t border-white/5 pt-5">
            <p className="px-2 text-xs font-semibold text-white">
              Camera Summary
            </p>

            <div className="mt-3 flex gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/5 bg-[#242831] text-2xl font-semibold">
                {cameras.length}
              </div>
              <div className="flex flex-1 flex-col justify-center rounded-lg bg-[#242831] px-2">
                <span className="text-[10px] text-white">Registered</span>
                <span className="text-[10px] text-slate-500">
                  {onlineCount} online
                </span>
              </div>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{
                  width:
                    cameras.length > 0
                      ? `${(onlineCount / cameras.length) * 100}%`
                      : "0%",
                }}
              />
            </div>

            <button
              type="button"
              onClick={loadCameras}
              disabled={loadingCameras}
              className="mt-3 w-full rounded-md bg-blue-600 py-2 text-[11px] font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingCameras ? "Refreshing..." : "↻ Refresh Cameras"}
            </button>
          </div>
        </aside>

        {/* Main Monitoring Area */}
        <main className="min-w-0 flex-1 bg-[#111620]">
          {/* Top Header */}
          <header className="flex h-[65px] items-center justify-between border-b border-white/5 bg-[#151a24] px-4 md:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-xl text-slate-400 sm:hidden"
                onClick={() => setShowDevicePanel((value) => !value)}
                aria-label="Toggle device list"
              >
                ☰
              </button>

              <div>
                <h2 className="text-lg font-semibold text-white">
                  {activeView}
                </h2>
                <p className="text-[10px] text-slate-500">
                  Security Monitoring Workspace
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`hidden items-center gap-2 rounded-full px-3 py-1.5 sm:flex ${
                  socketConnected
                    ? "bg-emerald-500/10"
                    : "bg-amber-500/10"
                }`}
                title={socketConnected ? "Real-time connection active" : "Real-time connection disconnected"}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    socketConnected ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold ${
                    socketConnected ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {socketConnected ? "REAL-TIME CONNECTED" : "CONNECTING..."}
                </span>
              </div>

              <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300"
                title="Notifications"
              >
                ♧
              </button>

              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 font-semibold text-emerald-400">
                A
              </div>
            </div>
          </header>

          {/* Camera Pairing */}
          <section className="mx-3 mt-3 rounded-lg border border-emerald-500/20 bg-[#1b2029] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Pair a New Camera
                </h3>
                <p className="mt-1 text-[11px] text-slate-400">
                  Generate a one-time code and enter it on your Android phone at /camera.
                </p>
              </div>
              <button
                    type="button"
                    onClick={() => navigate("/camera")}
                    className="rounded-md border border-red-800 bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-500/20"
                  >
                    <span className="mr-2">📱</span>
                    Use This Phone as Camera
                  </button>
              <button
                type="button"
                onClick={generateCameraPairingCode}
                disabled={pairingLoading}
                className="rounded-md bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-[#07131a] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pairingLoading
                  ? "Generating..."
                  : pairingCode
                    ? "Generate New Code"
                    : "＋ Generate Pairing Code"}
              </button>
            </div>

            {pairingError && (
              <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {pairingError}
              </p>
            )}

            {pairingCode && pairingSecondsLeft > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-white/5 bg-[#111620] p-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">
                    One-time pairing code
                  </p>
                  <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-emerald-400">
                    {pairingCode}
                  </p>
                  <p className="mt-2 text-[11px] text-amber-300">
                    Expires in {formatPairingCountdown(pairingSecondsLeft)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={copyPairingCode}
                  className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5"
                >
                  {pairingCopied ? "✓ Copied" : "Copy Code"}
                </button>
              </div>
            )}

            {!pairingCode && !pairingLoading && (
              <p className="mt-3 text-[11px] text-slate-500">
                Pairing codes are valid for five minutes and can only be used once.
              </p>
            )}
          </section>

          {/* Monitoring Workspace */}
          <div
            className={`grid min-w-0 grid-cols-1 gap-3 p-3 ${
              showDevicePanel && showEvents
                ? "xl:grid-cols-[180px_190px_minmax(0,1fr)]"
                : showDevicePanel || showEvents
                ? "lg:grid-cols-[210px_minmax(0,1fr)]"
                : ""
            }`}
          >
            {/* Device List */}
            {showDevicePanel && (
              <section className="overflow-hidden rounded-lg border border-white/5 bg-[#1b2029]">
                <div className="flex h-12 items-center justify-between border-b border-white/5 px-3">
                  <h3 className="text-xs font-semibold text-white">
                    Device List
                  </h3>
                  <span className="text-xs text-slate-500">
                    {cameras.length}
                  </span>
                </div>

                <div className="border-b border-white/5 px-2 py-2">
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search camera..."
                    className="w-full rounded-md border border-white/5 bg-[#252a34] px-2 py-2 text-[10px] text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
                  />
                </div>

                <div className="max-h-[520px] space-y-1 overflow-y-auto p-2">
                  {loadingCameras ? (
                    <div className="p-5 text-center text-xs text-slate-400">
                      Loading cameras...
                    </div>
                  ) : cameraError ? (
                    <div className="p-3">
                      <p className="text-xs leading-5 text-red-400">
                        {cameraError}
                      </p>
                      <button
                        type="button"
                        onClick={loadCameras}
                        className="mt-3 rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-500"
                      >
                        Try Again
                      </button>
                    </div>
                  ) : filteredCameras.length === 0 ? (
                    <div className="p-5 text-center text-xs text-slate-500">
                      {cameras.length === 0
                        ? "No cameras registered yet."
                        : "No matching cameras found."}
                    </div>
                  ) : (
                    filteredCameras.map((camera) => {
                      const status = getStatusClasses(camera.status);

                      return (
                        <button
                          key={camera.deviceId}
                          type="button"
                          onClick={() => selectCamera(camera, true)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-3 text-left transition ${
                            selectedCamera?.deviceId === camera.deviceId
                              ? "bg-[#303640]"
                              : "hover:bg-white/5"
                          }`}
                        >
                          <span
                            className={`h-3 w-3 shrink-0 rounded-full border-2 ${status.dot}`}
                          />

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[10px] font-medium text-slate-200">
                              {camera.deviceName}
                            </span>
                            <span className="block truncate text-[9px] text-slate-500">
                              {camera.deviceType?.replace("_", " ") ||
                                "Camera"}
                            </span>
                          </span>

                          <span className={`text-[9px] ${status.text}`}>
                            {status.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-white/5 p-3">
                  <p className="text-[10px] text-slate-500">
                    {onlineCount} of {cameras.length} devices online
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{
                        width:
                          cameras.length > 0
                            ? `${(onlineCount / cameras.length) * 100}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Event Details */}
            {showEvents && (
              <section className="overflow-hidden rounded-lg border border-white/5 bg-[#1b2029]">
                <div className="flex h-12 items-center justify-between border-b border-white/5 px-3">
                  <h3 className="text-xs font-semibold text-white">
                    Camera Details
                  </h3>
                  <span className="text-xs text-slate-500">ⓘ</span>
                </div>

                {selectedCamera ? (
                  <>
                    <div className="border-b border-white/5 px-3 py-3">
                      <p className="break-words text-[11px] font-semibold text-blue-400">
                        ● {selectedCamera.deviceName}
                      </p>

                      <p className="mt-2 break-all text-[9px] text-slate-500">
                        {selectedCamera.deviceId}
                      </p>

                      <div className="mt-3 flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Status</span>
                        <span
                          className={
                            getStatusClasses(selectedCamera.status).text
                          }
                        >
                          {getStatusClasses(selectedCamera.status).label}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-slate-500">Device Type</span>
                        <span className="text-right text-slate-300">
                          {selectedCamera.deviceType?.replace("_", " ") ||
                            "Camera"}
                        </span>
                      </div>

                      <div className="mt-2 flex items-start justify-between gap-2 text-[10px]">
                        <span className="shrink-0 text-slate-500">
                          Last Seen
                        </span>
                        <span className="text-right text-slate-400">
                          {formatLastSeen(selectedCamera.lastSeen)}
                        </span>
                      </div>

                      <div className="mt-2 flex items-start justify-between gap-2 text-[10px]">
                        <span className="shrink-0 text-slate-500">
                          Last Heartbeat
                        </span>
                        <span className="text-right text-slate-400">
                          {formatLastSeen(selectedCamera.lastHeartbeat)}
                        </span>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button type="button" onClick={handleRenameCamera} className="flex-1 rounded-md border border-white/10 px-2 py-2 text-[10px] text-slate-200 hover:bg-white/5">Rename</button>
                        <button type="button" onClick={handleRemoveCamera} className="flex-1 rounded-md border border-red-500/30 px-2 py-2 text-[10px] text-red-300 hover:bg-red-500/10">Remove</button>
                      </div>
                    </div>

                    <div className="border-b border-white/5 px-3 py-3">
                      <p className="text-[10px] font-semibold text-slate-300">
                        Recent Activity
                      </p>
                      <p className="mt-2 text-[9px] leading-5 text-slate-500">
                        Camera event history is not connected yet. This
                        section will show real events after the Event API
                        is implemented.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="p-5 text-center text-xs text-slate-500">
                    Select a camera to view its details.
                  </div>
                )}

                <div className="border-b border-white/5 px-3 py-3">
                  <p className="text-[10px] font-semibold text-slate-300">
                    Status Summary
                  </p>

                  <div className="mt-3 space-y-2 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Online</span>
                      <span className="text-emerald-400">{onlineCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Offline</span>
                      <span className="text-red-400">{offlineCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Disabled</span>
                      <span className="text-slate-400">{disabledCount}</span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Recording metadata and playback readiness */}
            {selectedCamera && (
              <section className="mb-3 overflow-hidden rounded-lg border border-white/5 bg-[#1b2029]">
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-3">
                  <h3 className="text-xs font-semibold text-white">Recordings</h3>
                  <span className="text-[9px] text-slate-500">{recordings.length} files indexed</span>
                </div>
                <div className="space-y-2 p-3">
                  {recordingsLoading ? (
                    <p className="text-[10px] text-slate-500">Loading recording metadata…</p>
                  ) : recordingsError ? (
                    <p className="text-[10px] text-amber-300">{recordingsError}</p>
                  ) : recordings.length === 0 ? (
                    <p className="text-[10px] text-slate-500">No recording metadata has been uploaded by this camera yet.</p>
                  ) : recordings.map((recording) => (
                    <div key={recording._id} className="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-[#202630] p-2">
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-medium text-slate-200">{recording.fileName}</p>
                        <p className="mt-1 text-[9px] text-slate-500">{new Date(recording.startedAt).toLocaleString()} · {Math.round(recording.durationSeconds)} sec · {(recording.sizeBytes / (1024 * 1024)).toFixed(1)} MB</p>
                      </div>
                      <span className="shrink-0 rounded border border-amber-500/20 px-2 py-1 text-[9px] text-amber-300" title="Metadata exists; secure media transfer/playback is not implemented yet">Indexed</span>
                    </div>
                  ))}
                  <p className="text-[9px] leading-4 text-slate-500">Playback will be enabled after authenticated camera-to-dashboard video file transfer is implemented. This list currently displays metadata only.</p>
                </div>
              </section>
            )}

            {/* Camera Monitoring Grid */}
            <section className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Camera Monitoring
                  </h3>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {cameras.length} registered camera
                    {cameras.length === 1 ? "" : "s"} · Select an online camera to view
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDevicePanel((value) => !value)}
                    className="rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-slate-400 hover:bg-white/5"
                  >
                    {showDevicePanel ? "Hide Devices" : "Device List"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowEvents((value) => !value)}
                    className="rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-slate-400 hover:bg-white/5"
                  >
                    {showEvents ? "Hide Details" : "Camera Details"}
                  </button>

                  <button
                    type="button"
                    onClick={loadCameras}
                    disabled={loadingCameras}
                    className="rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-slate-400 hover:bg-white/5 disabled:opacity-50"
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>

              <div
                ref={viewerContainerRef}
                className={`dashboard-live-viewer mb-3 overflow-hidden rounded-lg border border-emerald-500/20 bg-[#1b2029] ${viewerFullscreen ? "dashboard-live-viewer-expanded" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-white">Custom WebRTC Live Viewer</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {selectedCamera?.deviceName || "Select a camera"} · {streamStatus}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                      PEER-TO-PEER WEBRTC
                    </span>
                    <button
                      type="button"
                      onClick={() => viewerFullscreen ? closeFullscreenViewer() : openFullscreenViewer()}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/40 hover:bg-white/5"
                      aria-label={viewerFullscreen ? "Exit fullscreen video" : "Open fullscreen video"}
                    >
                      {viewerFullscreen ? "✕ Exit full screen" : "⛶ Full screen"}
                    </button>
                  </div>
                </div>
                <div className="relative aspect-video bg-black">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    muted
                    controls
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      console.log("[DASHBOARD] Remote video metadata:", {
                        width: video.videoWidth,
                        height: video.videoHeight,
                        readyState: video.readyState,
                      });
                      video.play().catch((error) => {
                        console.warn("[DASHBOARD] Playback start failed:", error);
                      });
                    }}
                    onPlaying={() => {
                      setStreamStatus("live");
                      setStreamError("");
                      console.log("[DASHBOARD] Remote video is playing.");
                    }}
                    onWaiting={() => {
                      setStreamStatus("connecting");
                    }}
                    onError={(event) => {
                      console.error("[DASHBOARD] HTML video element error:", event.currentTarget.error);
                      setStreamError("The video element could not decode the incoming stream.");
                    }}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                  {!remoteStream && jpegFrameUrl && (
                    <img
                      src={jpegFrameUrl}
                      alt="Live camera frame"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  )}
                  {(!remoteStream && !jpegFrameUrl) && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-xs text-slate-400">
                      <span className="text-4xl text-slate-600">◉</span>
                      <span>{streamError || "Waiting for WebRTC video stream..."}</span>
                    </div>
                  )}
                  {remoteStream && streamStatus !== "live" && !streamError && (
                    <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white">
                      Connecting video frames…
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-3 overflow-hidden rounded-lg border border-white/10 bg-[#1b2029]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {selectedCamera?.deviceName || "Live Camera Viewer"}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {selectedCamera?.deviceId || "Select a camera to start live viewing"}
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-300">
                    DCAST CLOUD STREAM (FALLBACK)
                  </span>
                </div>
                <div className="aspect-video bg-black">
                  <iframe
                    title="DCAST Cloud Live Camera"
                    src={DCAST_EMBED_URL}
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture; payment; clipboard-write"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    className="h-full w-full border-0"
                  />
                </div>
              </div>

              {loadingCameras ? (
                <div className="rounded-lg border border-white/10 bg-[#1b2029] p-10 text-center text-sm text-slate-400">
                  Loading camera devices...
                </div>
              ) : cameraError ? (
                <div className="rounded-lg border border-red-500/20 bg-[#1b2029] p-8 text-center">
                  <p className="text-sm text-red-400">{cameraError}</p>
                  <button
                    type="button"
                    onClick={loadCameras}
                    className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                  >
                    Retry
                  </button>
                </div>
              ) : cameras.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-[#1b2029] p-10 text-center">
                  <div className="text-3xl text-slate-600">▣</div>
                  <p className="mt-3 text-sm font-semibold text-white">
                    No Cameras Found
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Register and pair your first camera device to see it
                    here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {cameras.map((camera) => {
                    const status = getStatusClasses(camera.status);
                    const isSelected =
                      selectedCamera?.deviceId === camera.deviceId;

                    return (
                      <div
                        key={camera.deviceId}
                        className={`group min-w-0 overflow-hidden rounded-lg border bg-[#202630] ${
                          isSelected
                            ? "border-emerald-500/50"
                            : "border-white/10"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => selectCamera(camera, true)}
                          className="relative flex aspect-video w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#263449] via-[#172233] to-[#0b101b] text-left"
                        >
                          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                camera.status === "online"
                                  ? "animate-pulse bg-emerald-400"
                                  : camera.status === "offline"
                                  ? "bg-red-400"
                                  : "bg-slate-500"
                              }`}
                            />
                            <span
                              className={`text-[9px] font-semibold uppercase ${status.text}`}
                            >
                              {status.label}
                            </span>
                          </div>

                          <span className="absolute right-3 top-3 max-w-[45%] truncate rounded bg-black/60 px-2 py-1 text-[9px] text-white">
                            {camera.deviceId}
                          </span>

                          <span className="text-4xl text-slate-600">▣</span>

                          <span className="mt-3 px-3 text-center text-xs font-semibold text-slate-300">
                            {camera.status === "online"
                              ? "Camera connected · awaiting video stream"
                              : camera.status === "offline"
                              ? "Camera is currently offline"
                              : camera.status === "disabled"
                              ? "Camera has been disabled"
                              : "Camera status unavailable"}
                          </span>

                          <span className="mt-1 text-[9px] text-slate-500">
                            WebRTC live video will appear here
                          </span>
                        </button>

                        <div className="flex items-center justify-between gap-2 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">
                              {camera.deviceName}
                            </p>
                            <p className="mt-1 text-[9px] capitalize text-slate-500">
                              {camera.deviceType?.replace("_", " ") ||
                                "Camera"}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => selectCamera(camera, true)}
                            className="shrink-0 rounded-md border border-white/10 px-3 py-2 text-[9px] text-slate-300 hover:bg-white/5"
                          >
                            Details
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Bottom Status Bar */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-[#1b2029] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-slate-400">
                    {onlineCount} Cameras Online
                  </span>
                </div>

                <span className="text-[10px] text-red-400">
                  {offlineCount} Offline
                </span>

                <span className="text-[10px] text-slate-400">
                  {disabledCount} Disabled
                </span>

                <div className="text-[10px] text-slate-500">
                  Selected: {selectedCamera?.deviceName || "None"}
                </div>

                <div className="text-[10px] text-slate-500">
                  Smart CCTV BD
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Dashboard;

