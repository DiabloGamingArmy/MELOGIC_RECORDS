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

function setStatus(message = '') { status.textContent = message; status.hidden = !message }
function stopTracks() { stream?.getTracks?.().forEach(track => track.stop()); stream = null }
function supportedMimeType() {
  const candidates = ['video/mp4;codecs=h264,aac','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
  return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || ''
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { setStatus('Camera capture is not supported in this browser.'); return }
  stopTracks(); setStatus('Starting camera…')
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:true})
    video.srcObject = stream
    video.classList.toggle('is-mirrored', facingMode === 'user')
    await video.play()
    setStatus('')
  } catch (error) {
    console.error('[camera] getUserMedia failed', error)
    setStatus(error?.name === 'NotAllowedError' ? 'Camera and microphone access are required. Enable them in your browser settings and reopen Camera.' : 'Unable to start the camera on this device.')
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
app.querySelector('[data-camera-flip]').addEventListener('click', async () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; await startCamera() })
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
