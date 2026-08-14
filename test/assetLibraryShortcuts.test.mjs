import assert from 'node:assert/strict'
import test from 'node:test'
import { getAssetLibraryShortcutAction } from '../src/studio/assets/assetLibraryShortcuts.js'

test('Asset Library owns Space only for a previewable selection in its interaction context', () => {
  const base = { code: 'Space', focusedInsideLibrary: true, selectedPreviewable: true }
  assert.equal(getAssetLibraryShortcutAction(base), 'toggle-audition')
  assert.equal(getAssetLibraryShortcutAction({ ...base, focusedInsideLibrary: false }), '')
  assert.equal(getAssetLibraryShortcutAction({ ...base, nativeSpaceTarget: true }), '')
})

test('Search and text-entry Space remains owned by the input', () => {
  assert.equal(getAssetLibraryShortcutAction({ code: 'Space', focusedInsideLibrary: true, selectedPreviewable: true, textEntry: true }), '')
})

test('arrow browsing is available only when the focused scope contains previewable rows', () => {
  assert.equal(getAssetLibraryShortcutAction({ code: 'ArrowDown', focusedInsideLibrary: true, hasPreviewableRows: true }), 'move-down')
  assert.equal(getAssetLibraryShortcutAction({ code: 'ArrowUp', focusedInsideLibrary: true, hasPreviewableRows: true }), 'move-up')
  assert.equal(getAssetLibraryShortcutAction({ code: 'ArrowDown', focusedInsideLibrary: true }), '')
})
