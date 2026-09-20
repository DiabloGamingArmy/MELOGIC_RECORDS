import './styles/base.css'
import { listNewMusicReleases, searchMusic, listTracksForRelease, isNativeMusicTrackPlayable } from './data/musicService'
import './styles/camera.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { isMobileSpaRuntime } from './pwa/mobileSpaRouter'
import { navigateMobileRuntimeUrl, registerMobileRuntimeView } from './pwa/mobileAppRuntime'
import { auth, waitForInitialAuthState } from './firebase/auth'
import { listInboxThreads, sendMessage, createGroupThread, getThreadParticipantUids } from './data/inboxService'
import { listCameraStickerAssets } from './data/cameraStickerService'

const app = document.querySelector('#app')
// melogic-camera-safe-prewarm-v5c1
// Camera owns a persistent live DOM surface independent of the shared SPA outlet.
// Module evaluation may happen during idle warmup without touching the visible page.
const cameraSurface = document.createElement('div')
cameraSurface.dataset.melogicCameraSurface = 'true'
let stream = null
let recorder = null
let chunks = []
let facingMode = 'user'
let recordingStartedAt = 0
let recordingTimer = 0
let previewUrl = ''
let cameraMessageThreads=[],cameraMessageSelectedThreadIds=new Set(),cameraMessageLoading=false,cameraMessageSending=false,cameraMessageDeliveryMode=''

cameraSurface.innerHTML = `
  ${navShell({ currentPage: 'camera' })}
  <main class="camera-screen" aria-label="Melogic camera">
    <video class="camera-preview-source" data-camera-preview autoplay muted playsinline></video>
    <canvas class="camera-live-canvas" data-camera-live-canvas aria-hidden="true"></canvas>
    <canvas class="camera-transition-frame" data-camera-transition-frame aria-hidden="true"></canvas>
    <div class="camera-shade"></div>
    <!-- melogic-camera-focus-exposure-edf27c4-v1 -->
    <div class="camera-focus-indicator" data-camera-focus-indicator aria-hidden="true"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M31 8H23C14.7 8 8 14.7 8 23v8"/><path d="M69 8h8c8.3 0 15 6.7 15 15v8"/><path d="M8 69v8c0 8.3 6.7 15 15 15h8"/><path d="M92 69v8c0 8.3-6.7 15-15 15h-8"/></svg></div>
    <div class="camera-exposure-pill" data-camera-exposure-pill hidden><input class="camera-exposure-slider" data-camera-exposure type="range" min="-1" max="1" step=".01" value="0" aria-label="Camera exposure"></div>
    <div class="camera-topbar">
      <a class="camera-tool camera-close" data-camera-close href="/community" aria-label="Close camera"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></a>
      <div class="camera-tools"><div class="camera-flash-stack"><button class="camera-tool camera-flash" type="button" data-camera-flash aria-label="Flash" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2.5 6.8 13h5.1l-1.4 8.5L17.2 11h-5.1l1.4-8.5Z"/></svg></button><input class="camera-flash-strength" data-camera-flash-strength type="range" min="0" max="100" value="62" aria-label="Flash magnitude" hidden></div></div>
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
      <button class="camera-tool camera-flip" type="button" data-camera-flip aria-label="Flip camera"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M18.5 15.5A7 7 0 1 1 19.7 9"/></svg></button>
      <div class="camera-record-lock" data-camera-record-lock aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5.5" y="10" width="13" height="10" rx="2.5"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/></svg></div>
    </div>
    <div class="camera-status" data-camera-status>Starting camera…</div>
    <div class="camera-playback" data-camera-playback hidden>
      <img data-camera-photo alt="Captured photo preview" hidden>
      <video data-camera-recorded playsinline loop hidden></video>
      <canvas class="camera-edit-canvas" data-camera-edit-canvas></canvas>
      <div class="camera-editor-layer-stage" data-camera-editor-layer-stage aria-label="Editing layers"></div>
      <div class="camera-text-dim" data-camera-text-dim hidden></div>
      <div class="camera-edit-textbox" data-camera-edit-textbox hidden>
        <textarea data-camera-edit-text-input maxlength="160" rows="1" placeholder="Type something…" aria-label="Story text"></textarea>
        <button type="button" class="camera-text-done" data-camera-edit-text-add>Done</button>
        <div class="camera-text-controls">
          <select data-camera-text-font aria-label="Text font"><option value="system">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option><option value="rounded">Rounded</option></select>
          <button type="button" data-camera-text-style="weight" aria-label="Bold text"><strong>B</strong></button>
          <button type="button" data-camera-text-style="align" aria-label="Change alignment"><svg viewBox="0 0 24 24"><path d="M5 7h14M8 12h11M5 17h14"/></svg></button>
          <button type="button" data-camera-text-style="background" aria-label="Toggle text background"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 9h8M8 13h6"/></svg></button>
          <input type="color" value="#ffffff" data-camera-text-color aria-label="Text color">
          <input type="range" min="16" max="72" value="36" data-camera-text-size aria-label="Text size">
        </div>
      </div>
      <div class="camera-video-controls" data-camera-video-controls hidden>
        <div class="camera-video-head"><strong>Video</strong><button type="button" data-camera-video-close aria-label="Close video tools">×</button></div>
        <div class="camera-video-timeline"><div class="camera-video-track"><div class="camera-video-selection" data-camera-video-selection></div></div><div class="camera-video-times"><span data-camera-video-start-label>0:00.0</span><span data-camera-video-duration-label>0:00.0</span><span data-camera-video-end-label>0:00.0</span></div></div>
        <label>Trim start <input type="range" min="0" max="1000" value="0" data-camera-video-trim-start></label>
        <label>Trim end <input type="range" min="0" max="1000" value="1000" data-camera-video-trim-end></label>
        <div class="camera-video-speeds"><button type="button" data-camera-video-speed=".5">0.5×</button><button type="button" data-camera-video-speed="1" class="is-active">1×</button><button type="button" data-camera-video-speed="1.5">1.5×</button><button type="button" data-camera-video-speed="2">2×</button></div>
        <button type="button" data-camera-video-reset>Reset video edits</button>
      </div>
      <div class="camera-adjust-controls" data-camera-adjust-controls hidden>
        <div class="camera-adjust-parameters" data-camera-adjust-parameters></div>
        <div class="camera-adjust-single"><span data-camera-adjust-current-label>Exposure</span><input type="range" min="-100" max="100" value="0" data-camera-adjust-current><output data-camera-adjust-current-value>0</output></div>
      </div>
      <div class="camera-audio-controls" data-camera-audio-controls hidden>
        <div class="camera-sheet-grabber" data-camera-audio-dismiss></div>
        <div class="camera-audio-head"><strong>Add music</strong><button type="button" data-camera-audio-close aria-label="Close music">×</button></div>
        <div class="camera-music-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><input type="search" data-camera-music-search placeholder="Search Melogic music" autocomplete="off"><button type="button" data-camera-music-import aria-label="Import audio">+</button><input type="file" accept="audio/*" data-camera-music-file hidden></div>
        <div class="camera-music-results" data-camera-music-results></div>
        <div class="camera-music-empty" data-camera-music-empty hidden>No music found.</div>
        <section class="camera-music-selected" data-camera-music-selected hidden>
          <div><strong data-camera-music-selected-title></strong><small data-camera-music-selected-artist></small></div><button type="button" data-camera-music-remove>Remove</button>
          <label>Music <input type="range" min="0" max="100" value="80" data-camera-music-volume></label>
          <label class="camera-original-audio">Original <input type="range" min="0" max="100" value="100" data-camera-original-volume></label>
          <label class="camera-audio-mute"><input type="checkbox" data-camera-original-mute> Mute original</label>
          <div class="camera-music-segment"><label>Start <input type="number" min="0" step="0.1" value="0" data-camera-music-start></label><label>End <input type="number" min="0.1" step="0.1" value="15" data-camera-music-end></label></div>
          <div class="camera-music-fades"><label>Fade in <input type="number" min="0" max="5" step="0.1" value="0" data-camera-music-fade-in></label><label>Fade out <input type="number" min="0" max="5" step="0.1" value="0" data-camera-music-fade-out></label></div>
        </section>
      </div>
      <div class="camera-crop-controls" data-camera-crop-controls hidden>
        <div class="camera-crop-rail">
          <div class="camera-crop-aspects"><button type="button" data-camera-crop-aspect="free" class="is-active">Free</button><button type="button" data-camera-crop-aspect="original">Orig</button><button type="button" data-camera-crop-aspect="9:16">9:16</button><button type="button" data-camera-crop-aspect="4:5">4:5</button><button type="button" data-camera-crop-aspect="1:1">1:1</button><button type="button" data-camera-crop-aspect="16:9">16:9</button></div>
          <div class="camera-crop-actions"><button type="button" data-camera-crop-action="rotate" aria-label="Rotate"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5"/><path d="M18.2 17A8 8 0 1 1 20 12"/></svg></button><button type="button" data-camera-crop-action="flip-x" aria-label="Flip horizontally"><svg viewBox="0 0 24 24"><path d="M12 3v18M9 7 4 12l5 5M15 7l5 5-5 5"/></svg></button><button type="button" data-camera-crop-action="flip-y" aria-label="Flip vertically"><svg viewBox="0 0 24 24"><path d="M3 12h18M7 9l5-5 5 5M7 15l5 5 5-5"/></svg></button><button type="button" data-camera-crop-action="reset" aria-label="Reset crop"><svg viewBox="0 0 24 24"><path d="M5 8V4h4M5 4a9 9 0 1 1-1 11"/></svg></button><button type="button" data-camera-crop-action="done" aria-label="Done"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button></div>
        </div>
        <div class="camera-crop-zoom-pill"><span>Zoom</span><input type="range" min="100" max="400" value="100" data-camera-crop-zoom aria-label="Crop zoom"></div>
      </div>
      <div class="camera-draw-controls" data-camera-draw-controls hidden>
        <div class="camera-draw-brushes" role="group" aria-label="Brush type">
          <button type="button" data-camera-draw-brush-option="pen" class="is-active" aria-label="Pen"><svg viewBox="0 0 24 24"><path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/></svg></button>
          <button type="button" data-camera-draw-brush-option="marker" aria-label="Marker"><svg viewBox="0 0 24 24"><path d="m5 17 9-9 3 3-9 9H5v-3Z"/><path d="m13 9 3 3"/></svg></button>
          <button type="button" data-camera-draw-brush-option="highlighter" aria-label="Highlighter"><svg viewBox="0 0 24 24"><path d="m6 16 8-8 4 4-8 8H6v-4Z"/><path d="M4 21h12"/></svg></button>
          <button type="button" data-camera-draw-brush-option="neon" aria-label="Neon"><svg viewBox="0 0 24 24"><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M16.3 7.7l2.1-2.1"/><path d="M9 18h6M10 21h4"/><path d="M8.5 14.5a5 5 0 1 1 7 0L14 16h-4l-1.5-1.5Z"/></svg></button>
          <button type="button" data-camera-draw-brush-option="eraser" aria-label="Eraser"><svg viewBox="0 0 24 24"><path d="m7 17-3-3 9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-8 8H7Z"/><path d="m12 18 5-5"/></svg></button>
          <input type="hidden" value="pen" data-camera-draw-brush>
          <label class="camera-draw-color-button" aria-label="Brush color"><input type="color" value="#ffffff" data-camera-draw-color><span></span></label>
        </div>
        <div class="camera-draw-parameters" data-camera-draw-parameters>
          <label><span>Size</span><input type="range" min="2" max="32" value="8" data-camera-draw-size aria-label="Brush size"></label>
          <label><span>Opacity</span><input type="range" min="10" max="100" value="100" data-camera-draw-opacity aria-label="Brush opacity"></label>
        </div>
      </div>
      <div class="camera-sticker-picker" data-camera-sticker-picker hidden>
        <div class="camera-sheet-grabber" data-camera-sticker-dismiss aria-label="Close stickers"></div>
        <div class="camera-sticker-head"><strong>Stickers</strong><button type="button" data-camera-sticker-close aria-label="Close stickers">×</button></div>
        <div class="camera-sticker-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><input type="search" data-camera-sticker-search placeholder="Search stickers & GIFs" autocomplete="off"></div>
        <div class="camera-sticker-tabs"><button type="button" data-sticker-tab="featured" class="is-active">Featured</button><button type="button" data-sticker-tab="stickers">Stickers</button><button type="button" data-sticker-tab="gifs">GIFs</button><button type="button" data-sticker-tab="utility">Tools</button><button type="button" data-sticker-tab="melogic">Melogic</button></div>
        <div class="camera-sticker-grid" data-camera-sticker-grid></div>
        <div class="camera-sticker-empty" data-camera-sticker-empty hidden>No stickers found.</div>
        <form class="camera-interactive-editor" data-camera-interactive-editor hidden>
          <strong data-camera-interactive-title>Interactive object</strong>
          <input type="text" data-camera-interactive-label placeholder="Label">
          <input type="text" data-camera-interactive-value placeholder="Value / URL / ID">
          <input type="text" data-camera-interactive-extra placeholder="Optional second value">
          <label class="camera-reactive-toggle"><input type="checkbox" data-camera-interactive-reactive> React to audio</label>
          <button type="submit">Add</button>
        </form>
      </div>
      <div class="camera-edit-tools" data-camera-edit-tools data-active-tool="">
        <div class="camera-edit-tool-context" data-camera-edit-tool-context aria-hidden="true"></div>
        <button type="button" data-camera-edit-tool="text" aria-label="Add text"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M12 5v14M8.5 19h7"/></svg></button>
        <button type="button" data-camera-edit-tool="pen" aria-label="Draw"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/><path d="m14.8 6.4 2.8 2.8"/></svg></button>
        <button type="button" data-camera-edit-tool="sticker" aria-label="Add sticker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9V8l-5-5h-4Z"/><path d="M16 3v5h5"/><path d="M8.5 12.5h.01M14.5 12.5h.01M8.8 16c1.8 1.5 4.6 1.5 6.4 0"/></svg></button>
        <button type="button" data-camera-edit-tool="crop" aria-label="Crop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12"/></svg></button>
        <button type="button" data-camera-edit-tool="video" aria-label="Video tools"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2z"/></svg></button>
        <button type="button" data-camera-edit-tool="adjust" aria-label="Adjustments and filters"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button>
        <button type="button" data-camera-edit-tool="music" aria-label="Music and audio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></button>
        <button type="button" data-camera-edit-tool="image" aria-label="Add image"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m5 17 4.5-4.5 3.2 3.2 2.3-2.3 4 3.6"/></svg></button>
        <div class="camera-pen-rail-controls" data-camera-pen-rail-controls aria-hidden="true">
          <label class="camera-pen-rail-color" aria-label="Pen color"><input type="color" value="#ffffff" data-camera-pen-rail-color><span></span></label>
          <label class="camera-pen-rail-slider"><span>Size</span><input type="range" min="2" max="32" value="8" data-camera-pen-rail-size aria-label="Pen size"></label>
          <label class="camera-pen-rail-slider"><span>Opacity</span><input type="range" min="10" max="100" value="100" data-camera-pen-rail-opacity aria-label="Pen opacity"></label>
        </div>
        <div class="camera-text-rail-controls" data-camera-text-rail-controls aria-hidden="true">
          <label class="camera-text-rail-field camera-text-rail-font"><span>Font</span><select data-camera-text-rail-font aria-label="Text font"><option value="system">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option><option value="rounded">Rounded</option></select></label>
          <div class="camera-text-rail-field camera-text-rail-style"><span>Style</span><div>
            <button type="button" data-camera-text-rail-style="bold" aria-label="Bold text"><strong>B</strong></button>
            <button type="button" data-camera-text-rail-style="italic" aria-label="Italic text"><em>I</em></button>
            <button type="button" data-camera-text-rail-style="underline" aria-label="Underline text"><u>U</u></button>
          </div></div>
          <label class="camera-text-rail-field camera-text-rail-color"><span>Colors</span><input type="color" value="#ffffff" data-camera-text-rail-color aria-label="Text color"><i></i></label>
          <label class="camera-text-rail-field camera-text-rail-color"><span>Border Color</span><input type="color" value="#000000" data-camera-text-rail-border-color aria-label="Text border color"><i></i></label>
          <label class="camera-text-rail-field camera-text-rail-slider"><span>Size</span><input type="range" min="12" max="96" value="36" data-camera-text-rail-size aria-label="Text size"></label>
          <label class="camera-text-rail-field camera-text-rail-slider"><span>Opacity</span><input type="range" min="10" max="100" value="100" data-camera-text-rail-opacity aria-label="Text opacity"></label>
        </div>
        <input data-camera-edit-image-input type="file" accept="image/*" hidden>
      </div>
      <div class="camera-editor-functions" data-camera-editor-functions aria-label="Editor actions">
        <button type="button" data-camera-edit-tool="undo" aria-label="Undo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7-5 5 5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg></button>
        <button type="button" data-camera-edit-tool="redo" aria-label="Redo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></svg></button>
        <div class="camera-editor-selection-actions" data-camera-editor-selection-actions hidden>
          <button type="button" data-camera-layer-action="back" aria-label="Move layer backward"><svg viewBox="0 0 24 24"><path d="M7 9h10M12 4l-5 5 5 5"/></svg></button>
          <button type="button" data-camera-layer-action="forward" aria-label="Move layer forward"><svg viewBox="0 0 24 24"><path d="M7 15h10M12 20l5-5-5-5"/></svg></button>
          <button type="button" data-camera-layer-action="duplicate" aria-label="Duplicate layer"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
          <button type="button" data-camera-layer-action="delete" aria-label="Delete layer"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14"/></svg></button>
        </div>
      </div>
      <!-- melogic-camera-review-bottom-actions-p1-v1: bottom bar owns review actions -->
    </div>
    <!-- melogic-camera-share-shell-p1-v1 -->
    <section class="camera-share-screen" data-camera-share-screen aria-label="Share media" hidden>
      <header class="camera-share-header">
        <button class="camera-share-back" type="button" data-camera-share-back aria-label="Back to editor"><svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg></button>
        <div class="camera-share-heading"><h1>Share</h1><span>Choose where this goes</span></div><button class="camera-share-commit" type="button" data-camera-share-commit disabled>Share</button>
      </header>
      <div class="camera-share-content">
        <div class="camera-share-preview"><img data-camera-share-photo alt="Photo ready to share" hidden><video data-camera-share-video playsinline muted loop hidden></video><div class="camera-share-preview-meta"><span data-camera-share-type>Media</span><button type="button" data-camera-share-edit>Edit</button></div></div>
        <section class="camera-share-section"><h2>Share on Melogic</h2><div class="camera-share-destinations">
          <button class="camera-share-destination" type="button" data-share-destination="story"><span class="camera-share-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg></span><span class="camera-share-copy"><strong>Post to Story</strong><small>Share with your followers for 24 hours</small></span><span class="camera-share-choice" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg></span></button>
          <button class="camera-share-destination" type="button" data-share-destination="feed"><span class="camera-share-icon"><svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><span class="camera-share-copy"><strong>Post to Feed</strong><small>Publish to the Community feed</small></span><span class="camera-share-choice" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg></span></button>
          <button class="camera-share-destination" type="button" data-share-destination="message"><span class="camera-share-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z"/></svg></span><span class="camera-share-copy"><strong>Send in Message</strong><small>Share with a person or conversation</small></span><span class="camera-share-choice" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg></span></button>
        </div></section>
        <!-- melogic-camera-share-message-p3-v1 -->
        <section class="camera-share-message-panel" data-camera-share-message-panel hidden>
          <div class="camera-share-message-head"><div><strong>Send in Message</strong><small>Recent conversations from Inbox</small></div><button type="button" data-camera-message-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
          <label class="camera-share-message-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><input type="search" data-camera-message-search placeholder="Search conversations" autocomplete="off"></label>
          <div class="camera-share-message-state" data-camera-message-state>Loading conversations...</div><div class="camera-share-message-list" data-camera-message-list></div>
          <div class="camera-share-message-sendbar" data-camera-message-sendbar hidden><span data-camera-message-selection></span><div class="camera-share-message-send-actions" data-camera-message-send-actions></div></div>
        </section>
        <section class="camera-share-section"><h2>More</h2><div class="camera-share-destinations">
          <button class="camera-share-destination" type="button" data-share-destination="device"><span class="camera-share-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 19h14"/></svg></span><span class="camera-share-copy"><strong>Save to Device</strong><small>Keep the original media on this device</small></span><span class="camera-share-choice" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg></span></button>
          <button class="camera-share-destination" type="button" data-share-destination="system"><span class="camera-share-icon"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg></span><span class="camera-share-copy"><strong>Share to Another App</strong><small>Use your device share options</small></span><span class="camera-share-choice" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg></span></button>
        </div></section>
      </div>
    </section>
  </main>`

