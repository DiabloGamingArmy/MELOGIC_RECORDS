# Ant Media Deployment Security

Ant Media integration must be server-authorized. Frontend code may receive public playback URLs and short-lived authorization results, but never server admin credentials, REST API secrets, webhook secrets, or long-lived publish credentials.

## Server-Side Controls

Firebase Functions stubs live in `functions/src/streaming/antMediaAccess.js`.

Current behavior:

- Callable session metadata can mark a stream as `provider: "antMedia"`.
- Publish authorization fails safely until the server adapter is implemented.
- Playback authorization returns public playback URLs only when stream metadata is present.
- Publish/play webhooks default-deny unless a webhook secret is configured.
- Webhook origin checks can be enabled with `ANT_MEDIA_ALLOWED_ORIGINS`.

## Required Production Settings

Use server/runtime configuration only:

- `ANT_MEDIA_PUBLIC_BASE_URL`
- `ANT_MEDIA_APP_NAME`
- `ANT_MEDIA_WEBHOOK_SECRET`
- `ANT_MEDIA_ALLOWED_ORIGINS`
- Future server-only REST/API credentials

Do not expose REST credentials through `VITE_*` variables.

## Ant Media Security Features To Evaluate

Official Ant Media docs describe several relevant mechanisms:

- [One-time token control](https://docs.antmedia.io/guides/stream-security/one-time-token-control/)
- [JWT stream security filter](https://docs.antmedia.io/guides/stream-security/jwt-stream-security-filter/)
- [Webhook stream authorization](https://docs.antmedia.io/guides/stream-security/webhook-stream-authorization/)
- [CORS filter](https://docs.antmedia.io/guides/stream-security/cors-filter/)
- [WebRTCAdaptor SDK reference](https://docs.antmedia.io/sdk-reference/webrtc-adaptor/)

## Deployment Checklist

- Lock Ant Media CORS to Melogic production/staging origins.
- Require webhook secret validation.
- Use short-lived publish/play grants.
- Keep Stream IDs unguessable.
- Store only public playback metadata in Firestore.
- Log provider diagnostics without logging secrets.
- Keep LiveKit as fallback until Ant Media publish, playback, and cleanup are proven end to end.
