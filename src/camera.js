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
    <video class="camera-preview is-mirrored" data-camera-preview autoplay muted playsinline></video>
    <canvas class="camera-transition-frame" data-camera-transition-frame aria-hidden="true"></canvas>
    <div class="camera-shade"></div>
    <div class="camera-topbar">
      <a class="camera-tool" href="/community" aria-label="Close camera">×</a>
      <div class="camera-tools"><button class="camera-tool" type="button" data-camera-flash aria-label="Flash">⚡</button></div>
    </div>
    <div class="camera-recording-pill" data-recording-pill hidden>REC <span data-recording-time>0:00</span></div>
    <div class="camera-mode-strip" aria-label="Capture mode"><span>Story</span><span class="is-active">Camera</span><span>Post</span></div>
    <div class="camera-capture-row">
      <button class="camera-capture" type="button" data-camera-capture aria-label="Tap for photo, hold for video"></button>
      <button class="camera-tool camera-flip" type="button" data-camera-flip aria-label="Flip camera">↻</button>
    </div>
    <div class="camera-status" data-camera-status>Starting camera…</div>
    <div class="camera-playback" data-camera-playback hidden>
      <video data-camera-recorded playsinline controls></video>
      <div class="camera-review-actions"><button type="button" data-camera-retake>Retake</button><button class="camera-use" type="button" data-camera-use>Use video</button></div>
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
const transitionFrame = app.querySelector('[data-camera-transition-frame]')
let cameraStarting = false
let lastPreviewTapAt = 0

