#!/usr/bin/env python3
from pathlib import Path
import shutil
p=Path("src/studioProject.js")
if not p.exists(): raise SystemExit("Run from MELOGIC_RECORDS repo root.")
s=p.read_text(); orig=s
def rep(old,new,name):
 global s
 if new in s: print("already:",name); return
 if old not in s: raise SystemExit("Missing anchor: "+name)
 s=s.replace(old,new,1); print("patched:",name)

rep("import { renderReversedAudio } from './studio/audio/audioReverseRenderService.js'",
"""import { renderReversedAudio } from './studio/audio/audioReverseRenderService.js'
import { getNativeFilePath, getSouraImportPersistenceMode, isSouraDesktopRuntime, registerDesktopLocalAudioReference, releaseDesktopLocalAudioReference } from './studio/audio/native/SouraLocalAudioReference.js'""","local media import")

rep("""function cleanupRegionAfterDelete(regionId) {
  stopRegionPlayback(regionId)
  if (midiRollState?.regionId === regionId) {""",
"""function cleanupRegionAfterDelete(regionId) {
  stopRegionPlayback(regionId)
  const deletedRegion = midiRegions.find((item)=>item.id === regionId)
  const runtimeId = deletedRegion?.audioClip?.runtimeId || regionId
  if (runtimeId) {
    const runtime = audioClipRuntime.get(runtimeId)
    if (runtime?.url?.startsWith?.('blob:')) try { URL.revokeObjectURL(runtime.url) } catch {}
    audioClipRuntime.delete(runtimeId)
    releaseDesktopLocalAudioReference(runtimeId)
  }
  for (const [key, runtime] of audioClipRuntime.entries()) {
    if (runtime?.sourceRuntimeId === runtimeId || String(key).startsWith(`${regionId}:`)) {
      if (runtime?.url?.startsWith?.('blob:')) try { URL.revokeObjectURL(runtime.url) } catch {}
      audioClipRuntime.delete(key)
    }
  }
  audioImportPreviewCache.clear()
  if (midiRollState?.regionId === regionId) {""","delete/reimport cleanup")

rep("""    let storagePath = null
    try {
      if (source === 'import') beginAudioImportUpload(file)
      storagePath = await uploadSouraAudioBlob(file, {
        clipId,
        suffix: source === 'import' ? 'import' : '',
        onProgress: source === 'import' ? updateAudioImportUploadProgress : null
      })
    } catch (error) {
      console.warn('[studioProject] audio import upload failed', { message: error?.message })
      finishAudioImportUpload()
      recordingStatus = 'Audio upload failed. Try again.'
      renderEditor()
      return null
    }
    finishAudioImportUpload()
    const selectedAudioTrack = tracks.find((item)=>item.id === trackId)""",
"""    const desktopLocalFirst = source === 'import' && isSouraDesktopRuntime()
    const importPersistenceMode = getSouraImportPersistenceMode()
    const localReference = desktopLocalFirst ? registerDesktopLocalAudioReference(clipId, file) : null
    let storagePath = null
    let backgroundUploadPromise = null
    if (desktopLocalFirst) {
      backgroundUploadPromise = uploadSouraAudioBlob(file, { clipId, suffix: 'import' }).then((path) => {
        const live = midiRegions.find((item)=>item.id === clipId)
        if (live && path) {
          live.audioClip = { ...(live.audioClip||{}), storagePath:path, cloudBackupStatus:'ready', uploadError:null, updatedAt:Date.now() }
          scheduleEditorSave()
        }
        return path
      }).catch((error) => {
        console.warn('[studioProject] desktop background audio upload failed', { clipId, message:error?.message })
        const live=midiRegions.find((item)=>item.id===clipId)
        if(live){live.audioClip={...(live.audioClip||{}),cloudBackupStatus:'failed',uploadError:error?.message||'Background upload failed.',updatedAt:Date.now()};scheduleEditorSave()}
        return null
      })
    } else {
      try {
        if (source === 'import') beginAudioImportUpload(file)
        storagePath = await uploadSouraAudioBlob(file, { clipId, suffix: source === 'import' ? 'import' : '', onProgress: source === 'import' ? updateAudioImportUploadProgress : null })
      } catch (error) {
        console.warn('[studioProject] audio import upload failed', { message:error?.message })
        finishAudioImportUpload(); recordingStatus='Audio upload failed. Try again.'; renderEditor(); return null
      }
      finishAudioImportUpload()
    }
    const selectedAudioTrack = tracks.find((item)=>item.id === trackId)""","desktop local-first import")

