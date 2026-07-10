# Studio Live Backstage Architecture

Studio Live is the operator surface. The public Melogic Music listener page is the audience surface. Workflows should keep those concerns separate.

## Operator Surface

Studio Live contains:

- Stream Details
- Input Source
- Program Mixer
- Sequence Editor
- Manual Metadata
- Chat
- Preview / Monitor
- Safety

Input Source owns the master audio/video gates. Program Mixer owns scene/source state. Sequence Editor owns playout and asset preview.

## Local Preview Rules

Media Asset Preview is local-only:

- Preview starts from Media Assets -> menu -> Preview.
- Preview shows `Previewing: [asset title]`, progress, Stop Preview, optional Pause Preview, and preview volume.
- Starting a second preview stops the first.
- Leaving the Sequence Editor stops the preview unless the control stays visible.
- Preview audio is never connected to the program bus or LiveKit public stream.

## Public Listener Rules

The public page reads normalized stream state:

- If `videoEnabled` is false, video collapses.
- If video is available, the listener sees a top/back visual area with a hover `Click to Watch Stream` affordance.
- Clicking starts the listener join path and expands the video in-page.
- `Hide Video` collapses the in-page video without ending the listener session.

## Operational Notes

LiveKit room/media elements should be treated as long-lived runtime objects. UI rerenders should reattach existing media elements instead of recreating rooms or forcing playback-rate catch-up.

Provider changes are setup-time decisions. Studio should block provider switching while a stream is active.
