import './styles/base.css'
import './styles/camera.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'

const app = document.querySelector('#app')
let stream = null
let recorder = null
let chunks = []
let facingMode = 'user'
let recordingStartedAt = 0
let recordingTimer = 0
let previewUrl = ''

app.innerHTML = `
  ${navShell({ currentPage: 'camera' })}
  <main class="camera-screen" aria-label="Melogic camera">
    <video class="camera-preview-source" data-camera-preview autoplay muted playsinline></video>
    <canvas class="camera-live-canvas" data-camera-live-canvas aria-hidden="true"></canvas>
    <canvas class="camera-transition-frame" data-camera-transition-frame aria-hidden="true"></canvas>
    <div class="camera-shade"></div>
    <div class="camera-topbar">
      <a class="camera-tool" href="/community" aria-label="Close camera">×</a>
      <div class="camera-tools"><button class="camera-tool" type="button" data-camera-flash aria-label="Flash">⚡</button></div>
    </div>
    <div class="camera-recording-pill" data-recording-pill hidden>REC <span data-recording-time>0:00</span></div>
    <div class="camera-mode-strip" aria-label="Capture mode"><span>Story</span><span class="is-active">Camera</span><span>Post</span></div>
    <div class="camera-capture-row">
      <button class="camera-tool camera-library" type="button" data-camera-library aria-label="Open photo library">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5Z"/><circle cx="8" cy="10" r="1.6"/><path d="m4.5 16 4.2-4.1 3.1 3 2.2-2.2 5.5 5.3"/></svg>
      </button>
      <input class="camera-library-input" data-camera-library-input type="file" accept="image/*,video/*" aria-hidden="true" tabindex="-1">
      <button class="camera-capture" type="button" data-camera-capture aria-label="Tap for photo, hold for video"></button>
      <button class="camera-tool camera-flip" type="button" data-camera-flip aria-label="Flip camera">↻</button>
    </div>
    <div class="camera-status" data-camera-status>Starting camera…</div>
    <div class="camera-playback" data-camera-playback hidden>
      <img data-camera-photo alt="Captured photo preview" hidden>
      <video data-camera-recorded playsinline loop hidden></video>
      <div class="camera-review-actions"><button type="button" data-camera-retake>Retake</button><button class="camera-use" type="button" data-camera-use>Use media</button></div>
    </div>
  </main>`

initShellChrome()
const video = app.querySelector('[data-camera-preview]')
const status = app.querySelector('[data-camera-status]')
const capture = app.querySelector('[data-camera-capture]')
const pill = app.querySelector('[data-recording-pill]')
const timerLabel = app.querySelector('[data-recording-time]')
const playback = app.querySelector('[data-camera-playback]')
const recordedVideo = app.querySelector('[data-camera-recorded]')
const recordedPhoto = app.querySelector('[data-camera-photo]')
const libraryButton = app.querySelector('[data-camera-library]')
const libraryInput = app.querySelector('[data-camera-library-input]')
const useButton = app.querySelector('[data-camera-use]')
const transitionFrame = app.querySelector('[data-camera-transition-frame]')
const liveCanvas = app.querySelector('[data-camera-live-canvas]')
const liveCtx = liveCanvas?.getContext('2d', { alpha: false })
let renderGeneration = 0
let renderRaf = 0
let cameraStarting = false
let lastPreviewTapAt = 0
let captureStartY = 0
let zoomCapability = null
let zoomValue = null
let zoomApplyPending = false
let pendingZoomValue = null

