
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import CameraDevice from "./pages/CameraDevice";

import { getMyProfile } from "./services/auth";

function ProtectedRoute({ children }) {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let active = true;

    const verifyUser = async () => {
      const token = localStorage.getItem("accessToken");

      if (!token) {
        if (active) setStatus("unauthorized");
        return;
      }

      try {
        await getMyProfile();

        if (active) setStatus("authorized");
      } catch {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("user");

        if (active) setStatus("unauthorized");
      }
    };

    verifyUser();

    return () => {
      active = false;
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080d1c]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400" />
          <p className="mt-4 text-sm text-slate-400">
            Verifying your account...
          </p>
        </div>
      </div>
    );
  }

  return status === "authorized"
    ? children
    : <Navigate to="/login" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/dashboard" replace />}
        />

        <Route path="/login" element={<Login />} />

        <Route path="/register" element={<Register />} />

        {/* Mobile Camera Device - Separate Authentication */}
        <Route
          path="/camera"
          element={<CameraDevice />}
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={<Navigate to="/dashboard" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
 