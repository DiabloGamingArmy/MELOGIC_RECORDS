export const SOURA_ASSET_DRAG_TYPE = 'application/x-soura-asset+json'

export function createSouraAssetDragPayload(asset = {}) {
  if (!asset?.id || asset.kind !== 'audio' || asset.capabilities?.dragToTimeline === false) return null
  const source = asset.source || {}
  return {
    version: 1,
    assetId: String(asset.id),
    name: String(asset.name || 'Audio'),
    kind: 'audio',
    sourceType: String(asset.sourceType || 'user'),
    duration: Number(asset.audio?.duration || 0),
    source: {
      assetId: String(source.assetId || ''),
      productId: String(source.productId || ''),
      packId: String(source.sourcePackId || source.packId || ''),
      projectId: String(source.projectId || ''),
      publisherId: String(source.publisherId || ''),
      sourceFileId: String(source.sourceFileId || ''),
      archivePath: String(source.archivePath || ''),
      contentHash: String(source.contentHash || ''),
      version: String(source.version || '')
    }
  }
}

export function parseSouraAssetDragPayload(value = '') {
  try {
    const payload = JSON.parse(String(value || ''))
    return payload?.version === 1 && payload?.assetId && payload?.kind === 'audio' ? payload : null
  } catch { return null }
}

export function planAssetTimelineDrop({ rawBeat = 0, snapEnabled = true, snap = (value) => value, track = null, trackIndex = -1, trackCount = 0, isAudioTrack = () => false } = {}) {
  const startBeat = snapEnabled ? snap(rawBeat) : rawBeat
  const compatible = Boolean(track && isAudioTrack(track))
  return {
    startBeat,
    trackId: compatible ? String(track.id || '') : '',
    createAudioTrack: !compatible,
    newTrackIndex: compatible ? -1 : track ? Math.max(0, Number(trackIndex) + 1) : Math.max(0, Number(trackCount) || 0),
    targetTrackName: track?.name || ''
  }
}
