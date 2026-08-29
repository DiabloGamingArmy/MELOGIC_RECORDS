// Geometry callers use this immutable contract to make viewport updates incapable
// of seeking, restarting scheduling, or synchronizing an audio engine position.
export const VIEWPORT_PLAYHEAD_UPDATE_OPTIONS = Object.freeze({
  restartTransport: false,
  syncAudioEngine: false
})

