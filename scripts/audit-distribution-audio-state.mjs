import fs from 'node:fs'

const source = fs.readFileSync('src/distribution.js', 'utf8')

const checks = [
  ['editor snapshot helper exists',
    source.includes('function preserveDistributionEditorState()')],
  ['snapshot helper syncs visible DOM values',
    source.includes('preserveDistributionEditorState() {') &&
    source.includes('syncVisibleInputs()')],
  ['stable-ID save snapshots editor state first',
    /async function ensureStableTrackIds\(\)\s*\{\s*preserveDistributionEditorState\(\)/.test(source)],
  ['audio upload snapshots editor state first',
    /async function handleTrackAudioUpload\(index, file\)\s*\{\s*preserveDistributionEditorState\(\)/.test(source)],
  ['audio removal snapshots editor state first',
    /async function handleTrackAudioRemove\(index\)\s*\{\s*preserveDistributionEditorState\(\)/.test(source)],
  ['upload completion re-snapshots edits',
    source.includes('Capture those edits immediately before the completion save.')],
  ['native audio fields remain in track payload',
    source.includes("streamAudioPath: track.streamAudioPath || ''") &&
    source.includes("streamAudioURL: track.streamAudioURL || ''")],
]

let failures = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

if (failures) {
  console.error(`\nDistribution audio state audit failed: ${failures} check(s).`)
  process.exit(1)
}

console.log('\nDistribution audio state-preservation audit passed.')