function setStatus(message = '') { status.textContent = message; status.hidden = !message }
function stopTracks() { stream?.getTracks?.().forEach(track => track.stop()); stream = null }
function supportedMimeType() {
  const candidates = ['video/mp4;codecs=h264,aac','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
  return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || ''
}
function captureTransitionFrame() {
  if (!transitionFrame || !video.videoWidth || !video.videoHeight) return false
  transitionFrame.width = video.videoWidth
  transitionFrame.height = video.videoHeight
  const ctx = transitionFrame.getContext('2d')
  if (!ctx) return false
  ctx.save()
  if (facingMode === 'user') {
    ctx.translate(transitionFrame.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, 0, 0, transitionFrame.width, transitionFrame.height)
  ctx.restore()
  transitionFrame.classList.add('is-visible')
  return true
}
function nextAnimationFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve))
}
function nextPresentedVideoFrame() {
  return new Promise(resolve => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve())
    } else {
      requestAnimationFrame(() => resolve())
    }
  })
}
async function waitForVideoFrame() {
  // iOS/WebKit can briefly composite the first camera frame at the media's
  // intrinsic size before object-fit:cover is visually settled. Do not reveal
  // the live <video> merely because loadeddata fired. Wait for non-zero
  // intrinsic dimensions, a presented frame, the video resize event/geometry
  // to settle, and then another presented frame.
  if (!(video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)) {
    await new Promise(resolve => {
      const ready = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) resolve()
        else video.addEventListener('resize', ready, { once: true })
      }
      video.addEventListener('loadeddata', ready, { once: true })
      video.addEventListener('resize', ready, { once: true })
    })
  }

  await nextPresentedVideoFrame()
  await nextAnimationFrame()

  let stableFrames = 0
  let lastWidth = video.videoWidth
  let lastHeight = video.videoHeight
  while (stableFrames < 3) {
    await nextPresentedVideoFrame()
    if (video.videoWidth === lastWidth && video.videoHeight === lastHeight) {
      stableFrames += 1
    } else {
      lastWidth = video.videoWidth
      lastHeight = video.videoHeight
      stableFrames = 0
    }
  }

  // One final paint boundary keeps WebKit's media compositor transition hidden.
  await nextAnimationFrame()
  await nextAnimationFrame()
}
async function startCamera({ preserveFrame = false } = {}) {
  if (cameraStarting) return
  if (!navigator.mediaDevices?.getUserMedia) { setStatus('Camera capture is not supported in this browser.'); return }
  cameraStarting = true
  const hasTransitionFrame = preserveFrame && captureTransitionFrame()
  if (!hasTransitionFrame) {
    transitionFrame?.classList.add('is-black')
    transitionFrame?.classList.add('is-visible')
  }
  setStatus('')
  stopTracks()
  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:true})
    stream = nextStream
    video.srcObject = nextStream
    video.classList.toggle('is-mirrored', facingMode === 'user')
    await video.play()
    await waitForVideoFrame()
    video.classList.add('is-ready')
    requestAnimationFrame(() => {
      transitionFrame?.classList.remove('is-visible', 'is-black')
    })
  } catch (error) {
    console.error('[camera] getUserMedia failed', error)
    transitionFrame?.classList.remove('is-visible', 'is-black')
    setStatus(error?.name === 'NotAllowedError' ? 'Camera and microphone access are required. Enable them in your browser settings and reopen Camera.' : 'Unable to start the camera on this device.')
  } finally {
    cameraStarting = false
  }
}
async function flipCamera() {
  if (cameraStarting || recorder?.state === 'recording' || !playback.hidden) return
  const previousFacingMode = facingMode
  const preserved = captureTransitionFrame()
  facingMode = facingMode === 'user' ? 'environment' : 'user'
  video.classList.remove('is-ready')
  try {
    await startCamera({ preserveFrame: preserved })
  } catch (error) {
    facingMode = previousFacingMode
    throw error
  }
}
function updateTimer() {
  const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000)
  timerLabel.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`
}
function beginRecording() {
  if (!stream || recorder?.state === 'recording' || !window.MediaRecorder) return
  chunks = []
  const mimeType = supportedMimeType()
  try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined) } catch { recorder = new MediaRecorder(stream) }
  recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = URL.createObjectURL(blob)
    recordedVideo.src = previewUrl
    playback.hidden = false
    playback.dataset.captureType = 'video'
    playback._melogicCapture = blob
  }
  recorder.start(250)
  recordingStartedAt = Date.now(); updateTimer(); recordingTimer = window.setInterval(updateTimer, 250)
  capture.classList.add('is-recording'); pill.hidden = false
}
function endRecording() {
  if (recorder?.state !== 'recording') return
  recorder.stop(); window.clearInterval(recordingTimer); capture.classList.remove('is-recording'); pill.hidden = true
}
function takePhoto() {
  if (!video.videoWidth) return
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (facingMode === 'user') { ctx.translate(canvas.width,0); ctx.scale(-1,1) }
  ctx.drawImage(video,0,0,canvas.width,canvas.height)
  canvas.toBlob(blob => {
    if (!blob) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = URL.createObjectURL(blob)
    recordedVideo.poster = previewUrl; recordedVideo.removeAttribute('src'); recordedVideo.load()
    playback.hidden = false; playback.dataset.captureType = 'photo'; playback._melogicCapture = blob
  },'image/jpeg',.92)
}
let holdTimer = 0
let didHold = false
capture.addEventListener('pointerdown', event => { event.preventDefault(); didHold = false; holdTimer = window.setTimeout(() => { didHold = true; beginRecording() }, 240) })
function releaseCapture(event) { event.preventDefault(); window.clearTimeout(holdTimer); if (didHold) endRecording(); else takePhoto() }
capture.addEventListener('pointerup', releaseCapture); capture.addEventListener('pointercancel', event => { window.clearTimeout(holdTimer); if (didHold) endRecording(); event.preventDefault() })
app.querySelector('[data-camera-flip]').addEventListener('click', flipCamera)
video.addEventListener('pointerup', event => {
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
app.querySelector('[data-camera-retake]').addEventListener('click', () => { playback.hidden = true; recordedVideo.pause(); recordedVideo.removeAttribute('src'); recordedVideo.removeAttribute('poster'); recordedVideo.load() })
app.querySelector('[data-camera-use]').addEventListener('click', () => {
  const blob = playback._melogicCapture
  if (!blob) return
  window.__melogicCameraCapture = { blob, type: playback.dataset.captureType || 'video', createdAt: Date.now() }
  setStatus('Captured. Post and Story publishing hooks are ready for the next camera patch.')
  playback.hidden = true
})
window.addEventListener('pagehide', stopTracks)
document.addEventListener('visibilitychange', () => { if (document.hidden) stopTracks(); else if (!playback.hidden) return; else startCamera() })
startCamera()
