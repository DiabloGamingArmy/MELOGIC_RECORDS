#!/usr/bin/env python3
from pathlib import Path
import shutil

p = Path("src/studioProject.js")
if not p.exists():
    raise SystemExit("Run this from the MELOGIC_RECORDS repository root.")

text = p.read_text(encoding="utf-8")
start_marker = "function renderPitchTraceView(region, track) {"
end_marker = "\nfunction getPitchTraceEditedNoteCount(trace = {}) {"

start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("Could not locate renderPitchTraceView() safely. No changes made.")

new_function = r'''function renderPitchTraceView(region, track) {
  const edit = normalizeAudioEdit(region.audioEdit)
  const trace = edit.pitchTrace
  const visibleDuration = Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region))
  const visibleNotes = trace.showLowConfidence ? (trace.notes || []) : (trace.notes || []).filter((note)=>note.confidence >= trace.confidenceThreshold)
  const hiddenNoteCount = Math.max(0, (trace.notes || []).length - visibleNotes.length)
  const notes = visibleNotes
  const noteValues = notes.map((note)=>Number(note.editedMidiNote ?? note.midiNote)).filter(Number.isFinite)
  const minNote = Math.max(0, Math.min(48, ...(noteValues.length ? noteValues : [48])) - 2)
  const maxNote = Math.min(127, Math.max(72, ...(noteValues.length ? noteValues : [72])) + 2)
  const rowCount = Math.max(1, maxNote - minNote + 1)
  const beatCount = Math.max(1, Math.ceil(secondsToBeats(visibleDuration)))
  const color = getReadableWaveformColor(region.color || track?.color || '#58d4ff')

  const makeCurvePath = (note) => {
    const driftStart = clamp(Number(note.pitchDriftStartCents) || Number(note.centsOffset) || 0, -100, 100)
    const driftEnd = clamp(Number(note.pitchDriftEndCents) || Number(note.centsOffset) || 0, -100, 100)
    const vibrato = clamp(Number(note.vibratoAmount) || 0, 0, 1)
    const points = 18
    const coords = []
    for (let index = 0; index < points; index += 1) {
      const t = index / Math.max(1, points - 1)
      const drift = driftStart + ((driftEnd - driftStart) * t)
      const modulation = Math.sin(t * Math.PI * 6) * vibrato * 17
      const cents = clamp(drift + modulation, -100, 100)
      const x = t * 100
      const y = 50 - ((cents / 100) * 32)
      coords.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    }
    return coords.join(' ')
  }

  const blocks = notes.map((note)=> {
    const left = clamp((Number(note.startSeconds) || 0) / visibleDuration, 0, 1) * 100
    const width = clamp((Number(note.durationSeconds) || 0.01) / visibleDuration, 0.002, 1) * 100
    const editedMidi = clamp(Math.round(Number(note.editedMidiNote ?? note.midiNote) || 60), minNote, maxNote)
    const originalMidi = clamp(Math.round(Number(note.originalMidiNote) || editedMidi), minNote, maxNote)
    const row = maxNote - editedMidi
    const top = (row / rowCount) * 100
    const height = Math.max(7, (1 / rowCount) * 100)
    const delta = editedMidi - originalMidi
    const stateClass = [
      pitchTraceSelectedNoteId === note.id ? 'is-selected' : '',
      delta ? 'is-edited' : '',
      note.muted ? 'is-muted' : '',
      note.confidence < trace.confidenceThreshold ? 'is-low-confidence' : ''
    ].filter(Boolean).join(' ')
    const deltaLabel = delta ? ` · ${delta > 0 ? '+' : ''}${delta} st` : ''
    const sourceLabel = note.source === 'manual' ? 'manual' : 'analysis'
    const curvePath = makeCurvePath(note)

    return `<button type="button" class="studio-pitch-trace-note ${stateClass}" data-pitch-trace-note="${esc(note.id)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;top:${top.toFixed(3)}%;height:${height.toFixed(3)}%;--pitch-note-color:${esc(color)}" title="${esc(formatMidiNoteName(editedMidi))}${esc(deltaLabel)} · ${Math.round((note.confidence || 0) * 100)}% · ${esc(sourceLabel)}">
      <span class="studio-pitch-trace-intended" aria-hidden="true"></span>
      <span class="studio-pitch-trace-separation studio-pitch-trace-separation--left" aria-hidden="true"></span>
      <span class="studio-pitch-trace-separation studio-pitch-trace-separation--right" aria-hidden="true"></span>
      <span class="studio-pitch-trace-note-center" aria-hidden="true"></span>
      <svg class="studio-pitch-trace-note-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${curvePath}"></path></svg>
      <span data-pitch-trace-note-handle="left"></span>
      <b>${esc(formatMidiNoteName(editedMidi))}</b>
      <span data-pitch-trace-note-handle="right"></span>
    </button>`
  }).join('')

  const labels = Array.from({ length: rowCount }, (_, index) => {
    const midi = maxNote - index
    return midi % 12 === 0 ? `<span style="top:${((index / rowCount) * 100).toFixed(3)}%">${esc(formatMidiNoteName(midi))}</span>` : ''
  }).join('')

  const beatLines = Array.from({ length: beatCount + 1 }, (_, index)=>`<i style="left:${((index / beatCount) * 100).toFixed(3)}%"></i>`).join('')

  const status = trace.status === 'analyzing'
    ? `Analyzing${trace.progress ? ` ${Math.round(trace.progress * 100)}%` : '...'}`
    : trace.status === 'ready'
      ? `Ready · ${notes.length} shown${hiddenNoteCount ? ` · ${hiddenNoteCount} hidden` : ''}`
      : trace.status === 'failed'
        ? `Failed · ${trace.error || 'Try again'}`
        : 'Idle'

  const base = getPitchTraceBaseSummary(region, edit)
  const emptyState = trace.status === 'analyzing'
    ? `<p class="studio-pitch-trace-empty">Analyzing audio... ${Math.round((trace.progress || 0) * 100)}%</p>`
    : trace.status === 'failed'
      ? `<p class="studio-pitch-trace-empty">${esc(trace.error || 'Pitch analysis failed. Use Analyze Audio to retry.')}</p>`
      : `<p class="studio-pitch-trace-empty">Click Analyze Audio to detect editable notes.</p>`

  return `<div class="studio-pitch-trace-view" data-pitch-trace-view data-pitch-min="${minNote}" data-pitch-max="${maxNote}" data-pitch-duration="${visibleDuration}" style="--pitch-row-count:${rowCount}">
    <div class="studio-pitch-trace-waveform">${renderAudioWaveform(region, { editor: true, maxPeaks: 1100 })}</div>
    <div class="studio-pitch-trace-grid" aria-hidden="true">${beatLines}</div>
    <div class="studio-pitch-trace-labels" aria-hidden="true">${labels}</div>
    <div class="studio-pitch-trace-notes" data-pitch-trace-grid>${blocks || emptyState}</div>
    <small>Pitch Trace: ${esc(status)} · ${esc(base.label)}</small>
  </div>`
}'''

backup = p.with_suffix(".js.pitch-editor-v2.bak")
if not backup.exists():
    shutil.copy2(p, backup)

updated = text[:start] + new_function + text[end:]
p.write_text(updated, encoding="utf-8")
print("Patched:", p)
print("Backup:", backup)
print("Next: npm run build")
