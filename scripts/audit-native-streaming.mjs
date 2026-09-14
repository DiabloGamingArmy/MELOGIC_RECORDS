import fs from 'node:fs'

const files = {
  backend: fs.readFileSync('functions/src/music/musicDistribution.js', 'utf8'),
  rules: fs.readFileSync('storage.rules', 'utf8'),
  service: fs.readFileSync('src/data/distributionService.js', 'utf8'),
  distribution: fs.readFileSync('src/distribution.js', 'utf8'),
  musicService: fs.readFileSync('src/data/musicService.js', 'utf8'),
  music: fs.readFileSync('src/music.js', 'utf8')
}

const checks = [
  ['backend validates Storage audio', files.backend.includes('loadTrustedStreamAudio')],
  ['backend enforces audio ownership metadata', files.backend.includes("assetRole !== 'stream_audio'")],
  ['approval revalidates audio', files.backend.includes('trustedApprovalAudioByTrackId')],
  ['storage has Distribution audio namespace', files.rules.includes('/distribution/{releaseId}/audio/{trackId}/')],
  ['storage checks metadata keys', files.rules.includes("metadata.keys().hasAll(['ownerUid', 'releaseId', 'trackId', 'assetRole'])")],
  ['client uses resumable upload', files.service.includes('uploadBytesResumable')],
  ['client writes stream_audio metadata', files.service.includes("assetRole: 'stream_audio'")],
  ['Distribution owns upload UI', files.distribution.includes('data-track-audio')],
  ['Streaming has no upload control', !files.music.includes('data-track-audio')],
  ['Streaming requires internal_audio', files.musicService.includes("track.playbackType === 'internal_audio'")],
  ['Streaming player uses native predicate', files.music.includes('isNativeMusicTrackPlayable(track)')]
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed += 1
}
if (failed) {
  console.error(`\nNative streaming audit failed: ${failed} check(s).`)
  process.exit(1)
}
console.log('\nNative streaming static contract audit passed.')
