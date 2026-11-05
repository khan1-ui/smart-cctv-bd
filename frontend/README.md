# Smart CCTV BD — Frontend

## Local development

```bash
cp .env.example .env
npm ci
npm run dev
```

For local development, set the API and Socket.IO URLs to `http://localhost:5000` and the MediaMTX reader to `http://localhost:8889/mystream/`.

## Netlify deployment

- Base directory: `frontend`
- Build command: `npm run build`
- Publish directory: `dist`
- Configure `VITE_API_URL`, `VITE_SOCKET_URL`, and `VITE_MEDIAMTX_WEBRTC_URL` in Netlify environment variables.
- `VITE_*` values are public client-side configuration; never store secrets there.
- `netlify.toml` includes the SPA fallback needed by React Router.

The video URL must be a publicly reachable HTTPS MediaMTX WebRTC reader endpoint. A Render HTTP API URL is not a substitute for the media endpoint.