function setStatus(message = '') { status.textContent = message; status.hidden = !message }
function stopTracks() {
  stopCanvasRenderer(); stream?.getTracks?.().forEach(track => track.stop()); stream = null
  zoomCapability = null; zoomValue = null; pendingZoomValue = null; zoomApplyPending = false
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function configureZoomCapability() {
  const track = stream?.getVideoTracks?.()[0]
  const capabilities = track?.getCapabilities?.() || {}
  const range = capabilities.zoom
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min) {
    zoomCapability = null; zoomValue = null; return
  }
  zoomCapability = { min: range.min, max: range.max, step: Number.isFinite(range.step) && range.step > 0 ? range.step : 0.01 }
  const current = track.getSettings?.().zoom
  zoomValue = Number.isFinite(current) ? clamp(current, range.min, range.max) : range.min
}
async function flushZoomConstraint() {
  if (zoomApplyPending || pendingZoomValue == null) return
  const track = stream?.getVideoTracks?.()[0]
  if (!track || !zoomCapability) return
  zoomApplyPending = true
  const requested = pendingZoomValue
  pendingZoomValue = null
  try {
    await track.applyConstraints({ advanced: [{ zoom: requested }] })
    const actual = track.getSettings?.().zoom
    zoomValue = Number.isFinite(actual) ? actual : requested
  } catch (error) {
    console.warn('[camera] zoom constraint rejected', error)
  } finally {
    zoomApplyPending = false
    if (pendingZoomValue != null) flushZoomConstraint()
  }
}
function setZoomFromDrag(deltaY) {
  if (!zoomCapability || !Number.isFinite(zoomValue)) return
  const range = zoomCapability.max - zoomCapability.min
  // Roughly 55% of the visible camera height traverses the hardware zoom range.
  const travel = Math.max(180, liveCanvas?.clientHeight * .55 || 320)
  const raw = zoomValue + ((-deltaY / travel) * range)
  const stepped = Math.round(raw / zoomCapability.step) * zoomCapability.step
  pendingZoomValue = clamp(stepped, zoomCapability.min, zoomCapability.max)
  flushZoomConstraint()
}
function supportedMimeType() {
  const candidates = ['video/mp4;codecs=h264,aac','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
  return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || ''
}
function sizeLiveCanvas() {
  if (!liveCanvas) return
  const rect = liveCanvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.max(1, Math.round(rect.width * dpr))
  const h = Math.max(1, Math.round(rect.height * dpr))
  if (liveCanvas.width !== w) liveCanvas.width = w
  if (liveCanvas.height !== h) liveCanvas.height = h
}
function drawAspectFill(ctx, source, sw, sh, tw, th, mirror = false) {
  if (!ctx || !sw || !sh || !tw || !th) return false
  const sr=sw/sh, tr=tw/th
  let sx=0, sy=0, cw=sw, ch=sh
  if (sr>tr) { cw=sh*tr; sx=(sw-cw)/2 } else { ch=sw/tr; sy=(sh-ch)/2 }
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#000'; ctx.fillRect(0,0,tw,th)
  if (mirror) { ctx.translate(tw,0); ctx.scale(-1,1) }
  ctx.drawImage(source,sx,sy,cw,ch,0,0,tw,th); ctx.restore(); return true
}
function drawLiveFrame() {
  sizeLiveCanvas()
  return drawAspectFill(liveCtx,video,video.videoWidth,video.videoHeight,liveCanvas.width,liveCanvas.height,facingMode==='user')
}
function captureTransitionFrame() {
  if (!transitionFrame || !liveCanvas?.width || !liveCanvas?.height) return false
  transitionFrame.width=liveCanvas.width; transitionFrame.height=liveCanvas.height
  const ctx=transitionFrame.getContext('2d',{alpha:false}); if (!ctx) return false
  ctx.drawImage(liveCanvas,0,0,transitionFrame.width,transitionFrame.height)
  transitionFrame.classList.add('is-visible'); return true
}
function stopCanvasRenderer() {
  renderGeneration += 1
  if (renderRaf) cancelAnimationFrame(renderRaf)
  renderRaf=0
}
function startCanvasRenderer() {
  stopCanvasRenderer()
  const generation=renderGeneration
  const paint=()=>{
    if (generation!==renderGeneration || !stream) return
    drawLiveFrame()
    if (typeof video.requestVideoFrameCallback==='function') video.requestVideoFrameCallback(paint)
    else renderRaf=requestAnimationFrame(paint)
  }
  paint()
}
function waitForFirstDrawableFrame() {
  return new Promise(resolve=>{
    const check=()=>{
      if (video.readyState>=2 && video.videoWidth>0 && video.videoHeight>0 && drawLiveFrame()) return resolve()
      if (typeof video.requestVideoFrameCallback==='function') video.requestVideoFrameCallback(check)
      else requestAnimationFrame(check)
    }
    check()
  })
}
async function startCamera({ preserveFrame=false }={}) {
  if (cameraStarting) return
  if (!navigator.mediaDevices?.getUserMedia) { setStatus('Camera capture is not supported in this browser.'); return }
  cameraStarting=true
  const preserved=preserveFrame && captureTransitionFrame()
  if (!preserved) transitionFrame?.classList.add('is-black','is-visible')
  setStatus(''); stopCanvasRenderer(); stopTracks()
  try {
    const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode}},audio:true})
    stream=nextStream; video.srcObject=nextStream
    configureZoomCapability()
    await video.play(); await waitForFirstDrawableFrame()
    startCanvasRenderer(); liveCanvas.classList.add('is-ready')
    requestAnimationFrame(()=>transitionFrame?.classList.remove('is-visible','is-black'))
  } catch(error) {
    console.error('[camera] getUserMedia failed',error)
    transitionFrame?.classList.remove('is-visible','is-black')
    setStatus(error?.name==='NotAllowedError' ? 'Camera and microphone access are required. Enable them in your browser settings and reopen Camera.' : 'Unable to start the camera on this device.')
  } finally { cameraStarting=false }
}
async function flipCamera() {
  if (cameraStarting || recorder?.state==='recording' || !playback.hidden) return
  const preserved=captureTransitionFrame()
  facingMode=facingMode==='user'?'environment':'user'
  liveCanvas.classList.remove('is-ready')
  await startCamera({preserveFrame:preserved})
}
function updateTimer() {
  const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000)
  timerLabel.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`
}
function showCapturedMedia(blob, type) {
  if (!blob) return
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = URL.createObjectURL(blob)
  const isPhoto = type === 'photo'
  recordedVideo.pause()
  recordedVideo.hidden = isPhoto
  recordedPhoto.hidden = !isPhoto
  if (isPhoto) {
    recordedVideo.pause()
    try { recordedVideo.srcObject = null } catch {}
    recordedVideo.removeAttribute('src')
    recordedVideo.load()
    recordedPhoto.src = previewUrl
  } else {
    recordedPhoto.removeAttribute('src')
    recordedVideo.pause()
    recordedVideo.controls = false
    recordedVideo.loop = true
    recordedVideo.autoplay = true
    recordedVideo.playsInline = true
    recordedVideo.preload = 'auto'
    recordedVideo.currentTime = 0

    // WebKit has historically had Blob-URL playback edge cases. Safari supports
    // assigning a Blob directly to HTMLMediaElement.srcObject; use that path
    // when available, then fall back to the normal object URL everywhere else.
    let usingBlobSrcObject = false
    try {
      recordedVideo.srcObject = blob
      usingBlobSrcObject = recordedVideo.srcObject === blob
    } catch {
      recordedVideo.srcObject = null
    }
    if (!usingBlobSrcObject) recordedVideo.src = previewUrl

    const playPreview = async () => {
      try {
        recordedVideo.muted = false
        await recordedVideo.play()
      } catch (error) {
        // iOS may reject audible programmatic playback after MediaRecorder's
        // asynchronous stop event. Never leave the review as a black screen:
        // retry muted while retaining audio in the actual recorded Blob.
        console.warn('[camera] audible review autoplay blocked; retrying muted', error)
        try {
          recordedVideo.muted = true
          await recordedVideo.play()
        } catch (mutedError) {
          console.error('[camera] recorded video preview failed', mutedError)
          setStatus('Video was recorded, but this browser could not start the preview.')
        }
      }
    }

    if (recordedVideo.readyState >= 2) playPreview()
    else {
      recordedVideo.addEventListener('loadeddata', playPreview, { once: true })
      recordedVideo.load?.()
    }
  }
  playback.dataset.captureType = type
  playback._melogicCapture = blob
  useButton.textContent = isPhoto ? 'Use photo' : 'Use video'
  playback.hidden = false
}
function beginRecording() {
  if (!stream || recorder?.state === 'recording' || !window.MediaRecorder) return false
  chunks = []
  // Let the browser choose its native recorder container/codec first.
  // This is materially safer on WebKit/iOS than forcing a codec variant that
  // isTypeSupported() may advertise but a particular Safari build may not
  // subsequently preview correctly.
  try { recorder = new MediaRecorder(stream) }
  catch {
    const mimeType = supportedMimeType()
    try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined) }
    catch (error) { console.error('[camera] MediaRecorder unavailable', error); setStatus('Video recording is not supported on this device.'); return false }
  }
  recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
  recorder.onstop = () => showCapturedMedia(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }), 'video')
  recorder.onerror = event => {
    console.error('[camera] recording failed', event?.error || event)
    capture.classList.remove('is-recording'); pill.hidden = true; window.clearInterval(recordingTimer)
    setStatus('Recording stopped because the browser reported an error.')
  }
  // A single final dataavailable Blob is the simplest/most interoperable
  // local-preview path. stop() flushes final media before firing `stop`.
  recorder.start()
  recordingStartedAt = Date.now(); updateTimer(); recordingTimer = window.setInterval(updateTimer, 250)
  capture.classList.add('is-recording'); pill.hidden = false
  return true
}
function endRecording() {
  if (recorder?.state !== 'recording') return
  recorder.stop(); window.clearInterval(recordingTimer); capture.classList.remove('is-recording'); pill.hidden = true
}
function takePhoto() {
  if (!liveCanvas?.width || !liveCanvas?.height) return
  liveCanvas.toBlob(blob => showCapturedMedia(blob, 'photo'), 'image/jpeg', .92)
}
const HOLD_TO_RECORD_MS = 450
let holdTimer = 0
let didHold = false
let activeCapturePointer = null
capture.addEventListener('pointerdown', event => {
  if (event.button != null && event.button !== 0) return
  event.preventDefault(); didHold = false; activeCapturePointer = event.pointerId; captureStartY = event.clientY
  capture.setPointerCapture?.(event.pointerId)
  holdTimer = window.setTimeout(() => { didHold = beginRecording() }, HOLD_TO_RECORD_MS)
})
capture.addEventListener('pointermove', event => {
  if (activeCapturePointer === null || event.pointerId !== activeCapturePointer || !didHold) return
  event.preventDefault()
  const deltaY = event.clientY - captureStartY
  // Treat the shutter gesture as a relative zoom control in BOTH directions:
  // finger up -> zoom in, finger back down -> zoom out.
  if (deltaY !== 0) setZoomFromDrag(deltaY)
  captureStartY = event.clientY
})
function releaseCapture(event) {
  if (activeCapturePointer !== null && event.pointerId !== activeCapturePointer) return
  event.preventDefault(); window.clearTimeout(holdTimer)
  if (didHold) endRecording(); else takePhoto()
  activeCapturePointer = null
}
capture.addEventListener('pointerup', releaseCapture)
capture.addEventListener('pointercancel', event => {
  if (activeCapturePointer !== null && event.pointerId !== activeCapturePointer) return
  window.clearTimeout(holdTimer); if (didHold) endRecording()
  capture.classList.remove('is-recording'); activeCapturePointer = null; event.preventDefault()
})
app.querySelector('[data-camera-flip]').addEventListener('click', flipCamera)
libraryButton.addEventListener('click', () => {
  // No `capture` attribute: request existing photo/video media instead of forcing a new camera capture.
  libraryInput.value = ''
  libraryInput.click()
})
libraryInput.addEventListener('change', () => {
  const file = libraryInput.files?.[0]
  if (!file) return
  const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : ''
  if (!type) { setStatus('Choose a photo or video from your library.'); return }
  showCapturedMedia(file, type)
})
liveCanvas.addEventListener('pointerup', event => {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const now = performance.now()
  if (now - lastPreviewTapAt <= 325) {
    lastPreviewTapAt = 0
    event.preventDefault()
    flipCamera()
    return
  }
  lastPreviewTapAt = now
})
app.querySelector('[data-camera-flash]').addEventListener('click', async event => {
  const track = stream?.getVideoTracks?.()[0]; const capabilities = track?.getCapabilities?.() || {}
  if (!capabilities.torch) { setStatus('Flash is not available with this camera.'); window.setTimeout(() => setStatus(''), 1600); return }
  const next = event.currentTarget.dataset.on !== 'true'; await track.applyConstraints({advanced:[{torch:next}]}); event.currentTarget.dataset.on = String(next)
})
app.querySelector('[data-camera-retake]').addEventListener('click', () => {
  playback.hidden = true; playback._melogicCapture = null
  recordedVideo.pause(); recordedVideo.removeAttribute('src'); recordedVideo.load(); recordedVideo.hidden = true
  recordedPhoto.removeAttribute('src'); recordedPhoto.hidden = true
})
app.querySelector('[data-camera-use]').addEventListener('click', () => {
  const blob = playback._melogicCapture
  if (!blob) return
  window.__melogicCameraCapture = { blob, type: playback.dataset.captureType || 'video', createdAt: Date.now() }
  setStatus('Captured. Post and Story publishing hooks are ready for the next camera patch.')
  playback.hidden = true
})
window.addEventListener('resize', sizeLiveCanvas, { passive: true })
window.addEventListener('orientationchange', () => requestAnimationFrame(sizeLiveCanvas), { passive: true })
window.addEventListener('pagehide', stopTracks)
document.addEventListener('visibilitychange', () => { if (document.hidden) stopTracks(); else if (!playback.hidden) return; else startCamera() })
startCamera()
