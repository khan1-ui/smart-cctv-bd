# Smart CCTV BD — deployment handoff

## Repository layout

- `backend/`: Express API, MongoDB models, Socket.IO namespaces and scheduled jobs.
- `frontend/`: Vite + React dashboard and mobile camera page.
- `render.yaml`: Render API service blueprint (set `MONGO_URI` and `CLIENT_URL` in Render).
- `frontend/netlify.toml`: Netlify build and SPA route fallback.

## Local setup

1. Copy `backend/.env.example` to `backend/.env` and set a real MongoDB URI and a random JWT secret (32+ characters).
2. Run `cd backend && npm ci && npm test && npm start`.
3. Copy `frontend/.env.example` to `frontend/.env` and use local values:
   - `VITE_API_URL=http://localhost:5000/api`
   - `VITE_SOCKET_URL=http://localhost:5000`
   - `VITE_MEDIAMTX_WEBRTC_URL=http://localhost:8889/mystream/`
4. Run `cd frontend && npm ci && npm run lint && npm run build`.

## Render (backend)

- Root directory: `backend`
- Build: `npm ci`
- Start: `npm start`
- Health check: `/api/health`
- Set `MONGO_URI`, `JWT_SECRET` (32+ random characters), and `CLIENT_URL` to the exact Netlify origin, e.g. `https://your-site.netlify.app`.
- If using a Netlify custom domain, include that exact origin in `CLIENT_URL`; comma-separated origins are supported.
- MongoDB Atlas network access must permit the Render service to connect. Prefer a restricted network policy where possible; do not publish database credentials.

## Netlify (frontend)

- Base directory: `frontend`
- Build command: `npm run build`
- Publish directory: `dist`
- Set `VITE_API_URL=https://<render-service>.onrender.com/api`
- Set `VITE_SOCKET_URL=https://<render-service>.onrender.com`
- Set `VITE_MEDIAMTX_WEBRTC_URL` to a publicly reachable HTTPS MediaMTX WebRTC reader URL. It is not the Render API URL.
- Vite `VITE_*` values are embedded in public browser assets. Never put secrets in them.

## Video / WebRTC deployment blocker

The React iframe is now configurable and has no production localhost fallback. A Render HTTP web service does not automatically provide the UDP ICE media path required by MediaMTX WebRTC. The browser reader URL alone is insufficient: configure MediaMTX with a publicly reachable ICE UDP/TCP address, or use a TURN/media relay or a hosting platform that supports the required media transport. Verify from a phone on a different network before the ICT demo. Cloudflare Quick Tunnel is temporary and its HTTP tunnel does not, by itself, guarantee WebRTC UDP reachability.

## Security notes

- Anonymous MediaMTX publish/read must not be enabled for an internet-facing deployment. Configure authenticated publisher/viewer credentials and restrict access per camera before exposing it.
- The API includes in-memory per-process rate limiting. If running multiple instances, move rate-limit state to a shared store (e.g. Redis) for consistent enforcement.
- JWT is currently stored by the frontend in localStorage. Keep dependencies updated, avoid untrusted HTML, and consider an HttpOnly-cookie session design before production.
- `CLIENT_URL` is an allowlist, not a wildcard. Keep it limited to trusted origins.
- Rotate any credential that was ever committed or shared. `.env` files are ignored and must not be committed.

## What was changed in this hardening pass

- Added baseline security response headers, explicit CORS allowlist parsing, JSON/form body limits and API-wide request limiting.
- Added tighter rate limits to login, registration and camera pairing endpoints.
- Added Render-friendly proxy/IP handling, `0.0.0.0` binding and startup validation for required secrets.
- Added Socket.IO payload limit and explicit allowed origins.
- Added frontend environment-based API, Socket.IO and MediaMTX URLs; production no longer silently points at localhost.
- Added Netlify SPA rewrite, Render blueprint, environment examples and backend rate-limit smoke tests.

This is a code-hardening and deployment-preparation pass, not a full penetration test. Complete end-to-end tests with real Render/Netlify/MediaMTX URLs and a second mobile network before production use.
