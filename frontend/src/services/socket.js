import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? "http://localhost:5000" : "");

let socket = null;

export const connectSocket = () => {
  const token = localStorage.getItem("accessToken");
  if (!token) throw new Error("Authentication token not found");
  if (!SOCKET_URL) throw new Error("VITE_SOCKET_URL is not configured");

  if (socket?.connected) return socket;
  if (socket) {
    socket.auth = { token };
    socket.connect();
    return socket;
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20_000,
    transports: ["websocket", "polling"],
  });
  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
};