const video = cameraSurface.querySelector('[data-camera-preview]')
const status = cameraSurface.querySelector('[data-camera-status]')
const capture = cameraSurface.querySelector('[data-camera-capture]')
const pill = cameraSurface.querySelector('[data-recording-pill]')
const timerLabel = cameraSurface.querySelector('[data-recording-time]')
const playback = cameraSurface.querySelector('[data-camera-playback]')
const recordedVideo = cameraSurface.querySelector('[data-camera-recorded]')
const recordedPhoto = cameraSurface.querySelector('[data-camera-photo]')
const libraryButton = cameraSurface.querySelector('[data-camera-library]')
const libraryInput = cameraSurface.querySelector('[data-camera-library-input]')
const useButton = null
let reviewBottomBar = null
let reviewCancelButton = null
let reviewShareButton = null
const shareScreen = cameraSurface.querySelector('[data-camera-share-screen]')
const shareBackButton = cameraSurface.querySelector('[data-camera-share-back]')
const shareEditButton = cameraSurface.querySelector('[data-camera-share-edit]')
const sharePhoto = cameraSurface.querySelector('[data-camera-share-photo]')
const shareVideo = cameraSurface.querySelector('[data-camera-share-video]')
const shareType = cameraSurface.querySelector('[data-camera-share-type]')
const shareCommitButton = cameraSurface.querySelector('[data-camera-share-commit]')
const shareDestinations = [...cameraSurface.querySelectorAll('[data-share-destination]')]
const cameraShareSelections = new Set()
const messagePanel=cameraSurface.querySelector('[data-camera-share-message-panel]')
const messageClose=cameraSurface.querySelector('[data-camera-message-close]')
const messageSearch=cameraSurface.querySelector('[data-camera-message-search]')
const messageState=cameraSurface.querySelector('[data-camera-message-state]')
const messageList=cameraSurface.querySelector('[data-camera-message-list]')
const messageSendbar=cameraSurface.querySelector('[data-camera-message-sendbar]')
const messageSelection=cameraSurface.querySelector('[data-camera-message-selection]')
const messageSend=cameraSurface.querySelector('[data-camera-message-send]')
const transitionFrame = cameraSurface.querySelector('[data-camera-transition-frame]')
const liveCanvas = cameraSurface.querySelector('[data-camera-live-canvas]')
const liveCtx = liveCanvas?.getContext('2d', { alpha: false })
const focusIndicator = cameraSurface.querySelector('[data-camera-focus-indicator]')
const exposurePill = cameraSurface.querySelector('[data-camera-exposure-pill]')
const exposureSlider = cameraSurface.querySelector('[data-camera-exposure]')
const recordLock = cameraSurface.querySelector('[data-camera-record-lock]')
const closeButton=cameraSurface.querySelector('[data-camera-close]'), flashButton=cameraSurface.querySelector('[data-camera-flash]'), flashStrength=cameraSurface.querySelector('[data-camera-flash-strength]'), frontFlash=cameraSurface.querySelector('[data-camera-front-flash]')
const editCanvas=cameraSurface.querySelector('[data-camera-edit-canvas]'), editCtx=editCanvas?.getContext('2d'), editTextbox=cameraSurface.querySelector('[data-camera-edit-textbox]'), editTextInput=cameraSurface.querySelector('[data-camera-edit-text-input]'), editImageInput=cameraSurface.querySelector('[data-camera-edit-image-input]')
let frontFlashOn=false, editMode='', editDrawing=false, editHistory=[]
let editorState=createCameraEditorState()
const editorPointers=new Map()
let editorGesture=null
let editorGestureHistoryCommitted=false
let editorUndoStack=[]
let editorRedoStack=[]
let editorHistorySuspended=false
const CAMERA_EDITOR_HISTORY_LIMIT=60
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
let exposureCapability = null
let exposureValue = 0
let focusIndicatorTimer = 0
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
  exposureCapability = null; exposureValue = 0; clearTimeout(focusIndicatorTimer); focusIndicator?.classList.remove('is-visible'); if(exposurePill) exposurePill.hidden = true
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
  if (cameraSurface.parentNode === app) cameraSurface.remove()
  instance.detached = true
}

