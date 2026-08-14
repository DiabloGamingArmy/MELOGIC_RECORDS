import assert from 'node:assert/strict'
import test from 'node:test'
import { createSouraAssetDragPayload, parseSouraAssetDragPayload, planAssetTimelineDrop } from '../src/studio/assets/assetTimelineDrop.js'

const audioTrack = { id: 'audio-1', name: 'Audio', type: 'audio' }
const midiTrack = { id: 'midi-1', name: 'Keys', type: 'software' }
const isAudioTrack = (track) => track?.type === 'audio'

test('asset drag payload preserves identity and marketplace provenance without audio bytes', () => {
  const payload = createSouraAssetDragPayload({ id: 'asset-1', name: 'Kick.wav', kind: 'audio', sourceType: 'marketplace', audio: { duration: 1.2 }, source: { productId: 'product-1', archivePath: 'Drums/Kick.wav' } })
  assert.equal(parseSouraAssetDragPayload(JSON.stringify(payload)).source.productId, 'product-1')
  assert.equal('bytes' in payload, false)
})

test('drop planner targets audio tracks and creates tracks beside MIDI or after the arrangement', () => {
  assert.deepEqual(planAssetTimelineDrop({ rawBeat: 1.13, snapEnabled: true, snap: () => 1.25, track: audioTrack, trackIndex: 2, trackCount: 4, isAudioTrack }), { startBeat: 1.25, trackId: 'audio-1', createAudioTrack: false, newTrackIndex: -1, targetTrackName: 'Audio' })
  assert.equal(planAssetTimelineDrop({ rawBeat: 1.13, snapEnabled: false, track: midiTrack, isAudioTrack }).startBeat, 1.13)
  assert.equal(planAssetTimelineDrop({ rawBeat: 1, track: midiTrack, trackIndex: 2, trackCount: 4, isAudioTrack }).newTrackIndex, 3)
  assert.equal(planAssetTimelineDrop({ rawBeat: 1, track: null, trackCount: 4, isAudioTrack }).newTrackIndex, 4)
})
