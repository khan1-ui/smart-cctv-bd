import axios from "axios";

const configuredApiUrl = import.meta.env.VITE_API_URL;
const API_BASE_URL = configuredApiUrl ||
  (import.meta.env.DEV ? "http://localhost:5000/api" : "");

if (!API_BASE_URL) {
  // Fail visibly rather than silently sending production requests to localhost.
  console.error("VITE_API_URL is not configured. Set it in the Netlify environment variables.");
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("accessToken");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user");
    }
    return Promise.reject(error);
  }
);

export default api;
