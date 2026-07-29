# Melogic browser livestream incident report

Date: 2026-07-28

## Finding

The failed stream was not limited by the browser's selected canvas resolution,
Hetzner delivery capacity, or GCE CPU saturation.

- Studio produced a 1920×1080, 30 fps program and requested 12 Mbps.
- WebRTC delivered only about 281 kbps.
- The peer and ICE states remained `connected`, which proves connectivity but
  does not prove usable media throughput.
- SRS logged missing RTP sequence numbers, repeated NACK and PLI activity,
  SRTP unprotect failures, and video measurements of 0 kbps / 0 fps.
- SRS stayed near 5–6% CPU and about 35 MiB of memory during the incident.
- The Hetzner edge successfully requested manifests and the small transport
  stream segments that SRS managed to create.

The immediate fault was the lossy UDP WebRTC media path between the host
browser and the GCE SRS origin. The muddy audio had a separate cause: SRS's
default WebRTC-to-RTMP AAC transcode rate was only 48 kbps.

## Production changes applied

Google Cloud:

- Added TCP/8000 to `allow-srs-ingest-http`.
- Kept UDP/8000 available for rollback and diagnostics.

SRS origin (`freetierlivestream`, `us-central1-c`):

- Enabled WebRTC-over-TCP on port 8000.
- Forced SRS-generated media candidates to TCP so the browser cannot select
  the known-bad UDP route.
- Kept WHIP signaling behind HTTPS, OBS RTMP on TCP/1935, the SRS API on
  TCP/1985, and the HLS origin on TCP/8080.
- Raised RTC-to-RTMP AAC output from 48 kbps to 192 kbps.
- Changed RTC-to-RTMP PLI/keyframe requests from six seconds to two seconds.
- Enabled immediate RTP rate initialization from SDP for faster A/V sync.
- Retained stopped rollback containers on the VM.

Application:

- Uses a practical 1080p30 browser video range: 5 Mbps start, 600 kbps minimum,
  and 8 Mbps maximum.
- Keeps 256 kbps stereo Opus on browser ingest; SRS now creates 192 kbps AAC
  for HLS.
- Reports the selected media protocol, candidate types, candidate RTT,
  available outgoing bandwidth, measured video FPS, and outbound audio/video
  rates.
- Shows the actual HLS manifest error instead of treating HTTP 200 as proof
  that playable segments exist.

The repeatable origin deployment is in
`scripts/deploy-srs-origin-tcp.sh`. It refuses to run during an active stream
and restores the previous container automatically if SRS does not become
healthy.

## Why this matches established live platforms

Twitch recommends CBR, two-second keyframes, 4.5 Mbps for 1080p30, H.264, and
AAC. YouTube recommends two-second keyframes, CBR, H.264, and a substantially
higher 1080p30 source rate, then automatically transcodes the source into
multiple viewer formats. Facebook recommends 3–6 Mbps for 1080p30, H.264,
two-second keyframes, and 128 kbps AAC.

The common model is:

1. Encode one stable, high-quality contribution feed.
2. Ingest it over a reliable transport at a nearby media origin.
3. Transcode it into an adaptive bitrate ladder.
4. Deliver HLS/DASH renditions through an edge/CDN.

Melogic now follows that model through step 2. SRS currently transmuxes the
single browser rendition into HLS; it does not create a true adaptive bitrate
ladder.

## Next test acceptance criteria

Run a new browser stream with motion and music for at least three minutes.
The Studio diagnostic should show:

- Selected media transport: `tcp`
- Outbound video: normally 4,000–8,000 kbps for 1080p30
- Outbound frame rate: close to 30 fps
- HLS health: `healthy`
- A manifest sequence that advances every few seconds
- Outbound audio near its negotiated Opus rate
- No sustained rise in packet loss/NACK counts

If TCP is selected but outbound video remains below 3 Mbps, test the host's
upload speed to `us-central1`. The next infrastructure improvement would be a
regional ingest origin closer to the broadcaster, not a Hetzner edge change.

## Capacity recommendation

