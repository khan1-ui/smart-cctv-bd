
import { Link } from "react-router-dom";

function AuthLayout({ children, title, subtitle }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#edf5ff] p-4 md:p-8">

      {/* Decorative Background */}
      <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-blue-200/50 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-16 h-64 w-64 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 top-0 h-16 w-16 rounded-full bg-indigo-300/40 blur-xl" />

      {/* Main Auth Card */}
      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl md:min-h-[620px] md:grid-cols-2">

        {/* Left Image Panel */}
        <div
          className="relative hidden min-h-[620px] bg-cover bg-center md:flex md:flex-col md:justify-end"
          style={{
            backgroundImage:
              "url('/images/smart-cctv-auth-photo.jpg')",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/10" />

          <div className="relative z-10 p-10 text-white">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-2 text-xs font-medium backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              SMART SECURITY SOLUTION
            </div>

            <h2 className="max-w-sm text-3xl font-bold leading-tight">
              Your Security,
              <br />
              Our Priority.
            </h2>

            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-200">
              Monitor your cameras, manage your devices
              and stay connected with your security system
              from anywhere.
            </p>

            <div className="mt-8 flex items-center gap-2">
              <span className="h-1.5 w-8 rounded-full bg-white" />
              <span className="h-1.5 w-1.5 rounded-full bg-white/50" />
              <span className="h-1.5 w-1.5 rounded-full bg-white/50" />
            </div>

            <p className="mt-8 text-xs text-slate-300">
              Smart CCTV BD © 2026
            </p>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="flex items-center justify-center px-6 py-10 sm:px-10 md:px-12">
          <div className="w-full max-w-md">

            {/* Brand */}
            <Link
              to="/login"
              className="mb-10 flex items-center justify-center gap-3"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-xl font-bold text-slate-950">
                S
              </div>

              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Smart CCTV BD
                </h1>
                <p className="text-xs text-slate-500">
                  Smart Security. Simple Monitoring.
                </p>
              </div>
            </Link>

            {/* Heading */}
            <div className="mb-7">
              <h2 className="text-2xl font-bold text-slate-900">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {subtitle}
              </p>
            </div>

            {children}

          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
