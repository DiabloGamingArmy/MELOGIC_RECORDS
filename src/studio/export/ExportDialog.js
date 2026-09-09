import { exportCapabilities, planExport } from './exportPlan.js'
import { encodeExport, saveExport } from './ProjectExportService.js'
import './export.css'
let activeDialog = null
export function openExportDialog({ name, snapshot, render, desktop, nativeRate = 48000 }) {
  if (activeDialog) { activeDialog.focus(); return }
  const Ctor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  const rates = [nativeRate, 44100, 48000, ...(desktop ? [88200, 96000, 176400, 192000] : [])].filter(rate => { try { new Ctor(2, 1, rate); return true } catch { return false } })
  const capabilities = exportCapabilities({ desktop, supportedRates: rates, nativeRate })
  const dialog = document.createElement('dialog'); dialog.className = 'soura-export-dialog'; activeDialog = dialog
  dialog.setAttribute('aria-label', 'Export Project')
  // All project strings are assigned through DOM properties, never interpolated HTML.
  dialog.innerHTML = `<form><h2>Export Project</h2><fieldset>
    <label>Name<input name="name" required maxlength="120"></label>
    <label>Range<select name="range"><option value="entire">Entire Project</option><option value="cycle">Cycle / Loop Range</option></select></label>
    <label>Format<select name="format"></select></label>
    <label>Sample rate<select name="rate"></select></label>
    <label>Bit depth<select name="depth"><option value="16">16-bit PCM</option><option value="24">24-bit PCM</option><option value="32">32-bit float</option></select></label>
    <label>Normalize<select name="normalize"><option value="off">Off</option><option value="peak">Peak normalize to −1 dBFS</option></select></label>
    <label>Tail<select name="tail"><option value="0">None</option><option value="1">1 second</option><option value="2">2 seconds</option><option value="5">5 seconds</option></select></label>
    ${desktop ? '<label>Dither<select name="dither"><option value="off">Off</option><option value="tpdf">TPDF (integer PCM)</option></select></label>' : ''}
    </fieldset><p>Stereo · Master processing included</p><p data-summary></p>
    <p class="soura-export-status" role="status" aria-live="polite"></p>
    <footer><button type="button" data-cancel>Cancel</button><button type="submit">Export</button></footer></form>`
  const form = dialog.querySelector('form'), fields = form.elements, status = dialog.querySelector('[role=status]')
  fields.name.value = name || 'Soura Mix'
  for (const format of capabilities.formats) fields.format.add(new Option(format.label, format.id))
  for (const rate of capabilities.rates) fields.rate.add(new Option(`${rate / 1000} kHz${rate === nativeRate ? ' (Project / Native)' : ''}`, String(rate)))
  let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('soura.export.preferences') || '{}') } catch {}
  for (const [key, fallback] of Object.entries({ rate: String(nativeRate), depth: '24', normalize: 'off', tail: '2', range: 'entire', dither: 'off' })) {
    if (!fields[key]) continue
    const value = String(prefs[key] ?? fallback)
    fields[key].value = [...fields[key].options].some(option => option.value === value) ? value : fallback
  }
  if (!snapshot().cycle) fields.range.value = 'entire'
  let busy = false, controller = null
  const read = () => ({ range: fields.range.value, tail: Number(fields.tail.value), sampleRate: Number(fields.rate.value), depth: Number(fields.depth.value), normalize: fields.normalize.value === 'peak', dither: fields.dither?.value === 'tpdf' && fields.depth.value !== '32' })
  const update = () => {
    try {
      const state = snapshot(), options = read(), plan = planExport({ ...state, ...options })
      fields.range.querySelector('[value=cycle]').disabled = !state.cycle
      dialog.querySelector('[data-summary]').textContent = `Length: ${Math.floor(plan.duration / 60)}:${String(Math.ceil(plan.duration % 60)).padStart(2, '0')} · WAV · ${options.sampleRate / 1000} kHz · ${options.depth}-bit${options.depth === 32 ? ' float' : ' PCM'}`
      if (fields.dither) fields.dither.disabled = fields.depth.value === '32'
      status.textContent = ''; form.querySelector('[type=submit]').disabled = !rates.length
    } catch (error) { status.textContent = error.message; form.querySelector('[type=submit]').disabled = true }
  }
  const close = () => { if (busy) { controller?.abort(); status.textContent = 'Cancelling…'; return } dialog.close(); dialog.remove(); activeDialog = null }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.querySelector('[data-cancel]').onclick = close
  // Keep DAW keyboard shortcuts out of this modal.
  dialog.addEventListener('keydown', event => event.stopPropagation())
  dialog.addEventListener('click', event => event.stopPropagation())
  form.onchange = update
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return
    busy = true; controller = new AbortController(); form.querySelector('fieldset').disabled = true; form.querySelector('[type=submit]').disabled = true
    const progress = text => { status.textContent = text }
    try {
      const options = read(), state = snapshot(), plan = planExport({ ...state, ...options })
      try { localStorage.setItem('soura.export.preferences', JSON.stringify(Object.fromEntries(['rate', 'depth', 'normalize', 'tail', 'range', 'dither'].filter(key => fields[key]).map(key => [key, fields[key].value])))) } catch {}
      progress('Preparing…')
      const audio = await render(state, plan, options, controller.signal, progress)
      controller.signal.throwIfAborted(); progress('Encoding…')
      const encoded = await encodeExport(audio, options, controller.signal, progress)
      progress('Saving…'); await saveExport(encoded.buffer, fields.name.value, desktop, controller.signal)
      progress(`${desktop ? 'Saved.' : 'Download started.'}${encoded.clipped ? ` Warning: mix peak exceeds 0 dBFS (${(20 * Math.log10(encoded.peak)).toFixed(1)} dBFS). ${options.depth === 32 ? 'Float preserves over-range samples.' : 'Integer PCM clips these peaks.'}` : ''}`)
    } catch (error) {
      console.error('[Soura export]', error)
      progress(error.name === 'AbortError' ? 'Export cancelled. No file saved.' : error.message || 'Audio rendering failed. Try a shorter range or lower sample rate.')
    } finally { busy = false; form.querySelector('fieldset').disabled = false; if (fields.dither) fields.dither.disabled = fields.depth.value === '32'; form.querySelector('[type=submit]').disabled = false; dialog.querySelector('[data-cancel]').textContent = 'Close' }
  }
  document.body.append(dialog); update(); dialog.showModal(); fields.name.focus()
}
