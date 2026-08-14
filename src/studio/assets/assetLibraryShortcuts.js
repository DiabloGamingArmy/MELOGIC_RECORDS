export function getAssetLibraryShortcutAction({
  code = '',
  focusedInsideLibrary = false,
  textEntry = false,
  nativeSpaceTarget = false,
  modified = false,
  selectedPreviewable = false,
  hasPreviewableRows = false
} = {}) {
  if (!focusedInsideLibrary || textEntry || modified) return ''
  if (code === 'Space') return !nativeSpaceTarget && selectedPreviewable ? 'toggle-audition' : ''
  if (code === 'ArrowUp' && hasPreviewableRows) return 'move-up'
  if (code === 'ArrowDown' && hasPreviewableRows) return 'move-down'
  return ''
}
