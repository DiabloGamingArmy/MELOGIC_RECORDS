# Native Streaming Audit

Audit date: 2026-07-14

## Files Inspected

- `src/studio.js`
- `src/music.js`
- `src/data/musicLiveService.js`
- `src/data/streaming/nativeStreamingProvider.js`
- `src/data/streaming/nativeStreamingPresence.js`
- `src/data/streaming/publicPlaybackService.js`
- `src/data/streaming/streamingProviderRegistry.js`
- `src/data/streaming/streamingProviderTypes.js`
- `src/firebase/realtimeDatabase.js`
- `functions/src/music/musicLiveStreams.js`
- `functions/src/streaming/antMediaAccess.js`
- `firestore.rules`
- `storage.rules`
- `realtimedb.rules`
- `firebase.json`

## Features Mentally Tested

- New Live Studio draft defaults to `nativeStreaming`.
- Stream Details Advanced Streaming Settings switches between `nativeStreaming` and `livekit`.
- Program Mixer no longer owns provider selection.
- Native host starts live with zero viewers and no segment uploads.
- Music grid renders stream metadata before any segment docs exist.
- Listener page does not create playback demand until Listen is clicked.
- RTDB playback demand path is `livePresence/{streamId}/playbackDemand/{viewerSessionId}`.
- Anonymous and signed-in demand payloads align with RTDB rules.
- Host starts one MediaRecorder when demand count is greater than zero.
- Demand returning to zero starts a grace period without new segment uploads.
- Listener buffering waits for ready ordered segment docs.
- Chat subscriptions remain independent from segment playback.
- Guest/backstage flow remains host-controlled and does not create public playback demand.
- Firestore, Storage, and RTDB rules load in local emulators.

## Issues Found

- Listener playback started from the first available segment immediately, instead of waiting for the configured buffer.
- Listener segment advancement was tied to the first segment closure, so sequential playback could stall after the second segment.
- RTDB viewer session IDs could collide when a browser duplicated `sessionStorage` into another tab.
- `onDisconnect()` handlers were registered after RTDB writes, leaving a small race window.
- Host recorder grace period could continue uploading chunks even after demand count reached zero.
- Segment upload success did not update the parent stream `nativeStreaming` status, so public cards could remain in a buffering/waiting state even after playable chunks existed.
- Native broadcast state used mixed snake-case and camel-case values.
- Password-protected streams exposed a risky direct-segment model because Firestore/Storage rules could not prove a listener passed the password.
- Segment rules did not constrain segment paths tightly enough.
- Stream metadata used old cover/host field names only, while newer native stream surfaces expect aliases such as `coverImageURL`, `coverStoragePath`, and `hostAvatarURL`.
- Now-playing metadata lacked `sourceType`, `sourceId`, `startedAt`, and `durationMs`.

## Fixes Applied

- Made Native listener playback wait for `minPlaybackBufferMs / segmentDurationMs` ready segments before starting.
- Reworked sequential segment playback to advance by segment index and recover to buffering if the next segment is not available yet.
- Added a runtime-unique viewer session cache so duplicated tabs do not share a playbackDemand node.
- Registered RTDB `onDisconnect()` handlers before writing listener and host presence.
- Counted only `buffering` and `listening` RTDB demand nodes as active demand; `paused` no longer triggers host uploads.
- Added recorder callbacks so chunks are skipped when demand count is zero or the stream is ending.
- Updated parent stream native status after successful segment metadata writes.
- Normalized Native broadcast state to `idleNoListeners`, `warmingBuffer`, `broadcasting`, and `pausedNoListeners`.
- Removed public segment read access for `password` streams until authorized segment delivery exists.
- Added explicit UI failure text for password-protected Native playback instead of creating demand and buffering forever.
- Added Firestore and Storage path guards for `liveSegments/{streamId}/{audio|video|av}/{segmentIndex}.webm`.
- Added cover and host metadata aliases in server writes and client normalization.
- Added complete now-playing metadata payload fields.

## Remaining TODOs

- Add an authorized callable or signed URL flow for password-protected Native Streaming segment playback.
- Add backend scheduled cleanup for expired `liveSegments` blobs and segment docs; current `cleanupOldSegments` remains a placeholder.
- Add upload cancellation or orphan cleanup for blobs uploaded just before host end/network loss.
- Add production viewer count aggregation from RTDB playback demand into read-only `viewerCounts`, if the UI should display RTDB listener counts instead of Firestore presence counts.
- Add automated tests for RTDB rule allow/deny cases.
- Add an optional MSE-based listener path if gapless segment playback becomes a requirement.
- Add video/AV segment support only after cost, rules, and playback behavior are explicitly designed.

## Known Limitations

- Native Streaming is audio-first.
- Password-protected Native Streaming now fails closed for audio playback because direct client reads cannot prove password authorization.
- Segment cleanup is documented but not yet implemented.
- A Storage blob may still complete upload if a stream ends during an in-flight upload; metadata is skipped when the active-stream guard fails.
- Firestore segment polling is intentionally simple and low frequency; it is adequate for the foundation but not a final radio-grade playback engine.

## Manual Test Checklist

- Provider selection: create a draft, verify Native Streaming default, switch to LiveKit, refresh, switch back to Native Streaming.
- Metadata grid visibility: go live with zero listeners and confirm Music grid shows title, cover, host, category, and state.
- RTDB playbackDemand: click Listen and confirm `livePresence/{streamId}/playbackDemand/{viewerSessionId}` is created with valid uid/null uid.
- Zero viewer idle: stay live with no listeners and confirm no `liveSegments` uploads or segment docs are created.
- Greater-than-zero warm buffer: click Listen and confirm host status moves to warming buffer and starts one recorder.
- Segment upload: confirm Storage path is `liveSegments/{streamId}/audio/{index}.webm` and segment doc is lightweight and ready only after upload.
- Listener buffer: click Listen before chunks exist and confirm “Starting stream buffer...” remains until enough ready segments exist.
- Chat while idle: send/read chat without clicking Listen and confirm no playbackDemand node is written.
- Chat while buffering: receive/send chat while buffering and confirm audio element is not remounted.
- Guest invite: join guest setup and confirm no public playbackDemand node or segment upload is triggered by guest setup alone.
- Host disconnect: refresh/close host tab and confirm RTDB host presence eventually moves offline and recorder stops.
- Listener disconnect: close listener tab and confirm RTDB playbackDemand node is removed by onDisconnect.
- Stream end cleanup: end stream and confirm recorder stops, demand observer unsubscribes, and stream status becomes ended.
- Rules validation: run Firestore, Storage, and Realtime Database emulators and confirm rules load.
