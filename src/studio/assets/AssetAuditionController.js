const stoppedState = () => ({
  activeAssetId: '',
  selectedAssetId: '',
  playbackState: 'stopped',
  currentTime: 0,
  autoplayNavigation: false
})

export class AssetAuditionController {
  constructor({ createSource, onStateChange = () => {}, isPreviewable = (asset) => asset?.kind === 'audio' && asset?.capabilities?.preview !== false } = {}) {
    if (typeof createSource !== 'function') throw new TypeError('Asset audition requires a source factory.')
    this.createSource = createSource
    this.onStateChange = onStateChange
    this.isPreviewable = isPreviewable
    this.state = stoppedState()
    this.currentSource = null
    this.operationId = 0
  }

  emit() { this.onStateChange({ ...this.state }) }
  snapshot() { return { ...this.state } }

  selectAsset(asset) {
    this.state.selectedAssetId = asset?.id ? String(asset.id) : ''
    this.emit()
    return Boolean(this.state.selectedAssetId)
  }

  async play(asset, { autoplayNavigation = true } = {}) {
    if (!this.isPreviewable(asset)) return false
    const operationId = ++this.operationId
    this.stop({ disableNavigation: false, emit: false, invalidate: false })
    this.state = { ...this.state, selectedAssetId: String(asset.id), activeAssetId: String(asset.id), playbackState: 'loading', autoplayNavigation }
    this.emit()
    try {
      const source = await this.createSource(asset)
      if (operationId !== this.operationId) { source?.stop?.(); return false }
      this.currentSource = source
      source?.onEnded?.(() => {
        if (operationId !== this.operationId) return
        this.currentSource = null
        this.state = { ...this.state, activeAssetId: '', playbackState: 'stopped', currentTime: 0 }
        this.emit()
      })
      await source?.play?.()
      if (operationId !== this.operationId) { source?.stop?.(); return false }
      this.state = { ...this.state, playbackState: 'playing' }
      this.emit()
      return true
    } catch (error) {
      if (operationId === this.operationId) {
        this.currentSource = null
        this.state = { ...this.state, activeAssetId: '', playbackState: 'stopped', autoplayNavigation: false }
        this.emit()
      }
      throw error
    }
  }

  stop({ disableNavigation = true, emit = true, invalidate = true } = {}) {
    if (invalidate) this.operationId += 1
    try { this.currentSource?.stop?.() } catch {}
    this.currentSource = null
    this.state = { ...this.state, activeAssetId: '', playbackState: 'stopped', currentTime: 0, autoplayNavigation: disableNavigation ? false : this.state.autoplayNavigation }
    if (emit) this.emit()
    return true
  }

  async toggle(asset, options = {}) {
    if (!this.isPreviewable(asset)) return false
    if (this.state.activeAssetId === String(asset.id) && ['loading', 'playing'].includes(this.state.playbackState)) {
      this.stop({ disableNavigation: true })
      return false
    }
    this.selectAsset(asset)
    return this.play(asset, options)
  }

  async playSelected(resolveAsset, options = {}) {
    const asset = resolveAsset?.(this.state.selectedAssetId)
    if (!this.isPreviewable(asset)) return false
    return this.toggle(asset, options)
  }

  async moveSelection(direction, assets = []) {
    const candidates = (Array.isArray(assets) ? assets : []).filter(this.isPreviewable)
    if (!candidates.length) return null
    const currentIndex = candidates.findIndex((asset) => String(asset.id) === this.state.selectedAssetId)
    const step = direction < 0 ? -1 : 1
    const nextIndex = currentIndex < 0 ? (step > 0 ? 0 : candidates.length - 1) : Math.max(0, Math.min(candidates.length - 1, currentIndex + step))
    const asset = candidates[nextIndex]
    this.selectAsset(asset)
    if (this.state.autoplayNavigation) await this.play(asset, { autoplayNavigation: true })
    return asset
  }

  stopAndClear() {
    this.stop({ disableNavigation: true, emit: false })
    this.state = stoppedState()
    this.emit()
  }
}

