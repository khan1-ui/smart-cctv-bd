# Smart CCTV BD backend update notes

This backend was prepared by merging the reviewed feature changes into the backend archive you uploaded.

## Added/updated
- `PATCH /api/users/password` protected password-change endpoint (current password required).
- JWT `tokenVersion` check; password changes invalidate existing user sessions.
- Camera owner rename and remove endpoints.
- Recording metadata model and APIs:
  - `GET /api/recordings/:deviceId`
  - `POST /api/recordings/:deviceId`
  - `DELETE /api/recordings/:recordingId`
  - `POST /api/devices/:deviceId/recordings` (device-authenticated metadata submission)
- `recordings_view` camera-sharing permission.
- API mount at `/api/recordings`.

## Deploy
1. Back up your GitHub backend folder.
2. Replace the repository's backend folder contents with this ZIP's contents.
3. Do not upload `.env`; keep Render environment variables in Render.
4. Commit and push. Confirm Render deploy succeeds.
5. Test `PATCH /api/users/password` after signing in again.

This is a source-code merge, not proof of production readiness. Native continuous recording, actual video file transfer/playback, hardware firmware integration, and end-to-end WebRTC recovery still require implementation/testing.
