import './styles/base.css'
import './styles/camera.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { isMobileSpaRuntime } from './pwa/mobileSpaRouter'
import { registerMobileRuntimeView } from './pwa/mobileAppRuntime'

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
      <div class="camera-tools"><div class="camera-flash-stack"><button class="camera-tool" type="button" data-camera-flash aria-label="Flash" aria-pressed="false">⚡</button><input class="camera-flash-strength" data-camera-flash-strength type="range" min="0" max="100" value="62" aria-label="Flash magnitude" hidden></div></div>
    </div>
    <div class="camera-front-flash" data-camera-front-flash aria-hidden="true"></div>
    <div class="camera-recording-pill" data-recording-pill hidden>REC <span data-recording-time>0:00</span></div>
    <div class="camera-mode-strip" aria-label="Capture mode"><span>Story</span><span class="is-active">Camera</span><span>Post</span></div>
    <div class="camera-capture-row">
      <button class="camera-tool camera-library" type="button" data-camera-library aria-label="Open photo library">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5Z"/><circle cx="8" cy="10" r="1.6"/><path d="m4.5 16 4.2-4.1 3.1 3 2.2-2.2 5.5 5.3"/></svg>
      </button>
      <input class="camera-library-input" data-camera-library-input type="file" accept="image/*,video/*" aria-hidden="true" tabindex="-1">
      <button class="camera-capture" type="button" data-camera-capture aria-label="Tap for photo, hold for video"><span class="camera-stop-square" aria-hidden="true"></span></button>
      <button class="camera-tool camera-flip" type="button" data-camera-flip aria-label="Flip camera">↻</button>
      <div class="camera-record-lock" data-camera-record-lock aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5.5" y="10" width="13" height="10" rx="2.5"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/></svg></div>
    </div>
    <div class="camera-status" data-camera-status>Starting camera…</div>
    <div class="camera-playback" data-camera-playback hidden>
      <img data-camera-photo alt="Captured photo preview" hidden>
      <video data-camera-recorded playsinline loop hidden></video>
      <canvas class="camera-edit-canvas" data-camera-edit-canvas></canvas>
      <div class="camera-edit-textbox" data-camera-edit-textbox hidden><input data-camera-edit-text-input maxlength="160" placeholder="Type something…"><button type="button" data-camera-edit-text-add>Add</button></div>
      <div class="camera-edit-tools" data-camera-edit-tools><button type="button" data-camera-edit-tool="text">T</button><button type="button" data-camera-edit-tool="pen">✎</button><button type="button" data-camera-edit-tool="sticker">☺</button><button type="button" data-camera-edit-tool="crop">⌗</button><button type="button" data-camera-edit-tool="image">▧</button><button type="button" data-camera-edit-tool="undo">↶</button><input data-camera-edit-image-input type="file" accept="image/*" hidden></div>
      <div class="camera-review-actions"><button type="button" data-camera-retake>Retake</button><button class="camera-use" type="button" data-camera-use>Use media</button></div>
    </div>
  </main>`

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
const recordLock = app.querySelector('[data-camera-record-lock]')
const flashButton=app.querySelector('[data-camera-flash]'), flashStrength=app.querySelector('[data-camera-flash-strength]'), frontFlash=app.querySelector('[data-camera-front-flash]')
const editCanvas=app.querySelector('[data-camera-edit-canvas]'), editCtx=editCanvas?.getContext('2d'), editTextbox=app.querySelector('[data-camera-edit-textbox]'), editTextInput=app.querySelector('[data-camera-edit-text-input]'), editImageInput=app.querySelector('[data-camera-edit-image-input]')
let frontFlashOn=false, editMode='', editDrawing=false, editHistory=[]
let renderGeneration = 0
let renderRaf = 0
let cameraStarting = false
let lastPreviewTapAt = 0
/* melogic-camera-double-tap-multitouch-guard-v1 */
const cameraTapPointers = new Set()
let cameraTapGestureHadMultipleTouches = false
let cameraTapPointerMoved = false
let cameraTapStartX = 0
let cameraTapStartY = 0
const CAMERA_DOUBLE_TAP_MS = 325
const CAMERA_TAP_MOVE_TOLERANCE = 18
let captureStartY = 0
let zoomCapability = null
let zoomValue = null
let zoomApplyPending = false
let pendingZoomValue = null
let recordingStream = null
let microphoneStream = null
let recordingCanvasStream = null
let permissionAudioTrack = null
let recordingIntent = false
let lockedRecording = false
let lockHot = false
let recordingCameraSwitching = false

// melogic-camera-lifecycle-contract-v5a
let cameraBootstrapped = false
let cameraBootstrapPromise = null
let cameraDocumentLifecycleBound = false
let cameraRuntimeActive = false

function setStatus(message = '') { status.textContent = message; status.hidden = !message }
function stopMicrophone({ preservePermissionTrack = false } = {}) {
  microphoneStream?.getTracks?.().forEach(track => {
    if (!preservePermissionTrack || track !== permissionAudioTrack) track.stop()
  })
  microphoneStream = null
  recordingCanvasStream?.getTracks?.().forEach(track => track.stop())
  recordingCanvasStream = null
  recordingStream = null
  if (!preservePermissionTrack && permissionAudioTrack) {
    try { permissionAudioTrack.stop() } catch {}
    permissionAudioTrack = null
  }
}
function stopTracks() {
  stopCanvasRenderer()
  stream?.getTracks?.().forEach(track => track.stop())
  stream = null
  try { video.srcObject = null } catch {}
  zoomCapability = null; zoomValue = null; pendingZoomValue = null; zoomApplyPending = false
  resetCameraPinchGesture()
}
function stopCaptureEngines() {
  stopMicrophone()
  stopTracks()
  liveCanvas.classList.remove('is-ready')
}
// melogic-mobile-unified-runtime-v3
// melogic-camera-lifecycle-contract-v5a
function detachCameraSurface(instance) {
  if (!app || !instance) return
  const fragment = document.createDocumentFragment()
  while (app.firstChild) fragment.append(app.firstChild)
  instance.fragment = fragment
}

function attachCameraSurface(instance) {
  if (!app || !instance?.fragment?.childNodes?.length) return false
  app.replaceChildren(instance.fragment)
  instance.fragment = null
  return true
}

function stopCameraForInactiveView() {
  recordingIntent = false
  activeCapturePointer = null
  window.clearInterval(recordingTimer)
  window.clearTimeout(holdTimer)
  if (recorder?.state === 'recording') {
    try { recorder.stop() } catch {}
  }
  stopCaptureEngines()
}

async function bootstrapCameraDocument() {
  if (cameraBootstrapPromise) return cameraBootstrapPromise
  cameraBootstrapPromise = (async () => {
    if (cameraBootstrapped) return
    cameraBootstrapped = true
    cameraRuntimeActive = true
    document.body.classList.add('is-camera-page')
    initShellChrome()
    bindCameraDocumentLifecycleOnce()
    if (playback?.hidden && !stream && !cameraStarting) await startCamera()
  })()
  try {
    await cameraBootstrapPromise
  } catch (error) {
    cameraBootstrapPromise = null
    cameraBootstrapped = false
    throw error
  }
}

if (isMobileSpaRuntime()) {
  registerMobileRuntimeView('camera', {
    async mount() {
      await bootstrapCameraDocument()
      return { fragment: null, resumeCamera: true }
    },
    async activate({ instance }) {
      cameraRuntimeActive = true
      document.body.classList.add('is-camera-page')
      attachCameraSurface(instance)
      if (instance?.resumeCamera && playback?.hidden && !stream && !cameraStarting) {
        instance.resumeCamera = false
        await startCamera()
      }
    },
    async deactivate({ instance }) {
      cameraRuntimeActive = false
      document.body.classList.remove('is-camera-page')
      instance.resumeCamera = Boolean(playback?.hidden)
      stopCameraForInactiveView()
      detachCameraSurface(instance)
    },
    async unmount({ instance }) {
      cameraRuntimeActive = false
      stopCameraForInactiveView()
      instance.fragment = null
    }
  })
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
/* melogic-camera-pinch-zoom-v1 */
const cameraPinchPointers = new Map()
let cameraPinchStartDistance = 0
let cameraPinchStartZoom = null
function cameraPinchDistance(){const p=[...cameraPinchPointers.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)}
function quantizeCameraZoom(value){if(!zoomCapability)return value;const stepped=Math.round(value/zoomCapability.step)*zoomCapability.step;return clamp(stepped,zoomCapability.min,zoomCapability.max)}
function queueCameraZoom(value){if(!zoomCapability||!Number.isFinite(value))return;pendingZoomValue=quantizeCameraZoom(value);flushZoomConstraint()}
function resetCameraPinchGesture(){
  cameraPinchPointers.clear();cameraPinchStartDistance=0;cameraPinchStartZoom=null
  cameraTapPointers.clear();cameraTapGestureHadMultipleTouches=false;cameraTapPointerMoved=false;lastPreviewTapAt=0
}
function installCameraPinchZoom(){
  if(!liveCanvas)return
  liveCanvas.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch')return
    cameraPinchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
    cameraTapPointers.add(event.pointerId)
    if(cameraTapPointers.size===1){
      cameraTapPointerMoved=false
      cameraTapStartX=event.clientX
      cameraTapStartY=event.clientY
    } else {
      // Once a second finger participates, this entire contact sequence
      // is a gesture, never a tap/double-tap candidate.
      cameraTapGestureHadMultipleTouches=true
      lastPreviewTapAt=0
    }
    liveCanvas.setPointerCapture?.(event.pointerId)
    if(cameraPinchPointers.size===2){
      const distance=cameraPinchDistance()
      if(distance>0&&zoomCapability&&Number.isFinite(zoomValue)){cameraPinchStartDistance=distance;cameraPinchStartZoom=zoomValue}
      event.preventDefault()
    }
  },{passive:false})
  liveCanvas.addEventListener('pointermove',event=>{
    if(event.pointerType!=='touch'||!cameraPinchPointers.has(event.pointerId))return
    cameraPinchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
    if(cameraTapPointers.size===1 && Math.hypot(event.clientX-cameraTapStartX,event.clientY-cameraTapStartY)>CAMERA_TAP_MOVE_TOLERANCE) cameraTapPointerMoved=true
    if(cameraPinchPointers.size!==2||!zoomCapability||!Number.isFinite(cameraPinchStartZoom)||cameraPinchStartDistance<=0)return
    event.preventDefault()
    const currentDistance=cameraPinchDistance()
    if(currentDistance<=0)return
    queueCameraZoom(cameraPinchStartZoom*(currentDistance/cameraPinchStartDistance))
  },{passive:false})
  const release=event=>{
    if(event.pointerType!=='touch')return
    cameraPinchPointers.delete(event.pointerId)
    cameraTapPointers.delete(event.pointerId)
    if(cameraPinchPointers.size<2){cameraPinchStartDistance=0;cameraPinchStartZoom=null}
    if(cameraTapPointers.size===0){
      queueMicrotask(()=>{cameraTapGestureHadMultipleTouches=false;cameraTapPointerMoved=false})
    }
  }
  liveCanvas.addEventListener('pointerup',release,{passive:true})
  liveCanvas.addEventListener('pointercancel',release,{passive:true})
  liveCanvas.addEventListener('lostpointercapture',release,{passive:true})
  for(const type of ['gesturestart','gesturechange','gestureend'])liveCanvas.addEventListener(type,event=>event.preventDefault(),{passive:false})
}
installCameraPinchZoom()

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
function updateFrontFlash(){const s=Number(flashStrength?.value||0)/100;frontFlash?.style.setProperty('--front-flash-strength',s.toFixed(3));frontFlash?.classList.toggle('is-on',facingMode==='user'&&frontFlashOn);if(flashStrength)flashStrength.hidden=!(facingMode==='user'?frontFlashOn:flashButton?.dataset.on==='true')}
function resetFlashUI(){frontFlashOn=false;frontFlash?.classList.remove('is-on');if(flashButton){flashButton.dataset.on='false';flashButton.setAttribute('aria-pressed','false')}if(flashStrength)flashStrength.hidden=true}
function sizeEditCanvas(){if(!editCanvas)return;const r=playback.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d));if(editCanvas.width!==w||editCanvas.height!==h){editCanvas.width=w;editCanvas.height=h}}
function pushEditHistory(){if(!editCanvas)return;editHistory.push(editCanvas.toDataURL());if(editHistory.length>20)editHistory.shift()}
function restoreEditSnapshot(url){if(!editCtx)return;editCtx.clearRect(0,0,editCanvas.width,editCanvas.height);if(!url)return;const i=new Image();i.onload=()=>editCtx.drawImage(i,0,0,editCanvas.width,editCanvas.height);i.src=url}
function resetEditor(){editMode='';editDrawing=false;editHistory=[];if(editTextbox)editTextbox.hidden=true;if(editCtx)editCtx.clearRect(0,0,editCanvas.width,editCanvas.height);app.querySelectorAll('[data-camera-edit-tool]').forEach(b=>b.classList.remove('is-active'))}
function editorPoint(e){const r=editCanvas.getBoundingClientRect();return{x:(e.clientX-r.left)*editCanvas.width/r.width,y:(e.clientY-r.top)*editCanvas.height/r.height}}
async function startCamera({ preserveFrame=false }={}) {
  if (cameraStarting) return
  if (!navigator.mediaDevices?.getUserMedia) { setStatus('Camera capture is not supported in this browser.'); return }
  cameraStarting=true
  const preserved=preserveFrame && captureTransitionFrame()
  if (!preserved) transitionFrame?.classList.add('is-black','is-visible')
  setStatus(''); stopCanvasRenderer(); stopTracks()
  try {
    // Request BOTH permissions on camera entry. Keep the returned microphone
    // track disabled while framing/photos so permission is established without
    // feeding audio into any recorder.
    const nextStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:facingMode}},
      audio:true
    })
    const nextAudioTrack = nextStream.getAudioTracks?.()[0] || null
    if (!nextAudioTrack) throw new Error('Camera opened without the required microphone track')
    nextAudioTrack.enabled = false
    permissionAudioTrack = nextAudioTrack
    stream=nextStream
    // Preview video receives video only; the disabled audio track is retained
    // separately for later recording.
    video.srcObject = new MediaStream(nextStream.getVideoTracks())
    configureZoomCapability()
    resetFlashUI()
    await video.play(); await waitForFirstDrawableFrame()
    startCanvasRenderer(); liveCanvas.classList.add('is-ready')
    requestAnimationFrame(()=>transitionFrame?.classList.remove('is-visible','is-black'))
  } catch(error) {
    console.error('[camera] getUserMedia failed',error)
    transitionFrame?.classList.remove('is-visible','is-black')
    setStatus(error?.name==='NotAllowedError' ? 'Camera and microphone access are required. Enable them in your browser settings and reopen Camera.' : 'Unable to start the camera on this device.')
  } finally { cameraStarting=false }
}
async function flipCameraWhileRecording() {
  if (recordingCameraSwitching || recorder?.state !== 'recording' || !playback.hidden) return
  recordingCameraSwitching = true
  const nextFacing = facingMode === 'user' ? 'environment' : 'user'
  const oldVideoTrack = stream?.getVideoTracks?.()[0]
  stopCanvasRenderer()
  try {
    oldVideoTrack?.stop()
    const nextVideoStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:nextFacing}},audio:false})
    const nextVideoTrack = nextVideoStream.getVideoTracks?.()[0]
    if (!nextVideoTrack) throw new Error('No video track returned while switching camera')
    const retainedAudio = permissionAudioTrack && permissionAudioTrack.readyState === 'live' ? [permissionAudioTrack] : []
    stream = new MediaStream([nextVideoTrack, ...retainedAudio])
    video.srcObject = new MediaStream([nextVideoTrack])
    facingMode = nextFacing
    configureZoomCapability()
    resetFlashUI()
    await video.play()
    await waitForFirstDrawableFrame()
    startCanvasRenderer()
    liveCanvas.classList.add('is-ready')
  } catch (error) {
    console.error('[camera] in-recording camera switch failed', error)
    if (oldVideoTrack?.readyState === 'live') startCanvasRenderer()
    setStatus('Unable to switch cameras while recording.')
    window.setTimeout(() => setStatus(''), 1600)
  } finally { recordingCameraSwitching = false }
}
async function flipCamera() {
  if (cameraStarting || !playback.hidden) return
  if (recorder?.state === 'recording') { await flipCameraWhileRecording(); return }
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
  // Review mode owns neither capture engine. Release camera + microphone before
  // exposing captured/imported media.
  stopCaptureEngines()
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
  requestAnimationFrame(()=>{sizeEditCanvas();resetEditor()})
  useButton.textContent = isPhoto ? 'Use photo' : 'Use video'
  playback.hidden = false
}
async function beginRecording() {
  if (!stream || recorder?.state === 'recording' || !window.MediaRecorder) return false
  const sourceVideoTrack = stream.getVideoTracks?.()[0]
  if (!sourceVideoTrack || sourceVideoTrack.readyState !== 'live') return false

  recordingIntent = true
  chunks = []

  // Camera initialization already requested microphone permission and retained
  // its track. Activate that existing track only for actual video recording.
  let audioTrack = permissionAudioTrack
  if (!audioTrack || audioTrack.readyState !== 'live') {
    // Defensive recovery if the OS/browser ended the permission track.
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ video:false, audio:true })
      audioTrack = microphoneStream.getAudioTracks?.()[0] || null
      permissionAudioTrack = audioTrack
    } catch (error) {
      recordingIntent = false
      console.error('[camera] microphone unavailable', error)
      setStatus('Unable to start the microphone on this device.')
      return false
    }
  }

  if (!recordingIntent || activeCapturePointer === null) {
    if (audioTrack) audioTrack.enabled = false
    return false
  }
  if (!audioTrack) {
    recordingIntent = false
    setStatus('No microphone input is available.')
    return false
  }
  audioTrack.enabled = true

  // Keep MediaRecorder's track set stable for the entire take. Hardware camera
  // flips only change the source rendered into this canvas track.
  if (typeof liveCanvas.captureStream !== 'function') {
    recordingIntent=false; audioTrack.enabled=false
    setStatus('Live camera switching while recording is not supported on this browser.')
    return false
  }
  let recorderVideoTrack=null
  try {
    const fps=sourceVideoTrack.getSettings?.().frameRate || 30
    recordingCanvasStream=liveCanvas.captureStream(Math.min(60,Math.max(24,fps)))
    recorderVideoTrack=recordingCanvasStream.getVideoTracks?.()[0] || null
  } catch(error) { console.error('[camera] canvas recording stream unavailable',error) }
  if (!recorderVideoTrack) {
    recordingIntent=false; audioTrack.enabled=false
    setStatus('Unable to initialize the video recording surface.')
    return false
  }
  recordingStream = new MediaStream([recorderVideoTrack, audioTrack])

  try { recorder = new MediaRecorder(recordingStream) }
  catch {
    const mimeType = supportedMimeType()
    try { recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined) }
    catch (error) {
      recordingIntent = false
      audioTrack.enabled = false
      recordingCanvasStream?.getTracks?.().forEach(track => track.stop())
      recordingCanvasStream = null
      console.error('[camera] MediaRecorder unavailable', error)
      setStatus('Video recording is not supported on this device.')
      return false
    }
  }

  recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
    if (permissionAudioTrack) permissionAudioTrack.enabled = false
    recordingCanvasStream?.getTracks?.().forEach(track => track.stop())
    recordingCanvasStream = null
    stopCaptureEngines()
    showCapturedMedia(blob, 'video')
  }
  recorder.onerror = event => {
    recordingIntent = false
    if (permissionAudioTrack) permissionAudioTrack.enabled = false
    recordingCanvasStream?.getTracks?.().forEach(track => track.stop())
    recordingCanvasStream = null
    stopCaptureEngines()
    console.error('[camera] recording failed', event?.error || event)
    capture.classList.remove('is-recording'); pill.hidden = true; window.clearInterval(recordingTimer)
    setStatus('Recording stopped because the browser reported an error.')
  }

  recorder.start()
  recordingStartedAt = Date.now(); updateTimer(); recordingTimer = window.setInterval(updateTimer, 250)
  lockedRecording=false; lockHot=false
  capture.classList.add('is-recording','is-following'); recordLock.classList.add('is-visible'); pill.hidden=false
  return true
}
function endRecording() {
  recordingIntent = false
  if (recorder?.state !== 'recording') {
    if (permissionAudioTrack) permissionAudioTrack.enabled = false
    return
  }
  recorder.stop()
  window.clearInterval(recordingTimer)
  lockedRecording=false; lockHot=false
  capture.classList.remove('is-recording','is-following','is-locked','is-lock-hot')
  capture.style.removeProperty('--capture-x'); capture.style.removeProperty('--capture-y')
  recordLock.classList.remove('is-visible','is-hot')
  pill.hidden=true
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
  if (lockedRecording && recorder?.state === 'recording') { event.preventDefault(); endRecording(); return }
  event.preventDefault(); didHold = false; activeCapturePointer = event.pointerId; captureStartY = event.clientY
  capture.setPointerCapture?.(event.pointerId)
  holdTimer = window.setTimeout(() => {
    didHold = true
    beginRecording().then(started => {
      if (!started && activeCapturePointer !== null) didHold = false
    })
  }, HOLD_TO_RECORD_MS)
})
capture.addEventListener('pointermove', event => {
  if (activeCapturePointer === null || event.pointerId !== activeCapturePointer || !didHold) return
  event.preventDefault()
  const r=recordLock.getBoundingClientRect(), lx=r.left+r.width/2, ly=r.top+r.height/2
  const radius=Math.max(44,Math.max(r.width,r.height)*.78)
  lockHot=Math.hypot(event.clientX-lx,event.clientY-ly)<=radius
  const x=lockHot?lx:event.clientX, y=lockHot?ly:event.clientY
  capture.style.setProperty('--capture-x',`${x}px`); capture.style.setProperty('--capture-y',`${y}px`)
  capture.classList.toggle('is-lock-hot',lockHot); recordLock.classList.toggle('is-hot',lockHot)
  const deltaY=event.clientY-captureStartY
  if (!lockHot && deltaY!==0) setZoomFromDrag(deltaY)
  captureStartY=event.clientY
})
function releaseCapture(event) {
  if (activeCapturePointer !== null && event.pointerId !== activeCapturePointer) return
  event.preventDefault(); window.clearTimeout(holdTimer)
  if (didHold && recorder?.state==='recording' && lockHot) {
    lockedRecording=true; lockHot=false
    capture.classList.remove('is-following','is-lock-hot'); capture.classList.add('is-locked')
    capture.style.removeProperty('--capture-x'); capture.style.removeProperty('--capture-y')
    recordLock.classList.remove('is-visible','is-hot')
  } else if (didHold) endRecording()
  else takePhoto()
  recordingIntent=lockedRecording
  activeCapturePointer=null
}
capture.addEventListener('pointerup', releaseCapture)
capture.addEventListener('pointercancel', event => {
  if (activeCapturePointer !== null && event.pointerId !== activeCapturePointer) return
  window.clearTimeout(holdTimer); recordingIntent = false; if (didHold) endRecording()
  else if (permissionAudioTrack) permissionAudioTrack.enabled = false
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

  // Camera flip is a DOUBLE TAP, not "two pointerups close together".
  // Any multi-touch/pinch sequence is excluded, even if both fingers
  // are stationary and released within the double-tap time window.
  if (event.pointerType === 'touch' && (cameraTapGestureHadMultipleTouches || cameraTapPointerMoved || cameraTapPointers.size > 1)) {
    lastPreviewTapAt = 0
    return
  }

  const now = performance.now()
  if (now - lastPreviewTapAt <= CAMERA_DOUBLE_TAP_MS) {
    lastPreviewTapAt = 0
    event.preventDefault()
    void flipCamera()
    return
  }
  lastPreviewTapAt = now
})
flashButton.addEventListener('click',async event=>{const button=event.currentTarget;if(facingMode==='user'){frontFlashOn=!frontFlashOn;button.dataset.on=String(frontFlashOn);button.setAttribute('aria-pressed',String(frontFlashOn));updateFrontFlash();return}const track=stream?.getVideoTracks?.()[0],caps=track?.getCapabilities?.()||{};if(!track||!caps.torch){setStatus('Flash is not available with this camera.');setTimeout(()=>setStatus(''),1600);return}const current=typeof track.getSettings?.().torch==='boolean'?track.getSettings().torch:button.dataset.on==='true',next=!current;try{await track.applyConstraints({advanced:[{torch:next}]});const actual=track.getSettings?.().torch,on=typeof actual==='boolean'?actual:next;button.dataset.on=String(on);button.setAttribute('aria-pressed',String(on));flashStrength.hidden=!on}catch(error){console.warn('[camera] torch toggle failed',error);setStatus('Unable to change flash on this camera.');setTimeout(()=>setStatus(''),1600)}})
flashStrength.addEventListener('input',updateFrontFlash)

app.querySelector('[data-camera-edit-tools]').addEventListener('click',e=>{const b=e.target.closest('[data-camera-edit-tool]');if(!b)return;const t=b.dataset.cameraEditTool;if(t==='undo'){restoreEditSnapshot(editHistory.pop()||'');return}if(t==='image'){editImageInput.value='';editImageInput.click();return}if(t==='sticker'){sizeEditCanvas();pushEditHistory();editCtx.font=`${Math.max(48,editCanvas.width*.09)}px system-ui`;editCtx.textAlign='center';editCtx.fillStyle='#fff';editCtx.fillText('☺',editCanvas.width/2,editCanvas.height/2);return}editMode=editMode===t?'':t;app.querySelectorAll('[data-camera-edit-tool]').forEach(x=>x.classList.toggle('is-active',x===b&&!!editMode));editTextbox.hidden=editMode!=='text';editCanvas.classList.toggle('is-crop-mode',editMode==='crop');if(editMode==='text')editTextInput.focus()})
app.querySelector('[data-camera-edit-text-add]').addEventListener('click',()=>{const v=editTextInput.value.trim();if(!v)return;sizeEditCanvas();pushEditHistory();const f=Math.max(34,editCanvas.width*.055);editCtx.font=`700 ${f}px system-ui`;editCtx.textAlign='center';editCtx.textBaseline='middle';editCtx.lineWidth=Math.max(4,f*.12);editCtx.strokeStyle='rgba(0,0,0,.72)';editCtx.fillStyle='#fff';editCtx.strokeText(v,editCanvas.width/2,editCanvas.height/2);editCtx.fillText(v,editCanvas.width/2,editCanvas.height/2);editTextInput.value='';editTextbox.hidden=true;editMode=''})
editImageInput.addEventListener('change',()=>{const file=editImageInput.files?.[0];if(!file)return;const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{sizeEditCanvas();pushEditHistory();const m=Math.min(editCanvas.width,editCanvas.height)*.34,s=Math.min(m/i.width,m/i.height,1),w=i.width*s,h=i.height*s;editCtx.drawImage(i,(editCanvas.width-w)/2,(editCanvas.height-h)/2,w,h);URL.revokeObjectURL(u)};i.src=u})
editCanvas.addEventListener('pointerdown',e=>{if(editMode!=='pen')return;e.preventDefault();sizeEditCanvas();pushEditHistory();editDrawing=true;editCanvas.setPointerCapture?.(e.pointerId);const p=editorPoint(e);editCtx.beginPath();editCtx.moveTo(p.x,p.y)})
editCanvas.addEventListener('pointermove',e=>{if(!editDrawing||editMode!=='pen')return;e.preventDefault();const p=editorPoint(e);editCtx.lineWidth=Math.max(5,editCanvas.width*.008);editCtx.lineCap='round';editCtx.strokeStyle='#fff';editCtx.lineTo(p.x,p.y);editCtx.stroke()})
editCanvas.addEventListener('pointerup',()=>editDrawing=false);editCanvas.addEventListener('pointercancel',()=>editDrawing=false)
app.querySelector('[data-camera-retake]').addEventListener('click', async () => {
  playback.hidden = true; playback._melogicCapture = null
  recordedVideo.pause(); recordedVideo.removeAttribute('src'); try { recordedVideo.srcObject = null } catch {}; recordedVideo.load(); recordedVideo.hidden = true
  recordedPhoto.removeAttribute('src'); recordedPhoto.hidden = true
  // Retake explicitly re-enters idle Camera mode: video engine only.
  await startCamera()
})
app.querySelector('[data-camera-use]').addEventListener('click', () => {
  const blob = playback._melogicCapture
  if (!blob) return
  window.__melogicCameraCapture = { blob, type: playback.dataset.captureType || 'video', createdAt: Date.now() }
  setStatus('Captured. Post and Story publishing hooks are ready for the next camera patch.')
  playback.hidden = true
})
window.addEventListener('resize',()=>{sizeLiveCanvas();if(!playback.hidden)sizeEditCanvas()},{passive:true})
window.addEventListener('orientationchange', () => requestAnimationFrame(sizeLiveCanvas), { passive: true })

function bindCameraDocumentLifecycleOnce() {
  if (cameraDocumentLifecycleBound) return
  cameraDocumentLifecycleBound = true
  window.addEventListener('pagehide', stopCameraForInactiveView)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopCameraForInactiveView()
      return
    }
    if (!cameraRuntimeActive || !playback.hidden || stream || cameraStarting) return
    void startCamera()
  })
}

// Direct /camera documents retain current cold-start behavior. Dynamic import
// from another SPA view only registers Camera; runtime activation owns startup.
if ((location.pathname.replace(/\/+$/, '') || '/') === '/camera') {
  void bootstrapCameraDocument()
}