function attachCameraSurface(instance) {
  if (!app || !instance) return false
  if (cameraSurface.parentNode === app) {
    instance.detached = false
    return true
  }
  app.replaceChildren(cameraSurface)
  instance.detached = false
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
    // Camera route chrome/geometry must follow runtime ownership, not the HTML
    // document that happened to cold-boot the persistent SPA.
    document.body.classList.add('is-camera-page', 'melogic-camera-page')
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
      const instance = { detached: true, resumeCamera: true }
      attachCameraSurface(instance)
      await bootstrapCameraDocument()
      return instance
    },
    async activate({ instance }) {
      cameraRuntimeActive = true
      // A warm SPA transition into Camera never loads camera.html, so explicitly
      // acquire Camera's route-scoped body contract here.
      document.body.classList.add('is-camera-page', 'melogic-camera-page')
      attachCameraSurface(instance)
      if (instance?.resumeCamera && playback?.hidden && !stream && !cameraStarting) {
        instance.resumeCamera = false
        await startCamera()
      }
    },
    async deactivate({ instance }) {
      cameraRuntimeActive = false
      // A cold Camera document keeps its <body> alive while the primary-tab SPA
      // navigates elsewhere. Release BOTH Camera classes so Camera-only CSS
      // cannot leak into Community/Streaming/Inbox/Profile.
      document.body.classList.remove('is-camera-page', 'melogic-camera-page')
      instance.resumeCamera = Boolean(playback?.hidden)
      stopCameraForInactiveView()
      detachCameraSurface(instance)
    },
    async unmount({ instance }) {
      cameraRuntimeActive = false
      document.body.classList.remove('is-camera-page', 'melogic-camera-page')
      stopCameraForInactiveView()
      detachCameraSurface(instance)
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
// melogic-camera-focus-exposure-edf27c4-v1
function cameraImagingCapabilities(){const t=stream?.getVideoTracks?.()[0];try{return t?.getCapabilities?.()||{}}catch{return{}}}
async function configureCameraImagingDefaults(){
 const t=stream?.getVideoTracks?.()[0];if(!t)return;const caps=cameraImagingCapabilities(),advanced=[]
 if(Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous'))advanced.push({focusMode:'continuous'})
 if(Array.isArray(caps.exposureMode)&&caps.exposureMode.includes('continuous'))advanced.push({exposureMode:'continuous'})
 const r=caps.exposureCompensation
 if(r&&Number.isFinite(r.min)&&Number.isFinite(r.max)&&r.max>r.min){exposureCapability={min:r.min,max:r.max,step:Number.isFinite(r.step)&&r.step>0?r.step:.01};const cur=t.getSettings?.().exposureCompensation;exposureValue=Number.isFinite(cur)?clamp(cur,r.min,r.max):clamp(0,r.min,r.max);exposureSlider.min=String(r.min);exposureSlider.max=String(r.max);exposureSlider.step=String(exposureCapability.step);exposureSlider.value=String(exposureValue);exposureSlider.disabled=false}else{exposureCapability=null;exposureSlider.disabled=true}
 if(advanced.length)try{await t.applyConstraints({advanced})}catch(e){console.warn('[camera] autofocus defaults rejected',e)}
}
function showCameraFocusIndicator(x,y){const r=liveCanvas.getBoundingClientRect();focusIndicator.style.left=clamp(x-r.left,0,r.width)+'px';focusIndicator.style.top=clamp(y-r.top,0,r.height)+'px';focusIndicator.classList.remove('is-visible');void focusIndicator.offsetWidth;focusIndicator.classList.add('is-visible');exposurePill.hidden=false;clearTimeout(focusIndicatorTimer);focusIndicatorTimer=setTimeout(()=>focusIndicator.classList.remove('is-visible'),1800)}
async function focusCameraAt(x,y){
 if(!stream||!playback.hidden)return;showCameraFocusIndicator(x,y);const t=stream.getVideoTracks?.()[0],caps=cameraImagingCapabilities();if(!t)return
 const r=liveCanvas.getBoundingClientRect()
 const nx=clamp((x-r.left)/Math.max(1,r.width),0,1),ny=clamp((y-r.top)/Math.max(1,r.height),0,1)
 const sw=video.videoWidth||1,sh=video.videoHeight||1,tr=r.width/Math.max(1,r.height),sr=sw/sh
 let sx=0,sy=0,cw=sw,ch=sh
 if(sr>tr){cw=sh*tr;sx=(sw-cw)/2}else{ch=sw/tr;sy=(sh-ch)/2}
 let px=(sx+nx*cw)/sw,py=(sy+ny*ch)/sh;if(facingMode==='user')px=1-px
 const advanced=[],supported=navigator.mediaDevices?.getSupportedConstraints?.()||{}
 if(supported.pointsOfInterest)advanced.push({pointsOfInterest:[{x:px,y:py}]})
 if(Array.isArray(caps.focusMode)){if(caps.focusMode.includes('single-shot'))advanced.push({focusMode:'single-shot'});else if(caps.focusMode.includes('continuous'))advanced.push({focusMode:'continuous'})}
 if(advanced.length)try{await t.applyConstraints({advanced})}catch(e){console.warn('[camera] tap focus rejected',e)}
}
async function setCameraExposure(raw){
 if(!exposureCapability)return;const t=stream?.getVideoTracks?.()[0];if(!t)return;const s=exposureCapability.step,v=clamp(Math.round(Number(raw)/s)*s,exposureCapability.min,exposureCapability.max)
 try{await t.applyConstraints({advanced:[{exposureCompensation:v}]});const actual=t.getSettings?.().exposureCompensation;exposureValue=Number.isFinite(actual)?actual:v;exposureSlider.value=String(exposureValue)}catch(e){console.warn('[camera] exposure compensation rejected',e)}
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
function createCameraEditorState(){
  return {
    schemaVersion:1,
    media:{type:'',sourceWidth:0,sourceHeight:0,durationMs:0},
    transform:{x:0,y:0,scale:1,rotation:0,flipX:false,flipY:false,crop:null},
    audio:{originalVolume:1,muted:false,music:null,musicVolume:.8,musicStartMs:0,musicEndMs:15000,fadeInMs:0,fadeOutMs:0},
    adjustments:{exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,vibrance:0,sharpness:0,fade:0,grain:0,vignette:0,preset:'none'},
    video:{trimStartMs:0,trimEndMs:0,playbackRate:1,loopPreview:true},
    layers:[],
    selectedLayerId:'',
    revision:0
  }
}
function cameraEditorId(prefix='layer'){
  try{return `${prefix}-${crypto.randomUUID()}`}catch{return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}
}
function resetCameraEditorState(type=''){
  editorState=createCameraEditorState()
  editorState.media.type=type||playback?.dataset?.captureType||''
  syncCameraEditorMediaGeometry()
}
function syncCameraEditorMediaGeometry(){
  if(!editorState?.media)return
  const isPhoto=(playback?.dataset?.captureType||editorState.media.type)==='photo'
  const width=isPhoto?recordedPhoto?.naturalWidth:recordedVideo?.videoWidth
  const height=isPhoto?recordedPhoto?.naturalHeight:recordedVideo?.videoHeight
  if(width>0&&height>0){editorState.media.sourceWidth=width;editorState.media.sourceHeight=height}
  if(!isPhoto&&Number.isFinite(recordedVideo?.duration)){editorState.media.durationMs=Math.max(0,Math.round(recordedVideo.duration*1000));if(!editorState.video.trimEndMs)editorState.video.trimEndMs=editorState.media.durationMs}
}
function addCameraEditorLayer(type,props={}){
  pushCameraEditorHistory()
  const layer={
    id:cameraEditorId(type),type,
    x:.5,y:.5,width:.32,height:.12,rotation:0,scale:1,opacity:1,zIndex:editorState.layers.length,
    ...props
  }
  editorState.layers.push(layer);editorState.selectedLayerId=layer.id;editorState.revision+=1
  renderCameraEditorLayers()
  return layer
}
function selectCameraEditorLayer(id=''){editorState.selectedLayerId=editorState.layers.some(layer=>layer.id===id)?id:'';renderCameraEditorLayers()}
function updateCameraEditorLayer(id,patch={}){const layer=editorState.layers.find(item=>item.id===id);if(!layer)return null;pushCameraEditorHistory();Object.assign(layer,patch);editorState.revision+=1;renderCameraEditorLayers();return layer}
function removeCameraEditorLayer(id){const index=editorState.layers.findIndex(layer=>layer.id===id);if(index<0)return false;pushCameraEditorHistory();editorState.layers.splice(index,1);editorState.layers.forEach((layer,zIndex)=>layer.zIndex=zIndex);if(editorState.selectedLayerId===id)editorState.selectedLayerId='';editorState.revision+=1;renderCameraEditorLayers();return true}
function clampEditorValue(value,min,max){return Math.min(max,Math.max(min,value))}
const CAMERA_ADJUSTMENTS=[['exposure',-100,100],['contrast',-100,100],['highlights',-100,100],['shadows',-100,100],['temperature',-100,100],['tint',-100,100],['saturation',-100,100],['vibrance',-100,100],['sharpness',0,100],['fade',0,100],['grain',0,100],['vignette',0,100]]
const CAMERA_FILTER_PRESETS={
  none:{},clean:{exposure:8,contrast:8,highlights:-8,shadows:10,saturation:4,sharpness:12},warm:{temperature:22,tint:5,saturation:8,contrast:4},cool:{temperature:-22,tint:-4,contrast:6,saturation:-2},mono:{saturation:-100,contrast:14,fade:5,grain:8},cinema:{contrast:18,highlights:-20,shadows:-8,saturation:-12,temperature:7,fade:7,vignette:18}
}
function applyCameraAdjustments(){
  const a=editorState.adjustments||{},brightness=1+(Number(a.exposure)||0)/140,contrast=1+(Number(a.contrast)||0)/100,saturation=1+(Number(a.saturation)||0)/100
  const sepia=Math.max(0,Number(a.temperature)||0)/220,blue=Math.max(0,-(Number(a.temperature)||0))/100
  const filters=[`brightness(${brightness})`,`contrast(${contrast})`,`saturate(${Math.max(0,saturation)})`]
  if(sepia)filters.push(`sepia(${sepia})`);if(blue)filters.push(`hue-rotate(${Math.round(blue*12)}deg)`)
  ;[recordedPhoto,recordedVideo].forEach(el=>{if(el)el.style.filter=filters.join(' ')})
  playback.style.setProperty('--camera-vignette',String(clampEditorValue((Number(a.vignette)||0)/100,0,1)))
  playback.style.setProperty('--camera-grain',String(clampEditorValue((Number(a.grain)||0)/100,0,1)))
  playback.style.setProperty('--camera-fade',String(clampEditorValue((Number(a.fade)||0)/100,0,1)))
}
function setCameraAdjustments(patch,{history=true}={}){
  if(history)pushCameraEditorHistory();editorState.adjustments={...editorState.adjustments,...patch};editorState.revision+=1;applyCameraAdjustments();syncCameraAdjustmentControls()
}
let activeCameraAdjustment='exposure',cameraAdjustmentHistoryArmed=false
function cameraAdjustmentSpec(name){return CAMERA_ADJUSTMENTS.find(([key])=>key===name)||CAMERA_ADJUSTMENTS[0]}
function syncCameraAdjustmentControls(){
  const a=editorState.adjustments||{},[name,min,max]=cameraAdjustmentSpec(activeCameraAdjustment),slider=cameraSurface.querySelector('[data-camera-adjust-current]'),label=cameraSurface.querySelector('[data-camera-adjust-current-label]'),value=cameraSurface.querySelector('[data-camera-adjust-current-value]')
  if(slider){slider.min=String(min);slider.max=String(max);slider.value=String(a[name]||0)}
  if(label)label.textContent=name[0].toUpperCase()+name.slice(1);if(value)value.textContent=String(a[name]||0)
  cameraSurface.querySelectorAll('[data-camera-adjust-param]').forEach(button=>button.classList.toggle('is-active',button.dataset.cameraAdjustParam===name))
}
function renderCameraAdjustmentControls(){
  const host=cameraSurface.querySelector('[data-camera-adjust-parameters]');if(!host||host.childElementCount)return
  host.replaceChildren(...CAMERA_ADJUSTMENTS.map(([name])=>{const button=document.createElement('button');button.type='button';button.dataset.cameraAdjustParam=name;button.textContent=name[0].toUpperCase()+name.slice(1);return button}))
  host.addEventListener('click',event=>{const button=event.target.closest('[data-camera-adjust-param]');if(!button)return;activeCameraAdjustment=button.dataset.cameraAdjustParam;syncCameraAdjustmentControls()})
  const slider=cameraSurface.querySelector('[data-camera-adjust-current]')
  slider?.addEventListener('pointerdown',()=>{cameraAdjustmentHistoryArmed=false})
  slider?.addEventListener('input',()=>{if(!cameraAdjustmentHistoryArmed){pushCameraEditorHistory();cameraAdjustmentHistoryArmed=true}editorState.adjustments={...editorState.adjustments,[activeCameraAdjustment]:Number(slider.value),preset:'none'};editorState.revision+=1;applyCameraAdjustments();syncCameraAdjustmentControls()})
  slider?.addEventListener('change',()=>{cameraAdjustmentHistoryArmed=false})
}
function applyCameraMediaTransform(){
  const t=editorState.transform||{},crop=t.crop||{},media=[recordedPhoto,recordedVideo]
  const transform=`translate(${Number(t.x)||0}%,${Number(t.y)||0}%) scale(${clampEditorValue(Number(t.scale)||1,1,4)}) rotate(${Number(t.rotation)||0}deg) scaleX(${t.flipX?-1:1}) scaleY(${t.flipY?-1:1})`
  media.forEach(el=>{if(!el)return;el.style.transform=transform;el.style.transformOrigin='center center';el.style.objectFit='cover'})
  playback.style.setProperty('--camera-crop-ratio',crop.ratio||'auto')
  playback.dataset.cropAspect=crop.aspect||'free'
}
function setCameraMediaTransform(patch,{history=true}={}){
  if(history)pushCameraEditorHistory()
  editorState.transform={...editorState.transform,...patch};editorState.revision+=1;applyCameraMediaTransform();syncCameraEditorSelectionActions()
}
function renderCameraEditorLayers(){
  const stage=cameraSurface.querySelector('[data-camera-editor-layer-stage]')
  if(!stage)return
  const nodes=editorState.layers.sort((a,b)=>(a.zIndex||0)-(b.zIndex||0)).map(layer=>{
    const node=document.createElement('div')
    node.className='camera-editor-layer'+(layer.id===editorState.selectedLayerId?' is-selected':'')
    node.dataset.cameraEditorLayer=layer.id
    node.style.left=`${clampEditorValue(layer.x,.02,.98)*100}%`
    node.style.top=`${clampEditorValue(layer.y,.02,.98)*100}%`
    node.style.width=`${clampEditorValue(layer.width,.04,1)*100}%`
    node.style.height=`${clampEditorValue(layer.height,.04,1)*100}%`
    node.style.opacity=String(clampEditorValue(layer.opacity,0,1))
    node.style.zIndex=String(20+(layer.zIndex||0))
    node.style.transform=`translate(-50%,-50%) rotate(${Number(layer.rotation)||0}deg) scale(${clampEditorValue(Number(layer.scale)||1,.15,8)})`
    if(layer.type==='text'){
      node.textContent=layer.text||'Text'
      const fontMap={system:'system-ui,-apple-system,sans-serif',serif:'Georgia,serif',mono:'ui-monospace,SFMono-Regular,monospace',rounded:'"Arial Rounded MT Bold",system-ui,sans-serif'}
      node.style.fontFamily=fontMap[layer.fontFamily]||fontMap.system
      node.style.fontSize=`${clampEditorValue(Number(layer.fontSize)||36,12,96)}px`
      node.style.fontWeight=layer.fontWeight||700
      node.style.fontStyle=layer.fontStyle||'normal'
      node.style.textDecoration=layer.textDecoration||'none'
      node.style.textAlign=layer.textAlign||'center'
      node.style.color=layer.color||'#fff'
      const borderColor=layer.borderColor||'transparent',borderWidth=borderColor==='transparent'?0:Math.max(.5,Number(layer.borderWidth)||1)
      node.style.webkitTextStroke=borderWidth?`${borderWidth}px ${borderColor}`:'0 transparent'
      node.style.lineHeight='1.08'
      node.style.whiteSpace='pre-wrap'
      node.style.overflowWrap='anywhere'
      node.style.padding=layer.background?'8px 12px':'4px'
      node.style.borderRadius=layer.background?'10px':'0'
      node.style.background=layer.background?'rgba(0,0,0,.58)':'transparent'
      node.style.textShadow=layer.background?'none':'0 2px 8px rgba(0,0,0,.72)'
    }
    else if(layer.type==='draw'){
      node.classList.add('is-drawing')
      node.style.left='0';node.style.top='0';node.style.width='100%';node.style.height='100%';node.style.transform='none';node.style.pointerEvents='none'
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none')
      const path=document.createElementNS('http://www.w3.org/2000/svg','path'),pts=Array.isArray(layer.points)?layer.points:[]
      if(pts.length){
        let d=`M ${pts[0].x*1000} ${pts[0].y*1000}`
        for(let i=1;i<pts.length;i++){const p=pts[i],prev=pts[i-1],mx=(prev.x+p.x)*500,my=(prev.y+p.y)*500;d+=` Q ${prev.x*1000} ${prev.y*1000} ${mx} ${my}`}
        const last=pts[pts.length-1];d+=` L ${last.x*1000} ${last.y*1000}`;path.setAttribute('d',d)
      }
      path.setAttribute('fill','none');path.setAttribute('stroke',layer.color||'#fff');path.setAttribute('stroke-width',String((layer.size||8)*2.2));path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');path.setAttribute('opacity',String(layer.opacity??1))
      if(layer.brush==='marker')path.setAttribute('stroke-width',String((layer.size||8)*3.4))
      if(layer.brush==='highlighter'){path.setAttribute('stroke-width',String((layer.size||8)*4.5));path.setAttribute('opacity',String(Math.min(layer.opacity??.35,.45)))}
      if(layer.brush==='neon'){path.style.filter='drop-shadow(0 0 5px currentColor)';path.style.color=layer.color||'#fff'}
      svg.append(path);node.append(svg)
    }
    else if(layer.type==='sticker'){
      node.classList.add('is-sticker',`is-sticker-${layer.stickerKind||'emoji'}`)
      node.textContent=layer.value||'☺'
      if(layer.stickerKind==='shape'){node.style.background=layer.fill||'#fff';node.style.color=layer.color||'#111';node.style.borderRadius=layer.shape==='circle'?'50%':layer.shape==='pill'?'999px':'14px'}
      if(layer.stickerKind==='utility')node.dataset.utility=layer.utility||''
    }
    else if(layer.type==='interactive'){
      node.classList.add('is-interactive',`is-interactive-${layer.interactiveType||'object'}`);node.dataset.namespace=layer.namespace||'web';node.dataset.audioReactive=String(!!layer.audioReactive)
      const icon=document.createElement('span'),copy=document.createElement('span');icon.className='camera-interactive-icon';copy.className='camera-interactive-copy'
      const icons={mention:'@',hashtag:'#',location:'⌖',link:'↗',poll:'?',music:'♪',soura:'S',vertix:'V',product:'P',project:'▶',track:'♪',profile:'M'};icon.textContent=icons[layer.interactiveType]||'•';copy.textContent=layer.label||layer.interactiveType;node.append(icon,copy)
    }
    else if(layer.type==='image'&&layer.previewURL){const img=document.createElement('img');img.src=layer.previewURL;img.alt='';node.append(img)}
    else node.textContent=layer.label||layer.type
    return node
  })
  stage.replaceChildren(...nodes)
  syncCameraEditorSelectionActions()
}
function editorStagePoint(event){
  const stage=cameraSurface.querySelector('[data-camera-editor-layer-stage]'),r=stage?.getBoundingClientRect()
  if(!r?.width||!r?.height)return{x:.5,y:.5}
  return{x:clampEditorValue((event.clientX-r.left)/r.width,0,1),y:clampEditorValue((event.clientY-r.top)/r.height,0,1)}
}
function beginEditorGesture(){
  const layer=editorState.layers.find(item=>item.id===editorState.selectedLayerId)
  if(!layer)return
  const points=[...editorPointers.values()]
  if(points.length===1){editorGestureHistoryCommitted=false;editorGesture={kind:'drag',layerId:layer.id,start:{...points[0]},layer:{x:layer.x,y:layer.y}}}
  else if(points.length>=2){editorGestureHistoryCommitted=false;
    const [a,b]=points,dx=b.x-a.x,dy=b.y-a.y
    editorGesture={kind:'transform',layerId:layer.id,distance:Math.hypot(dx,dy)||1,angle:Math.atan2(dy,dx)*180/Math.PI,scale:layer.scale||1,rotation:layer.rotation||0}
  }
}
function updateEditorGesture(){
  const layer=editorState.layers.find(item=>item.id===editorState.selectedLayerId)
  if(!layer||!editorGesture)return
  if(!editorGestureHistoryCommitted){pushCameraEditorHistory();editorGestureHistoryCommitted=true}
  const points=[...editorPointers.values()]
  if(points.length===1&&editorGesture.kind==='drag'){
    const p=points[0],stage=cameraSurface.querySelector('[data-camera-editor-layer-stage]'),r=stage?.getBoundingClientRect()
    if(!r?.width||!r?.height)return
    layer.x=clampEditorValue(editorGesture.layer.x+(p.x-editorGesture.start.x)/r.width,.02,.98)
    layer.y=clampEditorValue(editorGesture.layer.y+(p.y-editorGesture.start.y)/r.height,.02,.98)
  }else if(points.length>=2){
    if(editorGesture.kind!=='transform')beginEditorGesture()
    if(editorGesture?.kind!=='transform')return
    const [a,b]=points,dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy)||1,angle=Math.atan2(dy,dx)*180/Math.PI
    layer.scale=clampEditorValue(editorGesture.scale*(distance/editorGesture.distance),.15,8)
    layer.rotation=editorGesture.rotation+(angle-editorGesture.angle)
  }
  editorState.revision+=1;renderCameraEditorLayers()
}
function cameraEditorStateForHistory(){return cameraEditorSnapshot()}
function syncCameraEditorSelectionActions(){
  const actions=cameraSurface.querySelector('[data-camera-editor-selection-actions]')
  if(actions)actions.hidden=!editorState.selectedLayerId
  const undo=cameraSurface.querySelector('[data-camera-edit-tool="undo"]'),redo=cameraSurface.querySelector('[data-camera-edit-tool="redo"]')
  if(undo)undo.disabled=!editorUndoStack.length
  if(redo)redo.disabled=!editorRedoStack.length
}
function pushCameraEditorHistory(){
  if(editorHistorySuspended)return
  editorUndoStack.push(cameraEditorStateForHistory())
  if(editorUndoStack.length>CAMERA_EDITOR_HISTORY_LIMIT)editorUndoStack.shift()
  editorRedoStack=[]
  syncCameraEditorSelectionActions()
}
function restoreCameraEditorState(snapshot){
  if(!snapshot)return false
  editorHistorySuspended=true
  editorState=JSON.parse(JSON.stringify(snapshot))
  editorHistorySuspended=false
  renderCameraEditorLayers();applyCameraMediaTransform();applyCameraAdjustments();applyCameraAudioPreview();recordedVideo.playbackRate=editorState.video?.playbackRate||1;syncCameraAudioControls();syncCameraVideoControls();syncCameraAdjustmentControls();syncCameraEditorSelectionActions();return true
}
function undoCameraEditor(){if(!editorUndoStack.length)return false;editorRedoStack.push(cameraEditorStateForHistory());return restoreCameraEditorState(editorUndoStack.pop())}
function redoCameraEditor(){if(!editorRedoStack.length)return false;editorUndoStack.push(cameraEditorStateForHistory());return restoreCameraEditorState(editorRedoStack.pop())}
function duplicateCameraEditorLayer(id=editorState.selectedLayerId){
  const source=editorState.layers.find(layer=>layer.id===id);if(!source)return null
  pushCameraEditorHistory()
  const clone={...JSON.parse(JSON.stringify(source)),id:cameraEditorId(source.type),x:clampEditorValue(source.x+.04,.02,.98),y:clampEditorValue(source.y+.04,.02,.98),zIndex:editorState.layers.length}
  editorState.layers.push(clone);editorState.selectedLayerId=clone.id;editorState.revision+=1;renderCameraEditorLayers();syncCameraEditorSelectionActions();return clone
}
function moveCameraEditorLayer(id,direction=1){
  const index=editorState.layers.findIndex(layer=>layer.id===id);if(index<0)return false
  const target=clampEditorValue(index+(direction>0?1:-1),0,editorState.layers.length-1);if(target===index)return false
  pushCameraEditorHistory();const [layer]=editorState.layers.splice(index,1);editorState.layers.splice(target,0,layer);editorState.layers.forEach((item,zIndex)=>item.zIndex=zIndex);editorState.revision+=1;renderCameraEditorLayers();return true
}
function cameraEditorSnapshot(){return JSON.parse(JSON.stringify(editorState))}
function cameraEditorLayerToStoryLayer(layer,index=0){
  const base={id:layer.id||`layer-${index+1}`,x:clampEditorValue(Number(layer.x)??.5,0,1),y:clampEditorValue(Number(layer.y)??.5,0,1),width:clampEditorValue(Number(layer.width)??.25,.02,1),height:clampEditorValue(Number(layer.height)??.1,.02,1),rotation:clampEditorValue(Number(layer.rotation)||0,-180,180),scale:clampEditorValue(Number(layer.scale)||1,.1,8),opacity:clampEditorValue(Number(layer.opacity)??1,0,1),zIndex:Math.max(0,Number(layer.zIndex)||index),startMs:0,endMs:0,content:'',targetId:'',targetURL:'',metadata:{}}
  if(layer.type==='text')return{...base,type:'text',content:String(layer.text||''),metadata:{fontFamily:String(layer.fontFamily||'system'),fontSize:Number(layer.fontSize)||36,fontWeight:Number(layer.fontWeight)||700,fontStyle:String(layer.fontStyle||'normal'),textDecoration:String(layer.textDecoration||'none'),textAlign:String(layer.textAlign||'center'),color:String(layer.color||'#fff'),borderColor:String(layer.borderColor||'transparent'),borderWidth:Number(layer.borderWidth)||0,background:!!layer.background}}
  if(layer.type==='draw')return{...base,type:'drawing',content:'',metadata:{brush:String(layer.brush||'pen'),color:String(layer.color||'#fff'),size:Number(layer.size)||8,points:JSON.stringify(Array.isArray(layer.points)?layer.points:[])}}
  if(layer.type==='interactive'){
    const kind=String(layer.interactiveType||''),typeMap={mention:'person',profile:'person',location:'location',link:'link',poll:'poll',music:'audio',track:'audio',product:'product',soura:'project',vertix:'project',project:'project',hashtag:'community'}
    const type=typeMap[kind]||'event',value=String(layer.value||'')
    return{...base,type,content:String(layer.label||kind),targetId:value&&!/^https?:/i.test(value)?value:'',targetURL:/^https?:/i.test(value)?value:'',metadata:{interactiveType:kind,namespace:String(layer.namespace||'web'),extra:String(layer.extra||''),audioReactive:!!layer.audioReactive,reaction:layer.reaction?JSON.stringify(layer.reaction):''}}
  }
  if(layer.type==='sticker')return{...base,type:'event',content:String(layer.value||''),metadata:{stickerKind:String(layer.stickerKind||'emoji'),shape:String(layer.shape||''),utility:String(layer.utility||'')}}
  // Imported image layers remain editor-only until they have a durable uploaded asset URL.
  return null
}
function exportCameraStoryLayers(){return editorState.layers.map(cameraEditorLayerToStoryLayer).filter(Boolean).slice(0,40)}
function exportCameraEditorState(){syncCameraEditorMediaGeometry();const snapshot=cameraEditorSnapshot();snapshot.audio.hasOriginalAudio=snapshot.media.type==='video';return snapshot}
function cameraSharePackage(){return{schemaVersion:1,editorState:exportCameraEditorState(),storyLayers:exportCameraStoryLayers()}}
window.__melogicCameraEditor={getState:exportCameraEditorState,addLayer:addCameraEditorLayer,selectLayer:selectCameraEditorLayer,updateLayer:updateCameraEditorLayer,removeLayer:removeCameraEditorLayer,undo:undoCameraEditor,redo:redoCameraEditor,duplicateLayer:duplicateCameraEditorLayer,moveLayer:moveCameraEditorLayer}

function sizeEditCanvas(){if(!editCanvas)return;const r=playback.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d));if(editCanvas.width!==w||editCanvas.height!==h){editCanvas.width=w;editCanvas.height=h}}
function pushEditHistory(){if(!editCanvas)return;editHistory.push(editCanvas.toDataURL());if(editHistory.length>20)editHistory.shift()}
function restoreEditSnapshot(url){if(!editCtx)return;editCtx.clearRect(0,0,editCanvas.width,editCanvas.height);if(!url)return;const i=new Image();i.onload=()=>editCtx.drawImage(i,0,0,editCanvas.width,editCanvas.height);i.src=url}
function resetEditor(){editMode='';editDrawing=false;editHistory=[];editorUndoStack=[];editorRedoStack=[];resetCameraEditorState(playback?.dataset?.captureType||'');applyCameraMediaTransform();applyCameraAdjustments();applyCameraAudioPreview();editorPointers.clear();editorGesture=null;editorGestureHistoryCommitted=false;renderCameraEditorLayers();closeCameraToolPanels('');setCameraToolRail('');cameraSurface.querySelector('[data-camera-text-dim]')?.setAttribute('hidden','');const interactive=cameraSurface.querySelector('[data-camera-interactive-editor]');if(interactive)interactive.hidden=true;if(editCtx)editCtx.clearRect(0,0,editCanvas.width,editCanvas.height);app.querySelectorAll('[data-camera-edit-tool]').forEach(b=>{b.classList.remove('is-active');b.setAttribute('aria-pressed','false')})}
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
      video:{
        facingMode:{ideal:facingMode},
        width:{ideal:3840},
        height:{ideal:2160},
        frameRate:{ideal:30}
      },
      audio:{
        channelCount:{ideal:2},
        sampleRate:{ideal:48000},
        sampleSize:{ideal:24},
        echoCancellation:{ideal:false},
        noiseSuppression:{ideal:false},
        autoGainControl:{ideal:false}
      }
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
    await configureCameraImagingDefaults()
    resetFlashUI()
    await video.play(); await waitForFirstDrawableFrame()
    try {
      const activeTrack=stream?.getVideoTracks?.()[0]
      console.info('[camera] active imaging', {settings:activeTrack?.getSettings?.(),capabilities:activeTrack?.getCapabilities?.()})
    } catch {}
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
    const nextVideoStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:nextFacing},width:{ideal:3840},height:{ideal:2160},frameRate:{ideal:30}},audio:false})
    const nextVideoTrack = nextVideoStream.getVideoTracks?.()[0]
    if (!nextVideoTrack) throw new Error('No video track returned while switching camera')
    const retainedAudio = permissionAudioTrack && permissionAudioTrack.readyState === 'live' ? [permissionAudioTrack] : []
    stream = new MediaStream([nextVideoTrack, ...retainedAudio])
    video.srcObject = new MediaStream([nextVideoTrack])
    facingMode = nextFacing
    configureZoomCapability()
    await configureCameraImagingDefaults()
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
// melogic-camera-review-bottom-actions-p1-v1
// melogic-camera-persistent-shell-review-fix-v1
function getCameraBottomNav(){
  // mobileSpaShell harvests .mobile-app-shell OUT of cameraSurface and moves it
  // into #melogic-mobile-spa-shell-host. After that, cameraSurface queries can
  // never see the visible persistent nav.
  return cameraSurface.querySelector('.mobile-bottom-nav')
    || document.querySelector('#melogic-mobile-spa-shell-host .mobile-bottom-nav')
    || document.querySelector('[data-melogic-persistent-mobile-shell] .mobile-bottom-nav')
}
function ensureCameraReviewBottomBar(){
  const nav=getCameraBottomNav()
  if(!nav)return null
  let bar=nav.querySelector('.camera-review-bottom-actions')
  if(!bar){
    bar=document.createElement('div')
    bar.className='camera-review-bottom-actions'
    bar.hidden=true
    bar.innerHTML='<button type="button" data-camera-review-cancel>Cancel</button><button type="button" class="is-primary" data-camera-review-share>Share</button>'
    nav.append(bar)
  }
  reviewBottomBar=bar
  reviewCancelButton=bar.querySelector('[data-camera-review-cancel]')
  reviewShareButton=bar.querySelector('[data-camera-review-share]')
  return bar
}
function setCameraReviewBottomBar(active){
  const nav=getCameraBottomNav()
  const bar=ensureCameraReviewBottomBar()
  cameraSurface.classList.toggle('is-reviewing',Boolean(active))
  if(nav){
    nav.hidden=false
    nav.classList.toggle('is-camera-reviewing',Boolean(active))
    nav.setAttribute('aria-label',active?'Camera review actions':'Mobile primary navigation')
  }
  if(bar){
    bar.hidden=!active
    bar.setAttribute('aria-hidden',String(!active))
  }
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
    recordedPhoto.addEventListener('load',syncCameraEditorMediaGeometry,{once:true})
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

    recordedVideo.addEventListener('loadedmetadata',()=>{syncCameraEditorMediaGeometry();syncCameraVideoControls()},{once:true})
    if (recordedVideo.readyState >= 2) playPreview()
    else {
      recordedVideo.addEventListener('loadeddata', playPreview, { once: true })
      recordedVideo.load?.()
    }
  }
  playback.dataset.captureType = type
  playback._melogicCapture = blob
  requestAnimationFrame(()=>{sizeEditCanvas();resetEditor()})
  playback.hidden = false
  setCameraReviewBottomBar(true)
}
// melogic-camera-share-shell-p1-v1
function syncSharePreview() {
  const blob=playback._melogicCapture, type=playback.dataset.captureType||'video'
  if(!blob||!previewUrl)return false
  const photo=type==='photo',edited=editorState.layers.length>0||editorState.revision>0; shareType.textContent=(photo?'Photo':'Video')+(edited?' · Edited':''); sharePhoto.hidden=!photo; shareVideo.hidden=photo
  if(photo){
    shareVideo.pause();shareVideo.removeAttribute('src');shareVideo.removeAttribute('poster');shareVideo.load();sharePhoto.src=previewUrl
  }else{
    sharePhoto.removeAttribute('src')
    shareVideo.loop=true;shareVideo.autoplay=true;shareVideo.muted=true;shareVideo.playsInline=true;shareVideo.preload='auto'
    shareVideo.src=previewUrl
    const paintFirstFrame=()=>{
      try{
        const canvas=document.createElement('canvas'),w=shareVideo.videoWidth,h=shareVideo.videoHeight
        if(!w||!h)return
        canvas.width=w;canvas.height=h
        canvas.getContext('2d')?.drawImage(shareVideo,0,0,w,h)
        shareVideo.poster=canvas.toDataURL('image/jpeg',.82)
      }catch{}
      shareVideo.currentTime=0
      shareVideo.play().catch(()=>{})
    }
    if(shareVideo.readyState>=2)paintFirstFrame()
    else shareVideo.addEventListener('loadeddata',paintFirstFrame,{once:true})
    shareVideo.load()
  }
  return true
}
// melogic-camera-share-multiselect-p2-v1
function renderCameraShareSelections(){
  for(const button of shareDestinations){
    const selected=cameraShareSelections.has(button.dataset.shareDestination)
    button.classList.toggle('is-selected',selected)
    button.setAttribute('aria-pressed',String(selected))
  }
  if(shareCommitButton)shareCommitButton.disabled=cameraShareSelections.size===0||cameraShareCommitting
}
function resetCameraShareSelections(){
  cameraShareSelections.clear()
  renderCameraShareSelections()
}
function toggleCameraShareDestination(button){
  const destination=button?.dataset?.shareDestination
  if(!destination)return
  if(cameraShareSelections.has(destination))cameraShareSelections.delete(destination)
  else cameraShareSelections.add(destination)
  renderCameraShareSelections()
  // Messages selection itself is Patch 3; P2 only exposes/hides its existing picker.
  if(destination==='message'){
    if(cameraShareSelections.has('message'))void openCameraMessagePicker()
    else closeCameraMessagePicker()
  }
}
function openShareScreen(){
  const blob=playback._melogicCapture;if(!blob||!syncSharePreview())return
  window.__melogicCameraCapture={blob,type:playback.dataset.captureType||'video',createdAt:Date.now(),...cameraSharePackage()}
  resetCameraShareSelections()
  recordedVideo.pause();shareScreen.hidden=false;cameraSurface.classList.add('is-sharing')
}
function closeShareScreen(){
  shareVideo.pause();shareScreen.hidden=true;cameraSurface.classList.remove('is-sharing')
  if(!playback.hidden)setCameraReviewBottomBar(true)
  if(!recordedVideo.hidden)recordedVideo.play().catch(()=>{})
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
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        video:false,
        audio:{
          channelCount:{ideal:2},
          sampleRate:{ideal:48000},
          sampleSize:{ideal:24},
          echoCancellation:{ideal:false},
          noiseSuppression:{ideal:false},
          autoGainControl:{ideal:false}
        }
      })
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

  const mimeType = supportedMimeType()
  const recorderOptions = {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 256000,
    videoBitsPerSecond: 12000000
  }
  try { recorder = new MediaRecorder(recordingStream, recorderOptions) }
  catch {
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
    capture.classList.remove('is-recording'); pill.hidden = true; closeButton?.removeAttribute('hidden'); window.clearInterval(recordingTimer)
    setStatus('Recording stopped because the browser reported an error.')
  }

  recorder.start()
  recordingStartedAt = Date.now(); updateTimer(); recordingTimer = window.setInterval(updateTimer, 250)
  lockedRecording=false; lockHot=false
  capture.classList.add('is-recording','is-following'); recordLock.classList.add('is-visible'); pill.hidden=false
  closeButton?.setAttribute('hidden','')
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
  closeButton?.removeAttribute('hidden')
}
// melogic-camera-quality-focus-v2
function takePhoto() {
  const sw=video.videoWidth,sh=video.videoHeight
  if(!sw||!sh)return
  const rect=liveCanvas.getBoundingClientRect(),targetRatio=rect.width/Math.max(1,rect.height),sourceRatio=sw/sh
  let sx=0,sy=0,cw=sw,ch=sh
  if(sourceRatio>targetRatio){cw=sh*targetRatio;sx=(sw-cw)/2}else{ch=sw/targetRatio;sy=(sh-ch)/2}
  const photoCanvas=document.createElement('canvas')
  photoCanvas.width=Math.max(1,Math.round(cw));photoCanvas.height=Math.max(1,Math.round(ch))
  const ctx=photoCanvas.getContext('2d',{alpha:false})
  if(!ctx)return
  if(facingMode==='user'){ctx.translate(photoCanvas.width,0);ctx.scale(-1,1)}
  ctx.drawImage(video,sx,sy,cw,ch,0,0,photoCanvas.width,photoCanvas.height)
  photoCanvas.toBlob(blob=>{if(blob)showCapturedMedia(blob,'photo')},'image/jpeg',.96)
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
// Bind against Camera's persistent surface, not the shared #app outlet.
// On a cold /camera load the module is evaluated before cameraSurface is mounted
// into #app, so querying #app here returns null and aborts the entire module.
const flipButton = cameraSurface.querySelector('[data-camera-flip]')
if (flipButton) flipButton.addEventListener('click', flipCamera)
libraryButton.addEventListener('click', () => {
  // No `capture` attribute: request existing photo/video media instead of forcing a new camera capture.
  libraryInput.value = ''
  libraryInput.click()
})
libraryInput.addEventListener('change', () => {
  const file = libraryInput.files?.[0]
  if (!file) return
  const name=String(file.name||'').toLowerCase()
  const type = file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|avi|mkv|3gp|3g2|mpeg|mpg|ogv)$/i.test(name)
    ? 'video'
    : file.type.startsWith('image/') || /\.(heic|heif|avif|jpg|jpeg|jfif|png|webp|gif|bmp|tif|tiff)$/i.test(name)
      ? 'photo'
      : ''
  if (!type) { setStatus('Choose a photo or video from your library.'); return }
  // The file input is intentionally single-select. Once iOS hands the chosen
  // asset back to the page, enter the editor/review immediately.
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
  void focusCameraAt(event.clientX,event.clientY)
})
flashButton.addEventListener('click',async event=>{const button=event.currentTarget;if(facingMode==='user'){frontFlashOn=!frontFlashOn;button.dataset.on=String(frontFlashOn);button.setAttribute('aria-pressed',String(frontFlashOn));updateFrontFlash();return}const track=stream?.getVideoTracks?.()[0],caps=track?.getCapabilities?.()||{};if(!track||!caps.torch){setStatus('Flash is not available with this camera.');setTimeout(()=>setStatus(''),1600);return}const current=typeof track.getSettings?.().torch==='boolean'?track.getSettings().torch:button.dataset.on==='true',next=!current;try{await track.applyConstraints({advanced:[{torch:next}]});const actual=track.getSettings?.().torch,on=typeof actual==='boolean'?actual:next;button.dataset.on=String(on);button.setAttribute('aria-pressed',String(on));flashStrength.hidden=!on}catch(error){console.warn('[camera] torch toggle failed',error);setStatus('Unable to change flash on this camera.');setTimeout(()=>setStatus(''),1600)}})
flashStrength.addEventListener('input',updateFrontFlash)
exposureSlider?.addEventListener('input',event=>{ void setCameraExposure(event.currentTarget.value) })