rep("""        storagePath,
        sessionOnly: false,
        missingAfterReload: false,""",
"""        storagePath,
        persistenceMode: importPersistenceMode,
        localReferenceActive: Boolean(localReference),
        localReferenceHasNativePath: Boolean(localReference?.nativePath || getNativeFilePath(file)),
        cloudBackupStatus: desktopLocalFirst ? 'uploading' : 'ready',
        sessionOnly: false,
        missingAfterReload: false,""","persistence metadata")

rep("""    audioClipRuntime.set(region.id, {
      blob: file,
      url: URL.createObjectURL(file),
      audioBuffer: metadata.audioBuffer,""",
"""    audioClipRuntime.set(region.id, {
      blob: file,
      file,
      url: localReference?.objectUrl || URL.createObjectURL(file),
      localNativePath: localReference?.nativePath || getNativeFilePath(file) || '',
      localReferenceActive: desktopLocalFirst,
      audioBuffer: metadata.audioBuffer,""","local runtime")

rep("""    recordingStatus = ''
    pushHistory('import-audio-region', before, captureDawSnapshot())""",
"""    recordingStatus = desktopLocalFirst ? 'Audio ready from local file. Cloud backup is uploading in the background.' : ''
    void backgroundUploadPromise
    pushHistory('import-audio-region', before, captureDawSnapshot())""","nonblocking desktop status")

rep("""  const visibleDuration = Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region))
  const visibleNotes = trace.showLowConfidence""",
"""  const visibleDuration = Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region))
  const hasRuntimeAudio = Boolean(audioClipRuntime.get(region.audioClip?.runtimeId || region.id)?.audioBuffer)
  const visibleNotes = trace.showLowConfidence""","pitch trace base")

rep("""    <div class="studio-pitch-trace-waveform">${renderAudioWaveform(region)}</div>
    <div class="studio-pitch-trace-grid" aria-hidden="true">${beatLines}</div>
    <div class="studio-pitch-trace-labels" aria-hidden="true">${labels}</div>
    <div class="studio-pitch-trace-notes" data-pitch-trace-grid>${blocks || '<p>No detected notes yet. Click Analyze Audio to create a Pitch Trace.</p>'}</div>""",
"""    <div class="studio-pitch-trace-waveform">${renderAudioWaveform(region, { editor:true, maxPeaks:1100 })}</div>
    <div class="studio-pitch-trace-grid" aria-hidden="true">${beatLines}</div>
    <div class="studio-pitch-trace-labels" aria-hidden="true">${labels}</div>
    <div class="studio-pitch-trace-notes" data-pitch-trace-grid>${blocks || `<p class="studio-pitch-trace-empty">${trace.status === 'analyzing' ? `Analyzing audio... ${Math.round((trace.progress||0)*100)}%` : trace.status === 'failed' ? esc(trace.error || 'Pitch analysis failed. Use Analyze Audio to retry.') : hasRuntimeAudio ? 'Waveform ready. Click Analyze Audio to detect editable pitch notes.' : 'Audio is loading. Pitch notes will appear after analysis.'}</p>`}</div>""","pitch trace visible base")

if s!=orig:
 b=p.with_suffix(".js.media-phase2.bak")
 if not b.exists(): shutil.copy2(p,b)
 p.write_text(s); print("wrote",p)
