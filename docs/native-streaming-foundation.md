# Native Streaming Foundation

Native Streaming is the default public live-streaming provider for new Melogic Music streams. It is not a WebRTC room and it is not routed through Ant Media. LiveKit remains available as the alternate realtime provider for testing and low-latency collaboration.

## Provider IDs

- `nativeStreaming`: browser MediaRecorder chunks uploaded to Firebase Storage with Firestore segment metadata.
- `livekit`: WebRTC room playback.

Stream documents store the selected provider with `provider`, `providerLabel`, `ingestMode`, `playbackMode`, `streamMethodLockedAtStart`, `selectedProviderUpdatedAt`, and `selectedProviderUpdatedBy`. Native streams also store a `nativeStreaming` object for buffer, segment, and status state.

## Segment Flow

The host Program Mixer remains responsible for final program output. When Native Streaming is selected, listener playback demand is observed in Firebase Realtime Database. If at least one listener has clicked Listen, the host browser records the final program media stream with MediaRecorder and uploads audio-first chunks.

- Storage path: `liveSegments/{streamId}/audio/{segmentIndex}.webm`
- Segment metadata: `musicLiveStreams/{streamId}/segments/{segmentId}`
- Playback mode: delayed Firebase segment buffering
- Current MVP: audio-first; video segment support remains experimental/future work

Metadata for the live stream stays public while the host is live, even when no listeners have requested playback and no segment docs exist yet.

## Playback Demand

Listener demand is RTDB presence, not Firestore presence:

- `livePresence/{streamId}/playbackDemand/{viewerSessionId}` tracks local listener demand.
- Anonymous listeners may write a small demand node with no `uid`.
- Signed-in listeners must write their own `auth.uid`.
- `viewerCounts` are read-only to normal clients.
- `host` presence is writable only by the host uid recorded in the node.

When the demand count falls to zero, the host stops segment recording after an idle grace period. Starting demand again restarts local recording from Program Mixer output.

## Security Intent

Firestore rules allow public reads for live public/unlisted/password stream segment metadata and host writes for native segment documents. Storage rules allow public reads of live public segment blobs and host-only writes/deletes under `liveSegments/{streamId}`. RTDB rules default deny outside the presence paths above.