cameraSurface.querySelector('[data-camera-editor-selection-actions]')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-camera-layer-action]');if(!button||!editorState.selectedLayerId)return
  event.preventDefault();event.stopPropagation();const action=button.dataset.cameraLayerAction
  if(action==='delete')removeCameraEditorLayer(editorState.selectedLayerId)
  else if(action==='duplicate')duplicateCameraEditorLayer()
  else if(action==='forward')moveCameraEditorLayer(editorState.selectedLayerId,1)
  else if(action==='back')moveCameraEditorLayer(editorState.selectedLayerId,-1)
})
const editToolRail=cameraSurface.querySelector('[data-camera-edit-tools]'),editToolContext=cameraSurface.querySelector('[data-camera-edit-tool-context]')
const CAMERA_TOOL_LABELS={text:'Text',pen:'Draw',sticker:'Stickers',crop:'Crop',video:'Video',adjust:'Adjust',music:'Music',image:'Image'}
function setCameraToolRail(tool=''){
  if(!editToolRail)return
  editToolRail.dataset.activeTool=tool;editToolRail.classList.toggle('is-expanded',!!tool);cameraSurface.dataset.cameraActiveTool=tool
  editToolRail.querySelectorAll(':scope > [data-camera-edit-tool]').forEach(button=>{const active=button.dataset.cameraEditTool===tool;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active))})
  if(editToolContext){editToolContext.textContent=tool?(CAMERA_TOOL_LABELS[tool]||tool):'';editToolContext.setAttribute('aria-hidden',String(!tool))}
  const penRailControls=editToolRail.querySelector('[data-camera-pen-rail-controls]');if(penRailControls)penRailControls.setAttribute('aria-hidden',String(tool!=='pen'))
  const textRailControls=editToolRail.querySelector('[data-camera-text-rail-controls]');if(textRailControls)textRailControls.setAttribute('aria-hidden',String(tool!=='text'))
}
function closeCameraToolPanels(except=''){
  const panels={text:editTextbox,pen:drawControls,sticker:cameraSurface.querySelector('[data-camera-sticker-picker]'),crop:cameraSurface.querySelector('[data-camera-crop-controls]'),video:videoControls,adjust:adjustControls,music:audioControls}
  Object.entries(panels).forEach(([name,panel])=>{if(panel&&name!==except)panel.hidden=true})
  if(except!=='text'){cameraSurface.querySelector('[data-camera-text-dim]')?.setAttribute('hidden','');if(document.activeElement===editTextInput)editTextInput.blur()}
  if(except!=='sticker'){const form=cameraSurface.querySelector('[data-camera-interactive-editor]');if(form)form.hidden=true}
  if(except!=='pen')editCanvas.classList.remove('is-drawing-mode')
  if(except!=='crop'){editCanvas.classList.remove('is-crop-mode');cameraSurface.classList.remove('is-media-transforming')}
}
function toggleCameraToolRail(tool,button){
  const closing=editToolRail?.dataset.activeTool===tool
  closeCameraToolPanels(closing?'':tool);setCameraToolRail(closing?'':tool)
  if(closing){editMode='';return false}
  editMode=tool;return true
}
cameraSurface.addEventListener('click',e=>{const b=e.target.closest('[data-camera-edit-tool]');if(!b||!b.closest('[data-camera-edit-tools],[data-camera-editor-functions]'))return;const t=b.dataset.cameraEditTool;if(t==='undo'){if(!undoCameraEditor())restoreEditSnapshot(editHistory.pop()||'');return}if(t==='redo'){redoCameraEditor();return}if(t==='video'){if(playback.dataset.captureType!=='video')return;const open=toggleCameraToolRail(t,b);if(videoControls){videoControls.hidden=!open;if(open)syncCameraVideoControls()}return}if(t==='adjust'){const open=toggleCameraToolRail(t,b);if(adjustControls){adjustControls.hidden=!open;if(open)syncCameraAdjustmentControls()}return}if(t==='music'){const open=toggleCameraToolRail(t,b);if(audioControls){audioControls.hidden=!open;if(open)syncCameraAudioControls()}return}if(t==='image'){closeCameraToolPanels('');editMode='';setCameraToolRail('');editImageInput.value='';editImageInput.click();return}if(t==='sticker'){const open=toggleCameraToolRail(t,b),picker=cameraSurface.querySelector('[data-camera-sticker-picker]');if(picker){picker.hidden=!open;if(open){renderCameraStickerGrid('featured','');void loadCameraStickerAssets()}}return}const open=toggleCameraToolRail(t,b);if(open&&t==='pen')syncPenRailControls();editTextbox.hidden=!(open&&t==='text');if(drawControls)drawControls.hidden=true;editCanvas.classList.toggle('is-drawing-mode',open&&t==='pen');editCanvas.classList.toggle('is-crop-mode',open&&t==='crop');const cropControls=cameraSurface.querySelector('[data-camera-crop-controls]');if(cropControls)cropControls.hidden=!(open&&t==='crop');cameraSurface.classList.toggle('is-media-transforming',open&&t==='crop');if(open&&t==='text'){const selected=selectedCameraTextLayer();if(selected)syncCameraTextControls(selected);else{editorState.selectedLayerId='';editTextInput.value='';if(textFont)textFont.value='system';if(textColor)textColor.value='#ffffff';if(textSize)textSize.value='36';syncTextRailControls(null)}cameraSurface.querySelector('[data-camera-text-dim]')?.removeAttribute('hidden');requestAnimationFrame(()=>editTextInput.focus({preventScroll:true}))}})
const penRailColor=cameraSurface.querySelector('[data-camera-pen-rail-color]'),penRailSize=cameraSurface.querySelector('[data-camera-pen-rail-size]'),penRailOpacity=cameraSurface.querySelector('[data-camera-pen-rail-opacity]')
const canonicalDrawColor=cameraSurface.querySelector('[data-camera-draw-color]'),canonicalDrawSize=cameraSurface.querySelector('[data-camera-draw-size]'),canonicalDrawOpacity=cameraSurface.querySelector('[data-camera-draw-opacity]')
function syncPenRailControls(){
 if(penRailColor&&canonicalDrawColor)penRailColor.value=canonicalDrawColor.value
 if(penRailSize&&canonicalDrawSize)penRailSize.value=canonicalDrawSize.value
 if(penRailOpacity&&canonicalDrawOpacity)penRailOpacity.value=canonicalDrawOpacity.value
}
function relayPenRailInput(proxy,target){if(!proxy||!target)return;proxy.addEventListener('input',()=>{target.value=proxy.value;target.dispatchEvent(new Event('input',{bubbles:true}))});proxy.addEventListener('change',()=>{target.value=proxy.value;target.dispatchEvent(new Event('change',{bubbles:true}))})}
relayPenRailInput(penRailColor,canonicalDrawColor);relayPenRailInput(penRailSize,canonicalDrawSize);relayPenRailInput(penRailOpacity,canonicalDrawOpacity)
const videoControls=cameraSurface.querySelector('[data-camera-video-controls]'),videoTrimStart=cameraSurface.querySelector('[data-camera-video-trim-start]'),videoTrimEnd=cameraSurface.querySelector('[data-camera-video-trim-end]'),videoSelection=cameraSurface.querySelector('[data-camera-video-selection]')
function cameraVideoDuration(){return Math.max(0,editorState.media.durationMs||Math.round((recordedVideo.duration||0)*1000))}
function formatCameraVideoTime(ms){const seconds=Math.max(0,ms)/1000,m=Math.floor(seconds/60),s=(seconds-m*60).toFixed(1).padStart(4,'0');return `${m}:${s}`}
function syncCameraVideoControls(){
  const duration=cameraVideoDuration(),v=editorState.video||{},start=clampEditorValue(v.trimStartMs||0,0,duration),end=clampEditorValue(v.trimEndMs||duration,0,duration)
  if(videoTrimStart){videoTrimStart.max=String(duration||1);videoTrimStart.value=String(start)}
  if(videoTrimEnd){videoTrimEnd.max=String(duration||1);videoTrimEnd.value=String(end)}
  if(videoSelection&&duration){videoSelection.style.left=`${start/duration*100}%`;videoSelection.style.right=`${100-end/duration*100}%`}
  const sl=cameraSurface.querySelector('[data-camera-video-start-label]'),dl=cameraSurface.querySelector('[data-camera-video-duration-label]'),el=cameraSurface.querySelector('[data-camera-video-end-label]');if(sl)sl.textContent=formatCameraVideoTime(start);if(dl)dl.textContent=formatCameraVideoTime(duration);if(el)el.textContent=formatCameraVideoTime(end)
  cameraSurface.querySelectorAll('[data-camera-video-speed]').forEach(button=>button.classList.toggle('is-active',Number(button.dataset.cameraVideoSpeed)===(v.playbackRate||1)))
}
function updateCameraVideo(patch){pushCameraEditorHistory();editorState.video={...editorState.video,...patch};editorState.revision+=1;recordedVideo.playbackRate=editorState.video.playbackRate||1;syncCameraVideoControls()}
videoTrimStart?.addEventListener('change',()=>{const duration=cameraVideoDuration(),end=editorState.video.trimEndMs||duration,start=Math.min(Number(videoTrimStart.value)||0,Math.max(0,end-100));updateCameraVideo({trimStartMs:start});recordedVideo.currentTime=start/1000})
videoTrimEnd?.addEventListener('change',()=>{const duration=cameraVideoDuration(),start=editorState.video.trimStartMs||0,end=Math.max(Number(videoTrimEnd.value)||duration,start+100);updateCameraVideo({trimEndMs:Math.min(end,duration)})})
cameraSurface.querySelector('.camera-video-speeds')?.addEventListener('click',event=>{const button=event.target.closest('[data-camera-video-speed]');if(button)updateCameraVideo({playbackRate:Number(button.dataset.cameraVideoSpeed)||1})})
cameraSurface.querySelector('[data-camera-video-reset]')?.addEventListener('click',()=>updateCameraVideo({trimStartMs:0,trimEndMs:cameraVideoDuration(),playbackRate:1}))
cameraSurface.querySelector('[data-camera-video-close]')?.addEventListener('click',()=>{if(editToolRail?.dataset.activeTool==='video')toggleCameraToolRail('video')})
recordedVideo.addEventListener('timeupdate',()=>{const v=editorState.video||{},start=(v.trimStartMs||0)/1000,end=(v.trimEndMs||cameraVideoDuration())/1000;if(end>start&&recordedVideo.currentTime>=end-.02)recordedVideo.currentTime=start})

