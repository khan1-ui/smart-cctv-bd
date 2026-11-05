import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:5000/api" : "");

if (!API_BASE_URL) {
  console.error("VITE_API_URL is not configured for the camera device.");
}

const SOCKET_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

const cameraDeviceApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

const getDeviceHeaders = () => {
  const deviceId = sessionStorage.getItem("cameraDeviceId");
  const deviceSecret = sessionStorage.getItem("cameraDeviceSecret");

  if (!deviceId || !deviceSecret) {
    throw new Error("Camera device credentials are not available.");
  }

  return {
    "x-device-id": deviceId,
    "x-device-secret": deviceSecret,
  };
};

export const getCameraDeviceSocketConfig = () => {
  const deviceId = sessionStorage.getItem("cameraDeviceId");
  const deviceSecret = sessionStorage.getItem("cameraDeviceSecret");

  if (!deviceId || !deviceSecret) {
    throw new Error("Camera device credentials are not available.");
  }

  return {
    url: `${SOCKET_BASE_URL}/devices`,
    auth: { deviceId, deviceSecret },
  };
};

export const registerCameraDevice = async (pairingCode, deviceName) => {
  const response = await cameraDeviceApi.post("/devices/register", {
    pairingCode,
    deviceName,
  });

  const device = response.data?.data;

  if (!device?.deviceId || !device?.deviceSecret) {
    throw new Error("Device registration response is incomplete.");
  }

  sessionStorage.setItem("cameraDeviceId", device.deviceId);
  sessionStorage.setItem("cameraDeviceSecret", device.deviceSecret);

  return device;
};

export const authenticateCameraDevice = async () => {
  const response = await cameraDeviceApi.get("/devices/me", {
    headers: getDeviceHeaders(),
  });

  return response.data?.data;
};

export const sendCameraHeartbeat = async () => {
  const response = await cameraDeviceApi.post(
    "/devices/heartbeat",
    {},
    { headers: getDeviceHeaders() }
  );

  return response.data?.data;
};

export const clearCameraDeviceCredentials = () => {
  sessionStorage.removeItem("cameraDeviceId");
  sessionStorage.removeItem("cameraDeviceSecret");
};

export const getStoredCameraDeviceId = () =>
  sessionStorage.getItem("cameraDeviceId");
