# Native Streaming Deploy Checklist

Use this before shipping Live Studio Native Streaming changes to production.

## Backend

- Confirm callable functions are exported from `functions/index.js`:
  - `getStreamingProviderStatus`
  - `prepareMusicLiveStreamDraft`
  - `markMusicLiveStreamOnAir`
  - `heartbeatMusicLiveStream`
  - `joinMusicLiveStream`
  - `endMusicLiveStream`
- Confirm callable region is `us-central1`; browser clients use `getFunctions(app, 'us-central1')`.
- Deploy functions after backend changes:

```sh
FIREBASE_CLI_UPDATE_CHECK=false firebase deploy --only functions --project melogic-records
```

- Confirm the function is present after deploy:

```sh
FIREBASE_CLI_UPDATE_CHECK=false firebase functions:list --project melogic-records
```

## Rules

- Deploy Firestore rules after chat or stream document permission changes:

```sh
FIREBASE_CLI_UPDATE_CHECK=false firebase deploy --only firestore:rules --project melogic-records
```

- Deploy Realtime Database rules if native demand or host presence paths change:

```sh
FIREBASE_CLI_UPDATE_CHECK=false firebase deploy --only database --project melogic-records
```

- Deploy Storage rules if segment upload or playback path permissions change:

```sh
FIREBASE_CLI_UPDATE_CHECK=false firebase deploy --only storage --project melogic-records
```

## Hosting

- Build and deploy hosting after client or CSP changes:

```sh
npm run check
npm run build
FIREBASE_CLI_UPDATE_CHECK=false firebase deploy --only hosting --project melogic-records
```

- Confirm the production CSP report-only header includes RTDB endpoints:
  - `https://melogic-records-default-rtdb.firebaseio.com`
  - `https://*.firebaseio.com`
  - `wss://melogic-records-default-rtdb.firebaseio.com`
  - `wss://*.firebaseio.com`

## Smoke Test

- Open `/studio/live`, load provider status, and confirm a missing or undeployed `getStreamingProviderStatus` does not block Native Streaming startup.
- Start a Native Streaming session and confirm the Start button leaves `Starting...` after success or shows a visible error on failure.
- Hard refresh while host live and confirm Studio shows the recovery panel instead of pretending the recorder is active.
- Click Resume Stream and confirm heartbeat, demand, recorder state, MIME type, segment index, blob size, upload path, and upload errors appear in Native Diagnostics.
- Open the public live page, click Listen, and confirm listener status distinguishes host offline, no segments yet, and playable audio.
- Send and receive live chat messages without requiring the stream to have published LiveKit tracks.
- End the stream and confirm recorder, host presence, heartbeat, Firestore status, and UI controls settle within a few seconds.