const adjustControls=cameraSurface.querySelector('[data-camera-adjust-controls]')
renderCameraAdjustmentControls()
cameraSurface.querySelector('[data-camera-adjust-close]')?.addEventListener('click',()=>{if(editToolRail?.dataset.activeTool==='adjust')toggleCameraToolRail('adjust')})

const audioControls=cameraSurface.querySelector('[data-camera-audio-controls]'),originalVolume=cameraSurface.querySelector('[data-camera-original-volume]'),originalMute=cameraSurface.querySelector('[data-camera-original-mute]'),musicVolume=cameraSurface.querySelector('[data-camera-music-volume]'),musicStart=cameraSurface.querySelector('[data-camera-music-start]'),musicEnd=cameraSurface.querySelector('[data-camera-music-end]'),musicFadeIn=cameraSurface.querySelector('[data-camera-music-fade-in]'),musicFadeOut=cameraSurface.querySelector('[data-camera-music-fade-out]'),musicRemove=cameraSurface.querySelector('[data-camera-music-remove]')
function applyCameraAudioPreview(){
  const audio=editorState.audio||{};recordedVideo.volume=clampEditorValue(Number(audio.originalVolume)??1,0,1);recordedVideo.muted=Boolean(audio.muted)
}
function syncCameraAudioControls(){
  const audio=editorState.audio||{};if(originalVolume)originalVolume.value=String(Math.round((audio.originalVolume??1)*100));if(originalMute)originalMute.checked=!!audio.muted;if(musicVolume)musicVolume.value=String(Math.round((audio.musicVolume??.8)*100));if(musicStart)musicStart.value=String((audio.musicStartMs||0)/1000);if(musicEnd)musicEnd.value=String((audio.musicEndMs||15000)/1000);if(musicFadeIn)musicFadeIn.value=String((audio.fadeInMs||0)/1000);if(musicFadeOut)musicFadeOut.value=String((audio.fadeOutMs||0)/1000);const selected=cameraSurface.querySelector('[data-camera-music-selected]'),title=cameraSurface.querySelector('[data-camera-music-selected-title]'),artist=cameraSurface.querySelector('[data-camera-music-selected-artist]');if(selected)selected.hidden=!audio.music;if(title)title.textContent=audio.music?.title||'';if(artist)artist.textContent=audio.music?.artistName||audio.music?.sourceLabel||''
}
function updateCameraAudio(patch){pushCameraEditorHistory();editorState.audio={...editorState.audio,...patch};editorState.revision+=1;applyCameraAudioPreview();syncCameraAudioControls()}
originalVolume?.addEventListener('change',()=>updateCameraAudio({originalVolume:Number(originalVolume.value)/100}))
originalMute?.addEventListener('change',()=>updateCameraAudio({muted:originalMute.checked}))
musicVolume?.addEventListener('change',()=>updateCameraAudio({musicVolume:Number(musicVolume.value)/100}))

