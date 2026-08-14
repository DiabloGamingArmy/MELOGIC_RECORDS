import assert from 'node:assert/strict'
import test from 'node:test'
import { applyInheritedTrackColor, moveArrayItem, moveArrayItemById, normalizeMetronomeSettings } from '../src/studio/state/trackEditing.js'

test('track color preview updates inherited regions but preserves explicit overrides', () => {
  const track = { id: 'track-1', color: '#111111' }
  const inherited = { id: 'region-a', trackId: 'track-1', color: '#111111' }
  const custom = { id: 'region-b', trackId: 'track-1', color: '#abcdef', independentColor: '#abcdef' }
  assert.deepEqual(applyInheritedTrackColor(track, [inherited, custom], '#224466'), ['region-a'])
  assert.equal(track.color, '#224466')
  assert.equal(inherited.color, '#224466')
  assert.equal(inherited.regionColorMode, 'inherit-track')
  assert.equal(custom.color, '#abcdef')
})

test('canonical track and effect arrays reorder without changing item identity', () => {
  const items = [{ id: 'drums' }, { id: 'bass' }, { id: 'keys' }, { id: 'vocals' }]
  assert.deepEqual(moveArrayItemById(items, 'vocals', 1).map((item) => item.id), ['drums', 'vocals', 'bass', 'keys'])
  assert.deepEqual(moveArrayItem(items, 0, 2).map((item) => item.id), ['bass', 'keys', 'drums', 'vocals'])
  assert.deepEqual(items.map((item) => item.id), ['drums', 'bass', 'keys', 'vocals'])
})

test('metronome settings are project-safe and expose audio FX without MIDI state', () => {
  const settings = normalizeMetronomeSettings({ volume: 140, pan: -140, accentPitch: 8000, audioEffects: [{ id: 'eq', params: { gain: 2 } }] })
  assert.equal(settings.id, 'system-metronome')
  assert.equal(settings.volume, 100)
  assert.equal(settings.pan, -100)
  assert.equal(settings.accentPitch, 4000)
  assert.equal(settings.audioEffects[0].id, 'eq')
  assert.equal('midiEffects' in settings, false)
})
