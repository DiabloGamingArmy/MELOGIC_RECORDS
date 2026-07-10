# Ant Media Community Verification

This note records what still needs to be verified before replacing LiveKit with Ant Media in production.

## Verified From Official Docs

- Ant Media documents ultra-low-latency WebRTC, HLS, LL-HLS, DASH/CMAF, RTMP, SRT, and other streaming modes in its product docs: [Ant Media docs overview](https://docs.antmedia.io/).
- HLS playback is documented as available for both Community and Enterprise editions: [HLS playback](https://docs.antmedia.io/guides/playing-live-stream/hls-playing/).
- WebRTC playback documentation states the WebRTC playback guide requires Enterprise Edition: [WebRTC playback](https://docs.antmedia.io/guides/playing-live-stream/webrtc-playback/).
- LL-HLS is documented as an Enterprise/plugin path, not a free Community baseline: [LL-HLS playback](https://docs.antmedia.io/guides/playing-live-stream/ll-hls/).

## Product Decision

Community Edition may be useful for HLS-style playback validation, but the Melogic Studio target includes low-latency creator/operator publishing and listener playback. Before migration, verify:

- Whether Community Edition supports the exact browser WebRTC publish/play path Melogic needs.
- Whether HLS latency is acceptable for listener mode.
- Whether Enterprise, paid plugins, or another relay is required for low-latency public playback.
- Recording/egress requirements for archive and replay.

## Current Implementation Status

The repository contains a safe Ant Media foundation:

- Public config helpers.
- Playback URL helpers.
- Provider diagnostics fields.
- Firebase Functions stubs for session metadata, playback authorization, and webhook default-deny handling.

It does not yet contain a real browser publish adapter or secret-backed Ant Media REST integration.