musicStart?.addEventListener('change',()=>updateCameraAudio({musicStartMs:Math.max(0,Math.round(Number(musicStart.value||0)*1000))}))
musicEnd?.addEventListener('change',()=>updateCameraAudio({musicEndMs:Math.max(100,Math.round(Number(musicEnd.value||15)*1000))}))
musicFadeIn?.addEventListener('change',()=>updateCameraAudio({fadeInMs:Math.max(0,Math.round(Number(musicFadeIn.value||0)*1000))}))
musicFadeOut?.addEventListener('change',()=>updateCameraAudio({fadeOutMs:Math.max(0,Math.round(Number(musicFadeOut.value||0)*1000))}))
musicRemove?.addEventListener('click',()=>updateCameraAudio({music:null}))
let cameraMusicReleases=[],cameraMusicSearchTimer=0,cameraMusicObjectUrl=''
function closeCameraMusicSheet(){audioControls.hidden=true;if(editToolRail?.dataset.activeTool==='music'){editMode='';closeCameraToolPanels('');setCameraToolRail('')}}
function renderCameraMusicResults(releases=[]){
 const host=cameraSurface.querySelector('[data-camera-music-results]'),empty=cameraSurface.querySelector('[data-camera-music-empty]');if(!host)return
 host.replaceChildren(...releases.map(release=>{const button=document.createElement('button');button.type='button';button.className='camera-music-result';button.dataset.cameraMusicRelease=release.id;const art=document.createElement(release.coverArtURL?'img':'span');if(release.coverArtURL){art.src=release.coverArtURL;art.alt=''}else{art.className='camera-music-art-fallback';art.textContent='♪'}const copy=document.createElement('span');copy.innerHTML='<strong></strong><small></small>';copy.querySelector('strong').textContent=release.title;copy.querySelector('small').textContent=release.artistName;button.append(art,copy);return button}))
 if(empty)empty.hidden=releases.length>0
}
async function loadCameraMusic(queryText=''){
 try{cameraMusicReleases=queryText.trim()?await searchMusic(queryText,20):await listNewMusicReleases(20);renderCameraMusicResults(cameraMusicReleases)}catch(error){console.warn('[camera/music] catalog load failed',error);renderCameraMusicResults([])}
}
cameraSurface.querySelector('[data-camera-music-search]')?.addEventListener('input',event=>{clearTimeout(cameraMusicSearchTimer);cameraMusicSearchTimer=setTimeout(()=>void loadCameraMusic(event.target.value),220)})
cameraSurface.querySelector('[data-camera-music-results]')?.addEventListener('click',async event=>{const button=event.target.closest('[data-camera-music-release]');if(!button)return;const release=cameraMusicReleases.find(item=>item.id===button.dataset.cameraMusicRelease);if(!release)return;const tracks=await listTracksForRelease(release.id),track=tracks.find(isNativeMusicTrackPlayable);if(!track)return;updateCameraAudio({music:{id:track.id,title:track.title,artistName:track.artistName||release.artistName,url:track.streamAudioURL,releaseId:release.id,source:'melogic-streaming'},musicStartMs:0,musicEndMs:Math.min(15000,Math.max(100,Math.round((track.duration||15)*1000)))})})
cameraSurface.querySelector('[data-camera-music-import]')?.addEventListener('click',()=>cameraSurface.querySelector('[data-camera-music-file]')?.click())
cameraSurface.querySelector('[data-camera-music-file]')?.addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;if(cameraMusicObjectUrl)URL.revokeObjectURL(cameraMusicObjectUrl);cameraMusicObjectUrl=URL.createObjectURL(file);updateCameraAudio({music:{id:cameraEditorId('music'),title:file.name.replace(/\.[^.]+$/,''),artistName:'Imported audio',url:cameraMusicObjectUrl,source:'local-import'},musicStartMs:0,musicEndMs:15000});event.target.value=''})
cameraSurface.querySelector('[data-camera-audio-dismiss]')?.addEventListener('click',closeCameraMusicSheet)
function installCameraSheetDrag(sheet,close){
 if(!sheet)return;const grabber=sheet.querySelector('.camera-sheet-grabber');if(!grabber)return
 let startY=0,delta=0,active=false
 grabber.addEventListener('pointerdown',event=>{active=true;startY=event.clientY;delta=0;grabber.setPointerCapture?.(event.pointerId);sheet.classList.add('is-dragging')})
 grabber.addEventListener('pointermove',event=>{if(!active)return;delta=Math.max(0,event.clientY-startY);sheet.style.transform=`translateY(${delta}px)`})
 const finish=()=>{if(!active)return;active=false;sheet.classList.remove('is-dragging');sheet.style.removeProperty('transform');if(delta>90)close()}
 grabber.addEventListener('pointerup',finish);grabber.addEventListener('pointercancel',finish)
}
installCameraSheetDrag(cameraSurface.querySelector('[data-camera-sticker-picker]'),closeCameraStickerSheet)
installCameraSheetDrag(audioControls,closeCameraMusicSheet)
const cameraVisualViewport=window.visualViewport
function syncCameraEditorViewport(){const height=cameraVisualViewport?.height||window.innerHeight;cameraSurface.style.setProperty('--camera-editor-viewport-height',`${Math.round(height)}px`)}
cameraVisualViewport?.addEventListener('resize',syncCameraEditorViewport,{passive:true});cameraVisualViewport?.addEventListener('scroll',syncCameraEditorViewport,{passive:true});syncCameraEditorViewport()

cameraSurface.querySelector('[data-camera-audio-close]')?.addEventListener('click',closeCameraMusicSheet)

const cropZoom=cameraSurface.querySelector('[data-camera-crop-zoom]')
function cameraSourceAspect(){const w=editorState.media.sourceWidth||1,h=editorState.media.sourceHeight||1;return w/h}
function setCameraCropAspect(aspect){
  const ratios={original:cameraSourceAspect(),'9:16':9/16,'4:5':4/5,'1:1':1,'16:9':16/9}
  const ratio=aspect==='free'?null:(ratios[aspect]||cameraSourceAspect())
  setCameraMediaTransform({crop:{aspect,ratio:ratio?String(ratio):'auto'}})
  cameraSurface.querySelectorAll('[data-camera-crop-aspect]').forEach(button=>button.classList.toggle('is-active',button.dataset.cameraCropAspect===aspect))
}
cameraSurface.querySelector('[data-camera-crop-controls]')?.addEventListener('click',event=>{
  const aspect=event.target.closest('[data-camera-crop-aspect]');if(aspect){setCameraCropAspect(aspect.dataset.cameraCropAspect);return}
  const action=event.target.closest('[data-camera-crop-action]')?.dataset.cameraCropAction;if(!action)return
  if(action==='rotate')setCameraMediaTransform({rotation:(Number(editorState.transform.rotation)||0)+90})
  if(action==='flip-x')setCameraMediaTransform({flipX:!editorState.transform.flipX})
  if(action==='flip-y')setCameraMediaTransform({flipY:!editorState.transform.flipY})
  if(action==='reset'){pushCameraEditorHistory();editorState.transform=createCameraEditorState().transform;editorState.revision+=1;if(cropZoom)cropZoom.value='100';applyCameraMediaTransform();cameraSurface.querySelectorAll('[data-camera-crop-aspect]').forEach(button=>button.classList.toggle('is-active',button.dataset.cameraCropAspect==='free'))}
  if(action==='done'){editMode='';cameraSurface.classList.remove('is-media-transforming');cameraSurface.querySelector('[data-camera-crop-controls]').hidden=true;editCanvas.classList.remove('is-crop-mode');setCameraToolRail('')}
})
let cropZoomHistoryArmed=false
cropZoom?.addEventListener('pointerdown',()=>{cropZoomHistoryArmed=false})
cropZoom?.addEventListener('input',()=>{if(!cropZoomHistoryArmed){pushCameraEditorHistory();cropZoomHistoryArmed=true}setCameraMediaTransform({scale:clampEditorValue(Number(cropZoom.value)/100,1,4)},{history:false})})
cropZoom?.addEventListener('change',()=>{cropZoomHistoryArmed=false})

