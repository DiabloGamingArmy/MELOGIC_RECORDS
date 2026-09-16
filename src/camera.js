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
const liveCanvas = app.querySelector('[data-camera-live-canvas]')
const liveCtx = liveCanvas?.getContext('2d', { alpha: false })
let renderGeneration = 0
let renderRaf = 0
let cameraStarting = false
let lastPreviewTapAt = 0

function setStatus(message = '') { status.textContent = message; status.hidden = !message }
function stopTracks() { stopCanvasRenderer(); stream?.getTracks?.().forEach(track => track.stop()); stream = null }
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
  if (!liveCanvas?.width || !liveCanvas?.height) return
  liveCanvas.toBlob(blob=>{
    if (!blob) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl=URL.createObjectURL(blob)
    recordedVideo.poster=previewUrl; recordedVideo.removeAttribute('src'); recordedVideo.load()
    playback.hidden=false; playback.dataset.captureType='photo'; playback._melogicCapture=blob
  },'image/jpeg',.92)
}
let holdTimer = 0
let didHold = false
capture.addEventListener('pointerdown', event => { event.preventDefault(); didHold = false; holdTimer = window.setTimeout(() => { didHold = true; beginRecording() }, 240) })
function releaseCapture(event) { event.preventDefault(); window.clearTimeout(holdTimer); if (didHold) endRecording(); else takePhoto() }
capture.addEventListener('pointerup', releaseCapture); capture.addEventListener('pointercancel', event => { window.clearTimeout(holdTimer); if (didHold) endRecording(); event.preventDefault() })
app.querySelector('[data-camera-flip]').addEventListener('click', flipCamera)
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
app.querySelector('[data-camera-retake]').addEventListener('click', () => { playback.hidden = true; recordedVideo.pause(); recordedVideo.removeAttribute('src'); recordedVideo.removeAttribute('poster'); recordedVideo.load() })
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
