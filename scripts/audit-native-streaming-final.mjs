import fs from 'node:fs'
const js=fs.readFileSync('src/music.js','utf8')
const svc=fs.readFileSync('src/data/musicService.js','utf8')
const dist=fs.readFileSync('src/distribution.js','utf8')
const backend=fs.readFileSync('functions/src/music/musicDistribution.js','utf8')
const rules=fs.readFileSync('storage.rules','utf8')

const checks=[
 ['native predicate exists',svc.includes('isNativeMusicTrackPlayable')],
 ['release queue uses native predicate',js.includes('state.tracks.filter((track) => isNativeMusicTrackPlayable(track))')],
 ['track rows use native predicate',js.includes('const playable = isNativeMusicTrackPlayable(track)')],
 ['audio engine rejects non-native tracks',/function ensureAudio\(track\)\s*\{\s*if \(!isNativeMusicTrackPlayable\(track\)\)/.test(js)],
 ['toggle rejects non-native tracks',/async function toggleTrack\(track\)\s*\{\s*if \(!isNativeMusicTrackPlayable\(track\)\)/.test(js)],
 ['next-track progression exists',js.includes('playAdjacentNativeReleaseTrack(1)')],
 ['previous-track navigation exists',js.includes("set('previoustrack'")],
 ['Media Session metadata exists',js.includes('new MediaMetadata(')],
 ['native audio error handling exists',js.includes('Native audio failed to load.')],
 ['Distribution still owns audio upload UI',dist.includes('data-track-audio')],
 ['Streaming contains no upload input',!js.includes('data-track-audio')],
 ['backend trusted-audio validation remains',backend.includes('loadTrustedStreamAudio')],
 ['Storage audio rule remains',rules.includes('/distribution/{releaseId}/audio/{trackId}/')]
]
let failed=0
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`\nFINAL native streaming audit failed: ${failed} check(s).`);process.exit(1)}
console.log('\nFINAL native streaming audit passed.')