The current `e2-micro` sustains only 25% of one physical CPU in aggregate and
is appropriate only while SRS is repackaging a small number of source streams.
It is not an appropriate machine for software 1080p transcoding.

Before adding a 1080p/720p/480p adaptive ladder:

- Upgrade the origin to at least `e2-standard-4` (4 vCPU, 16 GB), or use a
  compute-optimized equivalent.
- Run FFmpeg workers separately from the SRS signaling/origin process.
- Prefer hardware encoding or a managed live transcoder when concurrent
  broadcasts grow.
- Keep Hetzner as the HLS edge unless edge logs show manifest caching or origin
  fetch latency; current evidence does not show either problem.

Google Cloud's managed Live Stream API is another option for RTMP/SRT input and
multi-rendition HLS/DASH output, but a browser WHIP-to-RTMP/SRT gateway would
still be required.

## References

- SRS WebRTC and TCP configuration:
  https://ossrs.io/lts/en-us/docs/v5/doc/webrtc
- SRS complete RTC configuration, including AAC bitrate and PLI interval:
  https://github.com/ossrs/srs/blob/develop/trunk/conf/full.conf
- Twitch broadcasting guidelines:
  https://help.twitch.tv/s/article/broadcasting-guidelines
- YouTube live encoder settings:
  https://support.google.com/youtube/answer/2853702
- Facebook live video format guidelines:
  https://www.facebook.com/help/1534561009906955/
- Google Cloud E2 machine types:
  https://docs.cloud.google.com/compute/docs/general-purpose-machines
- Google Cloud Live Stream API overview:
  https://docs.cloud.google.com/livestream/docs/overview

## Follow-up incident: 2026-07-29

The later pixelation and simultaneous audio/video interruptions are not a
viewer-buffer problem. Production inspection of the active test stream showed:

- The 1920×1080 browser publisher was active, but SRS received only about
  0.49–0.55 Mbps during the inspection.
- The MediaMTX WHEP reader repeatedly received H.264 slices without the
  referenced PPS and logged `decode_slice_header error` / `no frame`.
- The relay also logged malformed or undersized payloads and had to repacketize
  RTP packets larger than its 1440-byte limit.
- HLS segment duration drifted from six seconds to seven, nine, and eleven
  seconds because usable IDR frames did not arrive at a stable interval.
- FFmpeg then reported non-monotonic video DTS. The internal RTSP connection
  timed out, the WHEP source stopped, and MediaMTX destroyed the HLS muxer and
  every attached HLS session. The public manifest consequently returned 404
  while SRS still considered the publisher live.

This explains the observed order of failure: damaged or bandwidth-starved
inter-frames cause pixelation, then loss of the internal relay destroys both
audio and video at once.

The current browser path is also forced through TCP twice: once from the
browser to SRS and again from the MediaMTX WHEP reader to SRS. TCP prevents
packet loss from being skipped, but congestion blocks newer audio and video
behind retransmission of older media. MediaMTX documents UDP as the preferred
WebRTC transport and warns that its TCP transport is less efficient and can
introduce progressive delay under congestion.

### Corrective architecture

The durable correction is:

1. Publish browser WHIP directly to MediaMTX over its static UDP ICE port, with
   TCP retained only as fallback.
2. Remove the SRS → WHEP → RTSP copy chain from browser broadcasts.
3. Normalize the contribution feed into H.264/AAC with a fixed two-second GOP
   before HLS packaging. This restores SPS/PPS at every IDR and gives HLS a
   stable segment boundary.
4. Generate an adaptive rendition ladder so a viewer is not forced to receive
   the single contribution rendition.

Steps 3 and 4 require moving the media worker off the current `e2-micro` or
resizing it. During this incident the VM had no swap, about 239 MiB available
memory, and load averages as high as 10.9. It can continue signaling and
remuxing a test stream, but it is not a safe 1080p software-transcode host.

The receiving app now avoids redundant manifest health requests while media is
actively advancing. Media events remain responsible for detecting a stall,
and manifest polling resumes while playback is stopped so a restarted muxer
can be discovered.
