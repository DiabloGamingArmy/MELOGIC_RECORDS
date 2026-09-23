import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const [community, playback, css] = await Promise.all([
  fs.readFile(new URL('../src/community.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/community/videoPlayback.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/styles/community.css', import.meta.url), 'utf8')
])

test('Community feed video never delegates playback to raw native controls', () => {
  const renderStart = community.indexOf("if (attachment.type === 'video')")
  const renderEnd = community.indexOf("if (attachment.type === 'audio')", renderStart)
  const videoMarkup = community.slice(renderStart, renderEnd)
  assert.ok(renderStart >= 0 && renderEnd > renderStart)
  assert.match(videoMarkup, /data-community-feed-video/)
  assert.match(videoMarkup, /playsinline/)
  assert.match(videoMarkup, /webkit-playsinline/)
  assert.match(videoMarkup, /preload="none"/)
  assert.match(videoMarkup, /data-community-video-src/)
  assert.doesNotMatch(videoMarkup, /\scontrols(?:\s|=|>)/)
})

test('feed video coordinator keeps one playback authority and guards lifecycle handoffs', () => {
  assert.match(playback, /pauseAll\(video\)/)
  assert.match(playback, /PLAY_THRESHOLD/)
  assert.match(playback, /warmObserver/)
  assert.match(playback, /AUTOPLAY_DWELL_MS/)
  assert.match(playback, /intentionalRelease/)
  assert.match(playback, /community-modal-open/)
  assert.match(playback, /AudioVolumeUp/)
  assert.match(playback, /pause:\s*pauseWithin/)
  assert.match(community, /captureMobileCommunitySurface[\s\S]*?communityFeedVideoPlayback\.pause\(root\)/)
  assert.match(community, /captureDesktopCommunitySurface[\s\S]*?communityFeedVideoPlayback\.pause\(root\)/)
  assert.match(community, /captureFeedNavigationSnapshot[\s\S]*?communityFeedVideoPlayback\.pause\(root\)/)
})

test('blocked autoplay falls back to Melogic controls instead of a browser player', () => {
  assert.match(css, /data-community-video-state="blocked"[\s\S]*?community-feed-video-load-state[\s\S]*?display:\s*none/)
  assert.match(css, /community-feed-video-play-indicator/)
  assert.match(css, /community-feed-video-mute-toggle/)
})
