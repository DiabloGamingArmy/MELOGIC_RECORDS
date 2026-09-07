// Local-only integration fixture. No project id means no cloud persistence.
export function createFixtureAudioBuffer() {
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: 44100 * 4, sampleRate: 44100 })
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = 0.08 * Math.sin(i / 44100 * Math.PI * 440) * (0.5 + 0.5 * Math.sin(i / 44100 * Math.PI * 4))
  return buffer
}

export function mountRegionGeometryFixture({ regions, rerender }) {
  const panel = document.createElement('aside')
  panel.style = 'position:fixed;bottom:30px;left:260px;z-index:99999;background:#182238;color:white;padding:8px;max-height:230px;overflow:auto'
  const output = document.createElement('pre')
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const run = async () => {
    const original = JSON.stringify(regions())
    const nodes = regions().map(r => document.querySelector(`[data-midi-region="${r.id}"]`))
    const failures = []
    const samples = []
    const check = step => {
      const geometry = window.__souraTimelineGeometry.snapshot()
      if (geometry.errors.length) failures.push({ step, errors: geometry.errors })
      if (JSON.stringify(regions()) !== original) failures.push({ step, error: 'Region data mutated' })
      for (const [i, region] of regions().entries()) {
        const el = document.querySelector(`[data-midi-region="${region.id}"]`)
        const rect = el.getBoundingClientRect()
        if (el !== nodes[i]) failures.push({ step, error: 'Region DOM replaced' })
        const expectedWidth = (region.endBeat - region.startBeat) * geometry.pixelsPerBeat
        if (Math.abs(rect.width - expectedWidth) > 0.05) failures.push({ step, error: 'Width', expectedWidth, actualWidth: rect.width })
        if (step === 0 || step === 249) samples.push({ step, regionId: region.id, pixelsPerBeat: geometry.pixelsPerBeat, width: rect.width })
      }
    }
    for (let step = 0; step < 250; step++) {
      window.__souraTimelineViewportTest.zoomAt({ deltaY: step % 2 ? 100 : -100, pointerRatio: 0.25 })
      await frame()
      check(step)
    }
    await new Promise(resolve => setTimeout(resolve, 160))
    check('settled')
    const beforeRebuild = nodes.map(el => ({ left: el.style.left, width: el.style.width, top: el.style.top, height: el.style.height }))
    rerender()
    await frame()
    const afterRebuild = regions().map(r => {
      const el = document.querySelector(`[data-midi-region="${r.id}"]`)
      return { left: el.style.left, width: el.style.width, top: el.style.top, height: el.style.height }
    })
    if (JSON.stringify(beforeRebuild) !== JSON.stringify(afterRebuild)) failures.push({ error: 'Live/rebuild mismatch', beforeRebuild, afterRebuild })
    if (JSON.stringify(regions()) !== original) failures.push({ error: 'Rebuild mutated region data' })
    output.textContent = JSON.stringify({ updates: 250, failures, samples, beforeRebuild, afterRebuild }, null, 2)
  }
  const capture = () => {
    const grid = document.querySelector('[data-arrangement-grid]')
    const geometry = window.__souraTimelineGeometry.snapshot()
    output.textContent = JSON.stringify({ geometry, regions: regions().map(region => {
      const el = document.querySelector(`[data-midi-region="${region.id}"]`)
      const rect = el?.getBoundingClientRect()
      return { id: region.id, startBeat: region.startBeat, endBeat: region.endBeat, durationBeats: region.durationBeats,
        left: parseFloat(el?.style.left), width: rect?.width, screenLeft: rect?.left, scrollLeft: grid.scrollLeft,
        waveformWidth: el?.querySelector('svg')?.getBoundingClientRect().width }
    }) }, null, 2)
  }
  for (const [label, action] of [
    ['Audit zoom in', () => window.__souraTimelineViewportTest.zoomAt({ deltaY: -100, pointerRatio: 0.25 })],
    ['Audit zoom out', () => window.__souraTimelineViewportTest.zoomAt({ deltaY: 100, pointerRatio: 0.25 })],
    ['Audit rebuild', rerender], ['Audit measure', capture], ['Audit 250 zooms', run]
  ]) {
    const button = document.createElement('button')
    button.textContent = label
    button.onclick = action
    panel.append(button)
  }
  panel.append(output)
  document.body.append(panel)
}