const textFont=cameraSurface.querySelector('[data-camera-text-font]'),textColor=cameraSurface.querySelector('[data-camera-text-color]'),textSize=cameraSurface.querySelector('[data-camera-text-size]')
const textRailFont=cameraSurface.querySelector('[data-camera-text-rail-font]'),textRailColor=cameraSurface.querySelector('[data-camera-text-rail-color]'),textRailBorderColor=cameraSurface.querySelector('[data-camera-text-rail-border-color]'),textRailSize=cameraSurface.querySelector('[data-camera-text-rail-size]'),textRailOpacity=cameraSurface.querySelector('[data-camera-text-rail-opacity]')
function selectedCameraTextLayer(){return editorState.layers.find(layer=>layer.id===editorState.selectedLayerId&&layer.type==='text')||null}
function syncTextRailControls(layer){
  const value=layer||{}
  if(textRailFont)textRailFont.value=value.fontFamily||textFont?.value||'system'
  if(textRailColor)textRailColor.value=value.color||textColor?.value||'#ffffff'
  if(textRailBorderColor)textRailBorderColor.value=value.borderColor&&value.borderColor!=='transparent'?value.borderColor:'#000000'
  if(textRailSize)textRailSize.value=String(value.fontSize||Number(textSize?.value)||36)
  if(textRailOpacity)textRailOpacity.value=String(Math.round((value.opacity??1)*100))
  cameraSurface.querySelectorAll('[data-camera-text-rail-style]').forEach(button=>{
    const style=button.dataset.cameraTextRailStyle
    const active=style==='bold'?Number(value.fontWeight||700)>=700:style==='italic'?value.fontStyle==='italic':value.textDecoration==='underline'
    button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active))
  })
}
function syncCameraTextControls(layer){
  if(!layer)return
  editTextInput.value=layer.text||''
  if(textFont)textFont.value=layer.fontFamily||'system'
  if(textColor)textColor.value=layer.color||'#ffffff'
  if(textSize)textSize.value=String(layer.fontSize||36)
  syncTextRailControls(layer)
}
function closeCameraTextEditor({commit=true}={}){
  if(commit)commitCameraText();else{editTextbox.hidden=true;cameraSurface.querySelector('[data-camera-text-dim]')?.setAttribute('hidden','');editMode='';setCameraToolRail('')}
}
function commitCameraText(){
  const value=editTextInput.value.trim();if(!value){editTextbox.hidden=true;cameraSurface.querySelector('[data-camera-text-dim]')?.setAttribute('hidden','');editMode='';setCameraToolRail('');return}
  let layer=selectedCameraTextLayer()
  const props={text:value,fontFamily:textRailFont?.value||textFont?.value||'system',fontSize:Number(textRailSize?.value||textSize?.value)||36,color:textRailColor?.value||textColor?.value||'#ffffff',borderColor:textRailBorderColor?.value||'#000000',borderWidth:1,opacity:(Number(textRailOpacity?.value)||100)/100}
  if(layer)updateCameraEditorLayer(layer.id,props)
  else layer=addCameraEditorLayer('text',{...props,width:.62,height:.14,fontWeight:700,textAlign:'center',background:false})
  editTextbox.hidden=true;cameraSurface.querySelector('[data-camera-text-dim]')?.setAttribute('hidden','');editMode='';setCameraToolRail('');renderCameraEditorLayers()
}
cameraSurface.querySelector('[data-camera-edit-text-add]')?.addEventListener('click',commitCameraText)
editTextInput?.addEventListener('input',()=>{
  let layer=selectedCameraTextLayer();const text=editTextInput.value
  if(!layer&&text){layer=addCameraEditorLayer('text',{text,fontFamily:textRailFont?.value||textFont?.value||'system',fontSize:Number(textRailSize?.value||textSize?.value)||36,color:textRailColor?.value||textColor?.value||'#ffffff',borderColor:textRailBorderColor?.value||'#000000',borderWidth:1,opacity:(Number(textRailOpacity?.value)||100)/100,width:.72,height:.18,fontWeight:700,fontStyle:'normal',textDecoration:'none',textAlign:'center',background:false});editorState.__textDraftId=layer.id;syncTextRailControls(layer)}
  else if(layer)updateCameraEditorLayer(layer.id,{text},{history:false})
})
editTextInput?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();commitCameraText()}})
textFont?.addEventListener('change',()=>{const layer=selectedCameraTextLayer();if(layer)updateCameraEditorLayer(layer.id,{fontFamily:textFont.value})})
textColor?.addEventListener('input',()=>{const layer=selectedCameraTextLayer();if(layer)updateCameraEditorLayer(layer.id,{color:textColor.value})})
textSize?.addEventListener('input',()=>{const layer=selectedCameraTextLayer();if(layer)updateCameraEditorLayer(layer.id,{fontSize:Number(textSize.value)||36})})
cameraSurface.querySelectorAll('[data-camera-text-style]').forEach(button=>button.addEventListener('click',()=>{
  const layer=selectedCameraTextLayer();if(!layer)return
  const style=button.dataset.cameraTextStyle
  if(style==='weight')updateCameraEditorLayer(layer.id,{fontWeight:Number(layer.fontWeight)===400?700:400})
  if(style==='align'){const values=['left','center','right'],index=values.indexOf(layer.textAlign||'center');updateCameraEditorLayer(layer.id,{textAlign:values[(index+1)%values.length]})}
  if(style==='background')updateCameraEditorLayer(layer.id,{background:!layer.background})
}))
function updateTextRailLayer(patch){const layer=selectedCameraTextLayer();if(!layer)return;const updated=updateCameraEditorLayer(layer.id,patch);if(updated)syncTextRailControls(updated)}
textRailFont?.addEventListener('change',()=>updateTextRailLayer({fontFamily:textRailFont.value}))
textRailColor?.addEventListener('input',()=>updateTextRailLayer({color:textRailColor.value}))
textRailBorderColor?.addEventListener('input',()=>updateTextRailLayer({borderColor:textRailBorderColor.value,borderWidth:1}))
textRailSize?.addEventListener('input',()=>updateTextRailLayer({fontSize:Number(textRailSize.value)||36}))
textRailOpacity?.addEventListener('input',()=>updateTextRailLayer({opacity:(Number(textRailOpacity.value)||100)/100}))
cameraSurface.querySelectorAll('[data-camera-text-rail-style]').forEach(button=>button.addEventListener('click',event=>{
  event.preventDefault();event.stopPropagation()
  const layer=selectedCameraTextLayer();if(!layer)return
  const style=button.dataset.cameraTextRailStyle
  if(style==='bold')updateTextRailLayer({fontWeight:Number(layer.fontWeight||700)>=700?400:700})
  if(style==='italic')updateTextRailLayer({fontStyle:layer.fontStyle==='italic'?'normal':'italic'})
  if(style==='underline')updateTextRailLayer({textDecoration:layer.textDecoration==='underline'?'none':'underline'})
}))
editImageInput.addEventListener('change',()=>{const file=editImageInput.files?.[0];if(!file)return;const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{
  const aspect=i.naturalWidth&&i.naturalHeight?i.naturalWidth/i.naturalHeight:1
  const width=aspect>=1?.42:.42*aspect,height=aspect>=1?.42/aspect:.42
  addCameraEditorLayer('image',{previewURL:u,fileName:file.name||'',mimeType:file.type||'',naturalWidth:i.naturalWidth||0,naturalHeight:i.naturalHeight||0,width:clampEditorValue(width,.12,.72),height:clampEditorValue(height,.12,.72),fit:'contain'})
};i.onerror=()=>URL.revokeObjectURL(u);i.src=u})
const CAMERA_STICKERS={
  utility:[{value:'@',utility:'mention'},{value:'#',utility:'hashtag'},{value:'⌖',utility:'location'},{value:'↗',utility:'link'},{value:'?',utility:'poll'},{value:'♪',utility:'music'}],
  melogic:[{value:'S',utility:'soura'},{value:'V',utility:'vertix'},{value:'P',utility:'product'},{value:'▶',utility:'project'},{value:'♪',utility:'track'},{value:'M',utility:'profile'}]
}
let cameraStickerAssets=[],cameraStickerTab='featured',cameraStickerQuery='',cameraStickerLoading=false
async function loadCameraStickerAssets(){
  if(cameraStickerLoading)return;cameraStickerLoading=true
  try{cameraStickerAssets=await listCameraStickerAssets({limitCount:120})}catch(error){console.warn('[camera/stickers] Unable to load sticker catalog.',error?.message||error);cameraStickerAssets=[]}
  finally{cameraStickerLoading=false;renderCameraStickerGrid(cameraStickerTab,cameraStickerQuery)}
}
function renderCameraStickerGrid(tab='featured',search=''){
  const grid=cameraSurface.querySelector('[data-camera-sticker-grid]'),empty=cameraSurface.querySelector('[data-camera-sticker-empty]');if(!grid)return
  cameraStickerTab=tab;cameraStickerQuery=String(search||'').trim().toLowerCase()
  cameraSurface.querySelectorAll('[data-sticker-tab]').forEach(button=>button.classList.toggle('is-active',button.dataset.stickerTab===tab))
  if(tab==='utility'||tab==='melogic'){
    const items=CAMERA_STICKERS[tab]||[]
    grid.replaceChildren(...items.map((data,index)=>{const button=document.createElement('button');button.type='button';button.dataset.cameraStickerIndex=String(index);button.dataset.cameraStickerTab=tab;button.className='is-interactive';button.textContent=data.value||'';return button}))
    if(empty)empty.hidden=items.length>0;return
  }
  const assets=cameraStickerAssets.filter(asset=>{
    if(tab==='stickers'&&asset.kind==='gif')return false;if(tab==='gifs'&&asset.kind!=='gif')return false
    if(!cameraStickerQuery)return true
    return [asset.title,...(asset.tags||[])].join(' ').toLowerCase().includes(cameraStickerQuery)
  })
  grid.replaceChildren(...assets.map(asset=>{const button=document.createElement('button');button.type='button';button.dataset.cameraStickerAsset=asset.id;button.className='is-asset';const img=document.createElement('img');img.src=asset.thumbnailUrl||asset.url;img.alt=asset.title||'Sticker';img.loading='lazy';button.append(img);return button}))
  if(empty)empty.hidden=assets.length>0
}
function closeCameraStickerSheet(){const picker=cameraSurface.querySelector('[data-camera-sticker-picker]');if(picker)picker.hidden=true;const form=cameraSurface.querySelector('[data-camera-interactive-editor]');if(form)form.hidden=true;if(editToolRail?.dataset.activeTool==='sticker'){editMode='';closeCameraToolPanels('');setCameraToolRail('')}}
cameraSurface.querySelector('[data-camera-sticker-picker]')?.addEventListener('click',event=>{
  const assetButton=event.target.closest('[data-camera-sticker-asset]');if(assetButton){const asset=cameraStickerAssets.find(item=>item.id===assetButton.dataset.cameraStickerAsset);if(asset){addCameraEditorLayer('image',{previewURL:asset.url,assetId:asset.id,assetKind:asset.kind||'sticker',title:asset.title||'',width:.34,height:.34,fit:'contain'});closeCameraStickerSheet()}return}

  const tab=event.target.closest('[data-sticker-tab]');if(tab){renderCameraStickerGrid(tab.dataset.stickerTab,cameraStickerQuery);return}
  const button=event.target.closest('[data-camera-sticker-index]');if(!button)return
  const type=button.dataset.cameraStickerTab,index=Number(button.dataset.cameraStickerIndex),raw=CAMERA_STICKERS[type]?.[index];if(raw==null)return
  const data=typeof raw==='string'?{value:raw}:raw
  if(type==='utility'||type==='melogic'){openCameraInteractiveEditor(data.utility,type);return}
  addCameraEditorLayer('sticker',{...data,stickerKind:type,width:.2,height:.12,fontSize:44,fill:'#ffffff',color:'#111111'})
})
cameraSurface.querySelector('[data-camera-sticker-search]')?.addEventListener('input',event=>renderCameraStickerGrid(cameraStickerTab,event.target.value))
cameraSurface.querySelector('[data-camera-sticker-close]')?.addEventListener('click',closeCameraStickerSheet)
cameraSurface.querySelector('[data-camera-sticker-dismiss]')?.addEventListener('click',closeCameraStickerSheet)
const interactiveEditor=cameraSurface.querySelector('[data-camera-interactive-editor]'),interactiveTitle=cameraSurface.querySelector('[data-camera-interactive-title]'),interactiveLabel=cameraSurface.querySelector('[data-camera-interactive-label]'),interactiveValue=cameraSurface.querySelector('[data-camera-interactive-value]'),interactiveExtra=cameraSurface.querySelector('[data-camera-interactive-extra]'),interactiveReactive=cameraSurface.querySelector('[data-camera-interactive-reactive]')
let pendingInteractive={kind:'',group:''}
function openCameraInteractiveEditor(kind,group='utility'){
  pendingInteractive={kind,group};interactiveEditor.hidden=false;interactiveTitle.textContent=kind[0].toUpperCase()+kind.slice(1)
  interactiveLabel.value='';interactiveValue.value='';interactiveExtra.value='';interactiveReactive.checked=false
  const placeholders={mention:['Display name','Profile ID or @handle',''],location:['Location','Place ID / coordinates',''],link:['Link title','https://…',''],poll:['Question','Option 1','Option 2'],music:['Track title','Track ID / URL',''],soura:['Soura project','Project ID / URL',''],vertix:['Vertix scene','Scene ID / URL',''],product:['Product','Product ID / URL',''],project:['Project','Project ID / URL',''],track:['Track','Track ID / URL',''],profile:['Profile','Profile ID / @handle',''],hashtag:['Hashtag','#tag','']}
  const p=placeholders[kind]||['Label','Value','Optional'];interactiveLabel.placeholder=p[0];interactiveValue.placeholder=p[1];interactiveExtra.placeholder=p[2]||'Optional second value'
}
interactiveEditor?.addEventListener('submit',event=>{
  event.preventDefault();const kind=pendingInteractive.kind;if(!kind)return
  const label=interactiveLabel.value.trim()||kind,value=interactiveValue.value.trim(),extra=interactiveExtra.value.trim()
  const layer=addCameraEditorLayer('interactive',{interactiveType:kind,namespace:pendingInteractive.group==='melogic'?'melogic':'web',label,value,extra,audioReactive:interactiveReactive.checked,reaction:interactiveReactive.checked?{source:'master',mode:'scale',amount:.12,smoothing:.72}:null,width:.34,height:.11})
  interactiveEditor.hidden=true;selectCameraEditorLayer(layer.id)
})

const editorLayerStage=cameraSurface.querySelector('[data-camera-editor-layer-stage]')
let mediaTransformPointer=null
playback.addEventListener('pointerdown',event=>{
  if(editMode!=='crop'||event.target.closest?.('[data-camera-crop-controls],[data-camera-edit-tools]'))return
  event.preventDefault();pushCameraEditorHistory();mediaTransformPointer={id:event.pointerId,x:event.clientX,y:event.clientY,startX:Number(editorState.transform.x)||0,startY:Number(editorState.transform.y)||0};playback.setPointerCapture?.(event.pointerId)
})
playback.addEventListener('pointermove',event=>{
  if(!mediaTransformPointer||mediaTransformPointer.id!==event.pointerId)return
  const r=playback.getBoundingClientRect();if(!r.width||!r.height)return
  editorState.transform.x=clampEditorValue(mediaTransformPointer.startX+(event.clientX-mediaTransformPointer.x)/r.width*100,-100,100)
  editorState.transform.y=clampEditorValue(mediaTransformPointer.startY+(event.clientY-mediaTransformPointer.y)/r.height*100,-100,100);editorState.revision+=1;applyCameraMediaTransform()
})
function finishMediaTransformPointer(event){if(mediaTransformPointer?.id===event.pointerId)mediaTransformPointer=null}
playback.addEventListener('pointerup',finishMediaTransformPointer);playback.addEventListener('pointercancel',finishMediaTransformPointer)

editorLayerStage?.addEventListener('pointerdown',event=>{
  const target=event.target.closest?.('[data-camera-editor-layer]')
  if(!target)return
  event.preventDefault();event.stopPropagation()
  selectCameraEditorLayer(target.dataset.cameraEditorLayer||'')
  editorPointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
  target.setPointerCapture?.(event.pointerId)
  beginEditorGesture()
})
editorLayerStage?.addEventListener('pointermove',event=>{
  if(!editorPointers.has(event.pointerId))return
  event.preventDefault();editorPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});updateEditorGesture()
})
function finishEditorPointer(event){
  if(!editorPointers.has(event.pointerId))return
  editorPointers.delete(event.pointerId)
  if(editorPointers.size)beginEditorGesture();else editorGesture=null
}
editorLayerStage?.addEventListener('pointerup',finishEditorPointer)
editorLayerStage?.addEventListener('pointercancel',finishEditorPointer)
editorLayerStage?.addEventListener('click',event=>event.stopPropagation())
editorLayerStage?.addEventListener('dblclick',event=>{
  const target=event.target.closest?.('[data-camera-editor-layer]');if(!target)return
  const layer=editorState.layers.find(item=>item.id===target.dataset.cameraEditorLayer);if(layer?.type!=='text')return
  event.preventDefault();event.stopPropagation();selectCameraEditorLayer(layer.id);syncCameraTextControls(layer);editMode='text';setCameraToolRail('text');editTextbox.hidden=false;cameraSurface.querySelector('[data-camera-text-dim]')?.removeAttribute('hidden');editTextInput.focus({preventScroll:true});editTextInput.select()
})

