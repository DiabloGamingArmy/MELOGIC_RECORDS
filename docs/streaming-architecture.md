# Melogic Live Streaming Architecture

Melogic Live now treats the broadcast as a provider-backed program output instead of an audio-only LiveKit room.

## Current Production Path

- `livekit` remains the working provider for Studio Live.
- Studio publishes browser-mixed audio through the existing LiveKit room.
- Video Input is a master gate. When it is off, local video tracks are unpublished, stopped, and removed from public program state.
- Media Asset Preview is local monitor-only. It uses a browser `Audio` element and never routes into the LiveKit/program output.

## Provider Foundation

Frontend provider modules live under `src/data/streaming/`:

- `livekitProvider.js` wraps the current LiveKit session behavior.
- `antMediaProvider.js` exposes safe public config and playback URL helpers only.
- `streamingProviderRegistry.js` selects the provider.
- `publicPlaybackService.js` decides whether a public stream is playable from provider/program state.

Ant Media is deliberately a foundation in this pass. The frontend does not store or expose Ant Media server secrets, and it does not claim browser publishing is complete.

## Program Mixer Foundation

`ProgramMixer` is the browser-side compositor foundation for OBS-style operation:

- Scenes
- Sources
- Audio Mixer
- Video Mixer / Canvas Layout
- Program Preview
- Stream Output Status

Scene/source state is persisted beneath the creator user document using Firestore-safe subcollection paths:

- `users/{uid}/liveStudio/scenes/items/{sceneId}`
- `users/{uid}/liveStudio/sources/items/{sourceId}`

## Stream Document Fields

`musicLiveStreams/{streamId}` now carries explicit provider/program fields:

- `provider`
- `ingestMode`
- `playbackMode`
- `audioEnabled`
- `videoEnabled`
- `audioPublished`
- `videoPublished`
- `programHasAudio`
- `programHasVideo`
- `activeAudioSources`
- `activeVideoSource`
- `programState`
- `providerDiagnostics`
- Ant Media public playback metadata when applicable

Public listeners should use `publicPlaybackService` and freshness checks instead of assuming `audioPublished === true` is the only valid playable state.

## Ant Media Notes

Ant Media’s documentation lists WebRTC, HLS, LL-HLS, DASH/CMAF, and other delivery modes across editions, but capabilities differ by edition and plugin. Relevant official docs:

- [Ant Media docs overview](https://docs.antmedia.io/)
- [WebRTC playback requirements](https://docs.antmedia.io/guides/playing-live-stream/webrtc-playback/)
- [HLS playback](https://docs.antmedia.io/guides/playing-live-stream/hls-playing/)
- [LL-HLS playback](https://docs.antmedia.io/guides/playing-live-stream/ll-hls/)