const drawControls=cameraSurface.querySelector('[data-camera-draw-controls]'),drawBrush=cameraSurface.querySelector('[data-camera-draw-brush]'),drawColor=cameraSurface.querySelector('[data-camera-draw-color]'),drawSize=cameraSurface.querySelector('[data-camera-draw-size]'),drawOpacity=cameraSurface.querySelector('[data-camera-draw-opacity]')
cameraSurface.querySelector('[data-camera-draw-controls]')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-camera-draw-brush-option]');if(!button)return
  event.preventDefault();event.stopPropagation();drawBrush.value=button.dataset.cameraDrawBrushOption
  cameraSurface.querySelectorAll('[data-camera-draw-brush-option]').forEach(item=>item.classList.toggle('is-active',item===button))
})
let activeDrawLayerId=''
function normalizedDrawPoint(event){const r=editCanvas.getBoundingClientRect();return{x:clampEditorValue((event.clientX-r.left)/r.width,0,1),y:clampEditorValue((event.clientY-r.top)/r.height,0,1)}}
editCanvas.addEventListener('pointerdown',e=>{
  if(editMode!=='pen')return;e.preventDefault();e.stopPropagation();editDrawing=true;editCanvas.setPointerCapture?.(e.pointerId)
  const brush=drawBrush?.value||'pen'
  if(brush==='eraser'){
    const p=normalizedDrawPoint(e),hit=[...editorState.layers].reverse().find(layer=>layer.type==='draw'&&layer.points?.some(point=>Math.hypot(point.x-p.x,point.y-p.y)<.045))
    if(hit)removeCameraEditorLayer(hit.id);editDrawing=false;return
  }
  const layer=addCameraEditorLayer('draw',{points:[normalizedDrawPoint(e)],brush,color:drawColor?.value||'#ffffff',size:Number(drawSize?.value)||8,opacity:(Number(drawOpacity?.value)||100)/100,x:.5,y:.5,width:1,height:1})
  activeDrawLayerId=layer.id
})
editCanvas.addEventListener('pointermove',e=>{
  if(!editDrawing||editMode!=='pen'||!activeDrawLayerId)return;e.preventDefault()
  const layer=editorState.layers.find(item=>item.id===activeDrawLayerId);if(!layer)return
  const point=normalizedDrawPoint(e),last=layer.points[layer.points.length-1];if(last&&Math.hypot(point.x-last.x,point.y-last.y)<.003)return
  layer.points.push(point);editorState.revision+=1;renderCameraEditorLayers()
})
function finishDrawing(){editDrawing=false;activeDrawLayerId=''}
editCanvas.addEventListener('pointerup',finishDrawing);editCanvas.addEventListener('pointercancel',finishDrawing)
async function cancelCameraReview() {
  closeShareScreen()
  playback.hidden = true; playback._melogicCapture = null
  delete window.__melogicCameraCapture
  recordedVideo.pause(); recordedVideo.removeAttribute('src'); try { recordedVideo.srcObject = null } catch {}; recordedVideo.load(); recordedVideo.hidden = true
  recordedPhoto.removeAttribute('src'); recordedPhoto.hidden = true
  // Retake explicitly re-enters idle Camera mode: video engine only.
  await startCamera()
  setCameraReviewBottomBar(false)
}
ensureCameraReviewBottomBar()
document.addEventListener('click',event=>{
  const cancel=event.target.closest?.('[data-camera-review-cancel]')
  const share=event.target.closest?.('[data-camera-review-share]')
  if(cancel){event.preventDefault();void cancelCameraReview();return}
  if(share){event.preventDefault();openShareScreen()}
})
shareBackButton?.addEventListener('click', closeShareScreen)
shareEditButton?.addEventListener('click', closeShareScreen)
// melogic-camera-share-message-p3-v1
function cameraMessageCaptureFile(){const blob=playback._melogicCapture;if(!blob)return null;const type=playback.dataset.captureType||'video';if(blob instanceof File)return blob;const mime=String(blob.type||'')||(type==='photo'?'image/jpeg':'video/webm');const ext=mime.includes('png')?'png':mime.includes('webp')?'webp':mime.includes('jpeg')?'jpg':mime.includes('quicktime')?'mov':mime.includes('mp4')?'mp4':'webm';return new File([blob],`melogic-${type}-${Date.now()}.${ext}`,{type:mime,lastModified:Date.now()})}
// melogic-camera-messages-multiselect-p3-v1
function selectedCameraMessageThreads(){return cameraMessageThreads.filter(t=>cameraMessageSelectedThreadIds.has(t.id))}
function renderCameraMessageThreads(){
 const q=String(messageSearch.value||'').trim().toLowerCase(),rows=cameraMessageThreads.filter(t=>!t.isAgent&&(!q||`${t.title||''} ${t.subtitle||''}`.toLowerCase().includes(q)))
 messageState.hidden=rows.length>0;messageState.textContent=cameraMessageLoading?'Loading conversations...':(q?'No matching conversations.':'No message conversations yet.')
 messageList.replaceChildren(...rows.map(t=>{const selected=cameraMessageSelectedThreadIds.has(t.id),row=document.createElement('button');row.type='button';row.className='camera-share-thread'+(selected?' is-selected':'');row.dataset.cameraMessageThread=t.id;row.setAttribute('aria-pressed',String(selected));const av=document.createElement('span');av.className='camera-share-thread-avatar';if(t.imageURL){const img=document.createElement('img');img.src=t.imageURL;img.alt='';av.append(img)}else av.textContent=(t.title||'?').trim().charAt(0).toUpperCase()||'?';const copy=document.createElement('span');copy.className='camera-share-thread-copy';const strong=document.createElement('strong');strong.textContent=t.title||'Conversation';const small=document.createElement('small');small.textContent=t.subtitle||'';copy.append(strong,small);const check=document.createElement('span');check.className='camera-share-thread-check';check.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg>';row.append(av,copy,check);return row}))
 const selected=selectedCameraMessageThreads(),count=selected.length;messageSendbar.hidden=count===0;messageSelection.textContent=count===1?`Send to ${selected[0].title||'conversation'}`:`${count} conversations selected`;const actions=messageSendbar.querySelector('[data-camera-message-send-actions]');if(actions){actions.replaceChildren();const add=(label,mode)=>{const b=document.createElement('button');b.type='button';b.dataset.cameraMessageSend='';b.dataset.mode=mode;b.textContent=label;actions.append(b)};if(count===1)add('Send','single');else if(count>1){add('Send Separately','separate');add('Send as Group','group')}}
}
async function openCameraMessagePicker(){if(cameraMessageLoading||cameraMessageSending)return;messagePanel.hidden=false;messagePanel.scrollIntoView({behavior:'smooth',block:'nearest'});if(cameraMessageThreads.length){renderCameraMessageThreads();return}cameraMessageLoading=true;messageState.hidden=false;messageState.textContent='Loading conversations...';try{const user=auth.currentUser||await waitForInitialAuthState();if(!user)throw new Error('Sign in before sending a message.');cameraMessageThreads=await listInboxThreads(user.uid)}catch(error){console.warn('[camera] could not load Inbox conversations',error);messageState.textContent=error?.message||'Could not load conversations.'}finally{cameraMessageLoading=false;renderCameraMessageThreads()}}
function closeCameraMessagePicker(){if(cameraMessageSending)return;messagePanel.hidden=true;cameraMessageSelectedThreadIds.clear();cameraMessageDeliveryMode='';messageSearch.value='';renderCameraMessageThreads()}
function cameraMessageRecipientIds(thread,userId){const ids=new Set();if(thread?.otherParticipantId)ids.add(thread.otherParticipantId);for(const id of getThreadParticipantUids(thread||{}))if(id&&id!==userId)ids.add(id);return [...ids]}
async function sendCameraMedia(mode='single'){const selected=selectedCameraMessageThreads();if(cameraMessageSending||!selected.length)return false;const file=cameraMessageCaptureFile();if(!file){messageState.hidden=false;messageState.textContent='The captured media is no longer available.';return false}try{const user=auth.currentUser||await waitForInitialAuthState();if(!user)throw new Error('Sign in before sending a message.');cameraMessageSending=true;messageSendbar.querySelectorAll('button').forEach(b=>b.disabled=true);if(mode==='group'&&selected.length>1){const participantIds=[...new Set(selected.flatMap(t=>cameraMessageRecipientIds(t,user.uid)))];if(!participantIds.length)throw new Error('No recipients were found for the selected conversations.');const group=await createGroupThread({creatorId:user.uid,participantIds,title:'Shared from Camera'}),threadId=group?.id||group?.threadId;if(!threadId)throw new Error('The group conversation could not be created.');await sendMessage(threadId,{senderId:user.uid,body:'',attachments:[file],clientMessageId:`camera-group-${Date.now()}`});setStatus('Sent to group.')}else{const targets=mode==='single'?[selected[0]]:selected;for(let i=0;i<targets.length;i++)await sendMessage(targets[i].id,{senderId:user.uid,body:'',attachments:[file],clientMessageId:`camera-${Date.now()}-${i}`});setStatus(targets.length===1?'Sent in message.':`Sent separately to ${targets.length} conversations.`)}window.setTimeout(()=>setStatus(''),1800);return true}catch(error){console.warn('[camera] message share failed',{code:error?.code,message:error?.message});messageState.hidden=false;messageState.textContent=error?.message||'Could not send this media.';return false}finally{cameraMessageSending=false;renderCameraMessageThreads()}}
messageSearch?.addEventListener('input',renderCameraMessageThreads)
messageClose?.addEventListener('click',closeCameraMessagePicker)
messageList?.addEventListener('click',event=>{const row=event.target.closest('[data-camera-message-thread]');if(!row||cameraMessageSending)return;const id=row.dataset.cameraMessageThread||'';if(!id)return;if(cameraMessageSelectedThreadIds.has(id))cameraMessageSelectedThreadIds.delete(id);else cameraMessageSelectedThreadIds.add(id);cameraMessageDeliveryMode='';renderCameraMessageThreads()})
messageSendbar?.addEventListener('click',event=>{const button=event.target.closest('[data-camera-message-send]');if(!button||cameraMessageSending)return;cameraMessageDeliveryMode=button.dataset.mode||'single';messageSendbar.querySelectorAll('[data-camera-message-send]').forEach(b=>{const active=b.dataset.mode===cameraMessageDeliveryMode;b.classList.toggle('is-selected',active);b.setAttribute('aria-pressed',String(active))});setStatus(cameraMessageDeliveryMode==='group'?'Messages will send as one group.':cameraMessageDeliveryMode==='separate'?'Messages will send separately.':'Message recipient selected.');window.setTimeout(()=>setStatus(''),1200)})

// melogic-camera-share-export-p4-v1
function cameraExportFile(){return cameraMessageCaptureFile()}
function saveCameraMediaToDevice(){
 const file=cameraExportFile();if(!file)return false
 let url=''
 try{url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name||`melogic-media-${Date.now()}`;a.rel='noopener';a.style.display='none';document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);return true}
 catch(error){if(url)URL.revokeObjectURL(url);console.warn('[camera] save failed',error);return false}
}
async function shareCameraMediaToSystem(){
 const file=cameraExportFile();if(!file)return false
 if(typeof navigator.share!=='function')return false
 if(typeof navigator.canShare==='function'&&!navigator.canShare({files:[file]}))return false
 try{await navigator.share({files:[file],title:'Melogic media'});return true}
 catch(error){if(error?.name!=='AbortError')console.warn('[camera] system share failed',error);return false}
}

// melogic-camera-share-publish-p2-v1
function handoffCameraMediaToCommunity(destination) {
  const blob=playback._melogicCapture
  if(!blob)return
  const type=playback.dataset.captureType||'video'
  const mime=String(blob.type||'')||(type==='photo'?'image/jpeg':'video/webm')
  const ext=mime.includes('png')?'png':mime.includes('webp')?'webp':mime.includes('jpeg')?'jpg':mime.includes('quicktime')?'mov':mime.includes('mp4')?'mp4':'webm'
  const file=blob instanceof File?blob:new File([blob],`melogic-${type}-${Date.now()}.${ext}`,{type:mime,lastModified:Date.now()})
  const createdAt=Date.now()
  window.__melogicCommunityMediaHandoff={destination,file,type,createdAt,...cameraSharePackage()}
  sessionStorage.setItem('melogicCommunityMediaHandoffDestination',destination)
  // melogic-mobile-story-direct-publish-v1
  // Hand ownership to Community through the persistent runtime. Never mutate
  // history manually here: that changed the URL without activating Community,
  // which left Camera visible and let the legacy Story composer surface later.
  if(isMobileSpaRuntime()){
    closeShareScreen()
    setCameraReviewBottomBar(false)
    void navigateMobileRuntimeUrl('/community',{
      historyMode:'push',
      source:destination==='story'?'camera-story-share':'camera-feed-share'
    }).then(opened=>{
      if(opened)return
      console.warn('[camera] Community runtime did not accept media handoff')
      setStatus('Could not open Community. Try again.')
      setCameraReviewBottomBar(true)
    })
    return
  }
  setStatus('Open Camera from the mobile app to post this media to Community.')
}
shareScreen?.addEventListener('click',event=>{
  const d=event.target.closest('[data-share-destination]')
  if(!d)return
  event.preventDefault()
  toggleCameraShareDestination(d)
})
// melogic-camera-share-orchestration-p4-v1
let cameraShareCommitting=false
async function commitCameraShareSelections(){
 if(cameraShareCommitting||!cameraShareSelections.size)return
 const selected=new Set(cameraShareSelections)
 if(selected.has('message')&&!cameraMessageSelectedThreadIds.size){messageState.hidden=false;messageState.textContent='Select at least one conversation before sharing.';messagePanel.hidden=false;messagePanel.scrollIntoView({behavior:'smooth',block:'nearest'});return}
 if(selected.has('message')&&cameraMessageSelectedThreadIds.size>1&&!['separate','group'].includes(cameraMessageDeliveryMode)){messageState.hidden=false;messageState.textContent='Choose Send Separately or Send as Group.';messagePanel.scrollIntoView({behavior:'smooth',block:'nearest'});return}
 cameraShareCommitting=true;shareCommitButton.disabled=true;shareCommitButton.textContent='Sharing…'
 const failures=[]
 try{
  if(selected.has('message')){
   const mode=cameraMessageSelectedThreadIds.size===1?'single':cameraMessageDeliveryMode
   if(!(await sendCameraMedia(mode)))failures.push('Messages')
  }
  if(selected.has('device')&&!saveCameraMediaToDevice())failures.push('Save to Device')
  if(selected.has('system')&&!(await shareCameraMediaToSystem()))failures.push('Share to Another App')
  if(failures.length){setStatus(`Could not complete: ${failures.join(', ')}.`);return}
  if(selected.has('feed')){handoffCameraMediaToCommunity('feed');return}
  if(selected.has('story')){handoffCameraMediaToCommunity('story');return}
  setStatus('Sharing complete.');window.setTimeout(()=>setStatus(''),1800)
 }catch(error){console.warn('[camera] multi-destination share failed',error);setStatus(error?.message||'Could not complete sharing.')}
 finally{cameraShareCommitting=false;if(cameraSurface.isConnected){shareCommitButton.textContent='Share';renderCameraShareSelections()}}
}
shareCommitButton?.addEventListener('click',()=>void commitCameraShareSelections())
window.addEventListener('resize',()=>{sizeLiveCanvas();if(!playback.hidden)sizeEditCanvas()},{passive:true})
window.addEventListener('orientationchange', () => requestAnimationFrame(sizeLiveCanvas), { passive: true })

function bindCameraDocumentLifecycleOnce() {
  if (cameraDocumentLifecycleBound) return
  cameraDocumentLifecycleBound = true
  window.addEventListener('pagehide', () => {
    stopCameraForInactiveView()
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=''}
  })
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
if ((location.pathname.replace(/\/+$/, '') || '/') === '/camera' ||
    (location.pathname.replace(/\/+$/, '') || '/') === '/camera.html') {
  if (app) app.replaceChildren(cameraSurface)
  void bootstrapCameraDocument()
}

// melogic-camera-share-p2-repair-v1 — verified P2 after original script post-write reporting failure.

// melogic-camera-share-final-cleanup-p5-v1
