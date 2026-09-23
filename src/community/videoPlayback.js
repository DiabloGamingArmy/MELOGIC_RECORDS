const VIDEO_SELECTOR = 'video[data-community-feed-video]'
const PLAY_THRESHOLD = 0.62
const STOP_THRESHOLD = 0.28
const OBSERVER_THRESHOLDS = [0, 0.2, STOP_THRESHOLD, 0.45, PLAY_THRESHOLD, 0.8, 1]
const DOUBLE_TAP_DELAY_MS = 280
const TAP_MAX_DURATION_MS = 650
const TAP_MOVE_TOLERANCE_PX = 14
const DOUBLE_TAP_DISTANCE_PX = 48
const AUTOPLAY_DWELL_MS = 130
const STALL_TIMEOUT_MS = 7000
const RELEASE_DELAY_MS = 8000
const RETRY_DELAYS_MS = [700, 2200, 5500]
const RETRY_PARAM = 'melogic_video_retry'

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function connectionIsConstrained() {
  const connection = globalThis.navigator?.connection || globalThis.navigator?.mozConnection || globalThis.navigator?.webkitConnection
  if (connection?.saveData) return true
  return /^(slow-)?2g$/i.test(String(connection?.effectiveType || ''))
}

function mediaViewportRoot(scope) {
  const main = scope?.querySelector?.('.community-main') || null
  if (!main || typeof getComputedStyle !== 'function') return null
  const overflowY = String(getComputedStyle(main).overflowY || '')
  return /auto|scroll|overlay/.test(overflowY) ? main : null
}

function viewportRect(root) {
  if (root?.getBoundingClientRect) return root.getBoundingClientRect()
  const width = Number(globalThis.innerWidth || document?.documentElement?.clientWidth || 0)
  const height = Number(globalThis.innerHeight || document?.documentElement?.clientHeight || 0)
  return { top: 0, left: 0, right: width, bottom: height, width, height }
}

function measuredIntersectionRatio(video, root) {
  const rect = video?.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0) return 0
  const bounds = viewportRect(root)
  const left = Math.max(rect.left, bounds.left)
  const right = Math.min(rect.right, bounds.right)
  const top = Math.max(rect.top, bounds.top)
  const bottom = Math.min(rect.bottom, bounds.bottom)
  if (right <= left || bottom <= top) return 0
  return clamp(((right - left) * (bottom - top)) / (rect.width * rect.height))
}

function centerDistance(video, root) {
  const rect = video?.getBoundingClientRect?.()
  if (!rect) return 1
  const bounds = viewportRect(root)
  const viewportCenter = bounds.top + (bounds.height / 2)
  const mediaCenter = rect.top + (rect.height / 2)
  return clamp(Math.abs(mediaCenter - viewportCenter) / Math.max(1, bounds.height / 2))
}

function configureInlineVideo(video, { resetMute = false } = {}) {
  if (!video) return
  video.controls = false
  video.removeAttribute('controls')
  video.autoplay = false
  video.removeAttribute('autoplay')
  video.loop = true
  video.setAttribute('loop', '')
  if (resetMute) {
    video.muted = true
    video.defaultMuted = true
    video.setAttribute('muted', '')
  }
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback')
  video.setAttribute('disablepictureinpicture', '')
  video.setAttribute('disableremoteplayback', '')
  try { video.disablePictureInPicture = true } catch {}
  try { video.disableRemotePlayback = true } catch {}
}

function cleanSource(source = '') {
  const value = String(source || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value, globalThis.location?.href)
    url.searchParams.delete(RETRY_PARAM)
    return url.href
  } catch {
    return value
  }
}

function retrySource(source = '', attempt = 0) {
  const value = cleanSource(source)
  if (!value || value.startsWith('blob:') || value.startsWith('data:')) return value
  try {
    const url = new URL(value, globalThis.location?.href)
    url.searchParams.set(RETRY_PARAM, String(Math.max(1, Number(attempt) || 1)))
    return url.href
  } catch {
    return value
  }
}

export function createCommunityFeedVideoCoordinator({ onDoubleLike = null } = {}) {
  let scope = null
  let observerRoot = null
  let observer = null
  let warmObserver = null
  let fallbackScrollTarget = null
  let activeVideo = null
  let suspended = false
  let evaluateFrame = 0
  let dwellTimer = 0
  let pendingWinner = null
  let pendingWinnerSince = 0

  const visibility = new Map()
  const warmVisibility = new Map()
  const bindings = new WeakMap()
  const userPaused = new WeakSet()
  const tapState = new WeakMap()
  const reliabilityState = new WeakMap()

  const shellFor = (video) => video?.closest?.('[data-community-video-shell]') || null

  function reliabilityFor(video) {
    let state = reliabilityState.get(video)
    if (!state) {
      state = {
        attempts: 0,
        generation: 0,
        stallTimer: 0,
        retryTimer: 0,
        releaseTimer: 0,
        resumeTime: Number(video?.dataset?.communityVideoResumeTime || 0) || 0,
        exhausted: false,
        intentionalRelease: false
      }
      reliabilityState.set(video, state)
    }
    return state
  }

  function clearTimer(id) {
    if (id) globalThis.clearTimeout(id)
  }

  function clearReliabilityTimers(video, { keepRelease = false } = {}) {
    const state = reliabilityFor(video)
    clearTimer(state.stallTimer)
    clearTimer(state.retryTimer)
    if (!keepRelease) clearTimer(state.releaseTimer)
    state.stallTimer = 0
    state.retryTimer = 0
    if (!keepRelease) state.releaseTimer = 0
  }

  function statusTextNode(video) {
    return shellFor(video)?.querySelector?.('[data-community-video-status-text]') || null
  }

  function tapStateFor(video) {
    let state = tapState.get(video)
    if (!state) {
      state = {
        pointerId: null,
        downX: 0,
        downY: 0,
        downAt: 0,
        lastTapAt: 0,
        lastTapX: 0,
        lastTapY: 0,
        singleTapTimer: 0,
        likeBurstTimer: 0
      }
      tapState.set(video, state)
    }
    return state
  }

  function syncControlState(video) {
    const shell = shellFor(video)
    if (!shell) return
    const paused = Boolean(video.paused || video.ended)
    const muted = Boolean(video.muted)
    const toggle = shell.querySelector('[data-community-video-toggle]')
    const mute = shell.querySelector('[data-community-video-mute]')
    shell.setAttribute('data-community-video-muted', muted ? 'true' : 'false')
    if (toggle) toggle.setAttribute('aria-label', paused ? 'Play video' : 'Pause video')
    if (mute) {
      mute.setAttribute('aria-label', muted ? 'Unmute video' : 'Mute video')
      mute.setAttribute('aria-pressed', muted ? 'true' : 'false')
      mute.setAttribute('data-muted', muted ? 'true' : 'false')
    }
  }

  function setVideoState(video, state, text = '') {
    const shell = shellFor(video)
    if (!shell) return
    shell.setAttribute('data-community-video-state', state)
    if (text) {
      const status = statusTextNode(video)
      if (status) status.textContent = text
    }
    syncControlState(video)
  }

  function setVideoMuted(video, muted) {
    if (!video) return
    video.muted = Boolean(muted)
    video.defaultMuted = Boolean(muted)
    if (muted) video.setAttribute('muted', '')
    else video.removeAttribute('muted')
    syncControlState(video)
  }

  function baseSourceFor(video) {
    const dataSource = video?.getAttribute?.('data-community-video-src') || ''
    const liveSource = video?.getAttribute?.('src') || video?.currentSrc || ''
    const source = cleanSource(dataSource || liveSource)
    if (source && source !== dataSource) video?.setAttribute?.('data-community-video-src', source)
    return source
  }

  function saveResumeTime(video) {
    if (!video) return
    const time = Number(video.currentTime)
    if (!Number.isFinite(time) || time < 0.05) return
    const state = reliabilityFor(video)
    state.resumeTime = time
    video.dataset.communityVideoResumeTime = String(time)
  }

  function restoreResumeTime(video) {
    const state = reliabilityFor(video)
    const time = Number(state.resumeTime || video?.dataset?.communityVideoResumeTime || 0)
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(Number(video.duration)) || Number(video.duration) <= 0) return
    const safe = Math.min(time, Math.max(0, Number(video.duration) - 0.1))
    if (safe <= 0) return
    try { video.currentTime = safe } catch {}
  }

  function sourceAttached(video) {
    return Boolean(video?.getAttribute?.('src') || video?.currentSrc)
  }

  function playbackBlockedByUi() {
    return Boolean(document.hidden || document.body?.classList?.contains('community-modal-open'))
  }

  function attachSource(video, { retryAttempt = 0 } = {}) {
    const source = baseSourceFor(video)
    if (!video || !source) {
      setVideoState(video, 'resolving', 'Loading video…')
      return false
    }
    const desired = retryAttempt > 0 ? retrySource(source, retryAttempt) : source
    if (video.getAttribute('src') === desired && sourceAttached(video)) return true

    const state = reliabilityFor(video)
    state.intentionalRelease = false
    state.generation += 1
    clearTimer(state.releaseTimer)
    state.releaseTimer = 0
    video.preload = 'metadata'
    video.setAttribute('preload', 'metadata')
    video.setAttribute('src', desired)
    setVideoState(video, retryAttempt > 0 ? 'retrying' : 'loading', retryAttempt > 0 ? 'Retrying video…' : 'Loading video…')
    try { video.load?.() } catch {}
    return true
  }

  function releaseSource(video, { force = false } = {}) {
    if (!video || (!force && video === activeVideo)) return
    const source = baseSourceFor(video)
    if (!sourceAttached(video) || !source) return
    saveResumeTime(video)
    const state = reliabilityFor(video)
    state.intentionalRelease = true
    try { video.pause?.() } catch {}
    video.removeAttribute('src')
    video.preload = 'none'
    video.setAttribute('preload', 'none')
    try { video.load?.() } catch {}
    if (video === activeVideo) activeVideo = null
    state.generation += 1
    clearReliabilityTimers(video)
    setVideoState(video, userPaused.has(video) ? 'paused' : 'idle')
    globalThis.setTimeout(() => {
      const current = reliabilityState.get(video)
      if (current) current.intentionalRelease = false
    }, 0)
  }

  function scheduleRelease(video) {
    if (!video || video === activeVideo) return
    const state = reliabilityFor(video)
    clearTimer(state.releaseTimer)
    state.releaseTimer = globalThis.setTimeout(() => {
      state.releaseTimer = 0
      if (warmVisibility.get(video) || video === activeVideo) return
      releaseSource(video)
    }, RELEASE_DELAY_MS)
  }

  function pauseVideo(video, state = 'paused') {
    if (!video) return
    saveResumeTime(video)
    try {
      if (!video.paused) video.pause()
    } catch {}
    if (video === activeVideo) activeVideo = null
    setVideoState(video, video.ended ? 'ended' : state)
  }

  function pauseAll(except = null) {
    for (const video of visibility.keys()) {
      if (video === except) continue
      pauseVideo(video)
    }
    if (activeVideo && activeVideo !== except && !visibility.has(activeVideo)) pauseVideo(activeVideo)
    if (!except) activeVideo = null
  }

  function resetRecovery(video) {
    const state = reliabilityFor(video)
    clearTimer(state.stallTimer)
    clearTimer(state.retryTimer)
    state.stallTimer = 0
    state.retryTimer = 0
    state.attempts = 0
    state.exhausted = false
  }

  function armStallWatch(video) {
    if (!video || video.paused || video.ended) return
    const state = reliabilityFor(video)
    clearTimer(state.stallTimer)
    const generation = state.generation
    state.stallTimer = globalThis.setTimeout(() => {
      state.stallTimer = 0
      if (generation !== state.generation || video.paused || video.ended) return
      recoverVideo(video, { reason: 'stall' })
    }, STALL_TIMEOUT_MS)
  }

  function recoverVideo(video, { manual = false, reason = 'error' } = {}) {
    if (!video) return
    const state = reliabilityFor(video)
    if (state.retryTimer || state.intentionalRelease) return

    if (!manual && video !== activeVideo && !warmVisibility.get(video)) {
      setVideoState(video, userPaused.has(video) ? 'paused' : 'idle')
      return
    }

    if (!globalThis.navigator?.onLine) {
      state.exhausted = true
      setVideoState(video, 'error', 'Waiting for connection…')
      return
    }

    if (manual) {
      state.attempts = 0
      state.exhausted = false
    }

    if (state.attempts >= RETRY_DELAYS_MS.length) {
      state.exhausted = true
      setVideoState(video, 'error', 'Video is taking longer than expected.')
      return
    }

    saveResumeTime(video)
    const attempt = state.attempts + 1
    state.attempts = attempt
    state.generation += 1
    const generation = state.generation
    const delay = manual ? 0 : RETRY_DELAYS_MS[attempt - 1]
    setVideoState(video, 'retrying', reason === 'stall' ? 'Reconnecting video…' : 'Retrying video…')

    state.retryTimer = globalThis.setTimeout(() => {
      state.retryTimer = 0
      if (generation !== state.generation) return
      video.removeAttribute('src')
      try { video.load?.() } catch {}
      attachSource(video, { retryAttempt: attempt })
    }, delay)
  }

  function onNativePlay(video) {
    userPaused.delete(video)
    pauseAll(video)
    activeVideo = video
    resetRecovery(video)
    setVideoState(video, 'playing')
  }

  function triggerLikeBurst(video) {
    const shell = shellFor(video)
    if (!shell) return
    const taps = tapStateFor(video)
    if (taps.likeBurstTimer) globalThis.clearTimeout(taps.likeBurstTimer)
    shell.classList.remove('is-video-like-bursting')
    void shell.offsetWidth
    shell.classList.add('is-video-like-bursting')
    taps.likeBurstTimer = globalThis.setTimeout(() => {
      shell.classList.remove('is-video-like-bursting')
      taps.likeBurstTimer = 0
    }, 620)
  }

  function requestPlayback(video) {
    if (!video || suspended || playbackBlockedByUi() || userPaused.has(video)) return
    if (!sourceAttached(video) && !attachSource(video)) return
    if (activeVideo && activeVideo !== video) pauseVideo(activeVideo)
    activeVideo = video
    configureInlineVideo(video, { resetMute: false })
    if (video.readyState < 2) setVideoState(video, 'loading', 'Loading video…')
    let playResult
    try {
      playResult = video.play()
    } catch {
      playResult = null
    }
    if (playResult?.catch) {
      playResult.catch(() => {
        if (activeVideo === video) activeVideo = null
        setVideoState(video, 'blocked', 'Tap to play')
      })
    }
  }

  function handleSingleTap(video) {
    if (!video || suspended) return
    if (video.paused || video.ended) {
      if (video.ended) {
        reliabilityFor(video).resumeTime = 0
        video.dataset.communityVideoResumeTime = ''
        try { video.currentTime = 0 } catch {}
      }
      userPaused.delete(video)
      setVideoMuted(video, false)
      attachSource(video)
      requestPlayback(video)
      return
    }

    userPaused.add(video)
    pauseVideo(video, 'paused')
    setVideoMuted(video, false)
  }

  function handleDoubleTap(video) {
    if (!video) return
    const postId = String(video.closest?.('.community-post-card[data-post-id]')?.getAttribute('data-post-id') || '').trim()
    if (!postId) return
    triggerLikeBurst(video)
    if (typeof onDoubleLike === 'function') {
      try {
        Promise.resolve(onDoubleLike(postId)).catch(() => null)
      } catch {}
    }
  }

  function distance(x1, y1, x2, y2) {
    return Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1))
  }

  function commitTap(video, x, y) {
    const taps = tapStateFor(video)
    const now = nowMs()
    const isDouble = taps.lastTapAt > 0
      && now - taps.lastTapAt <= DOUBLE_TAP_DELAY_MS
      && distance(taps.lastTapX, taps.lastTapY, x, y) <= DOUBLE_TAP_DISTANCE_PX

    if (isDouble) {
      if (taps.singleTapTimer) globalThis.clearTimeout(taps.singleTapTimer)
      taps.singleTapTimer = 0
      taps.lastTapAt = 0
      handleDoubleTap(video)
      return
    }

    if (taps.singleTapTimer) globalThis.clearTimeout(taps.singleTapTimer)
    taps.lastTapAt = now
    taps.lastTapX = x
    taps.lastTapY = y
    taps.singleTapTimer = globalThis.setTimeout(() => {
      taps.singleTapTimer = 0
      taps.lastTapAt = 0
      handleSingleTap(video)
    }, DOUBLE_TAP_DELAY_MS)
  }

  function bindVideo(video) {
    if (!video || bindings.has(video)) return
    const firstRegistration = video.dataset.communityVideoInitialized !== 'true'
    configureInlineVideo(video, { resetMute: firstRegistration })
    video.dataset.communityVideoInitialized = 'true'
    const existingSource = cleanSource(video.getAttribute('data-community-video-src') || video.getAttribute('src') || '')
    if (existingSource) video.setAttribute('data-community-video-src', existingSource)
    if (video.hasAttribute('src')) {
      video.removeAttribute('src')
      video.preload = 'none'
      video.setAttribute('preload', 'none')
      try { video.load?.() } catch {}
    }

    const shell = shellFor(video)
    const hitTarget = shell?.querySelector('[data-community-video-toggle]') || null
    const muteButton = shell?.querySelector('[data-community-video-mute]') || null
    const retryButton = shell?.querySelector('[data-community-video-retry]') || null
    const cleanups = []
    const listen = (target, type, handler, options) => {
      if (!target?.addEventListener) return
      target.addEventListener(type, handler, options)
      cleanups.push(() => target.removeEventListener(type, handler, options))
    }

    listen(video, 'play', () => onNativePlay(video))
    listen(video, 'pause', () => {
      const state = reliabilityFor(video)
      clearTimer(state.stallTimer)
      state.stallTimer = 0
      if (video === activeVideo && video.paused) activeVideo = null
      if (!video.ended) setVideoState(video, 'paused')
    })
    listen(video, 'ended', () => {
      clearReliabilityTimers(video, { keepRelease: true })
      reliabilityFor(video).resumeTime = 0
      video.dataset.communityVideoResumeTime = ''
      // Native loop should normally prevent "ended", but keep a fallback for
      // browsers/WebViews that still emit it around source/recovery changes.
      if (video.loop && !userPaused.has(video) && !playbackBlockedByUi() && ratioFor(video) >= STOP_THRESHOLD) {
        try { video.currentTime = 0 } catch {}
        requestPlayback(video)
        return
      }
      if (video === activeVideo) activeVideo = null
      setVideoState(video, 'ended')
    })
    listen(video, 'loadstart', () => setVideoState(video, 'loading', 'Loading video…'))
    listen(video, 'loadedmetadata', () => {
      restoreResumeTime(video)
      scheduleEvaluate()
    })
    listen(video, 'loadeddata', () => {
      if (video !== activeVideo && !userPaused.has(video)) setVideoState(video, 'idle')
    })
    listen(video, 'canplay', () => {
      const state = reliabilityFor(video)
      clearTimer(state.stallTimer)
      state.stallTimer = 0
      restoreResumeTime(video)
      if (video !== activeVideo) setVideoState(video, userPaused.has(video) ? 'paused' : 'idle')
      scheduleEvaluate()
    })
    listen(video, 'playing', () => {
      resetRecovery(video)
      setVideoState(video, 'playing')
    })
    listen(video, 'waiting', () => {
      setVideoState(video, 'loading', 'Loading video…')
      armStallWatch(video)
    })
    listen(video, 'stalled', () => {
      setVideoState(video, 'loading', 'Reconnecting video…')
      armStallWatch(video)
    })
    listen(video, 'suspend', () => {
      if (video === activeVideo && video.readyState < 3) armStallWatch(video)
    })
    listen(video, 'error', () => {
      const state = reliabilityFor(video)
      if (state.intentionalRelease || !video.hasAttribute('src')) {
        if (video === activeVideo) activeVideo = null
        setVideoState(video, userPaused.has(video) ? 'paused' : 'idle')
        return
      }
      if (video === activeVideo) activeVideo = null
      recoverVideo(video, { reason: 'error' })
    })
    listen(video, 'timeupdate', () => {
      const state = reliabilityFor(video)
      const time = Number(video.currentTime)
      if (Number.isFinite(time) && time > 0) {
        state.resumeTime = time
        video.dataset.communityVideoResumeTime = String(time)
      }
    })
    listen(video, 'volumechange', () => syncControlState(video))

    if (hitTarget) {
      listen(hitTarget, 'pointerdown', (event) => {
        if (event.isPrimary === false || (Number.isFinite(event.button) && event.button !== 0)) return
        const taps = tapStateFor(video)
        taps.pointerId = event.pointerId
        taps.downX = event.clientX
        taps.downY = event.clientY
        taps.downAt = nowMs()
      })
      listen(hitTarget, 'pointerup', (event) => {
        const taps = tapStateFor(video)
        if (taps.pointerId !== event.pointerId) return
        const duration = nowMs() - taps.downAt
        const moved = distance(taps.downX, taps.downY, event.clientX, event.clientY)
        taps.pointerId = null
        event.preventDefault()
        event.stopPropagation()
        if (moved > TAP_MOVE_TOLERANCE_PX || duration > TAP_MAX_DURATION_MS) return
        commitTap(video, event.clientX, event.clientY)
      })
      listen(hitTarget, 'pointercancel', () => {
        tapStateFor(video).pointerId = null
      })
      listen(hitTarget, 'click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (event.detail === 0) handleSingleTap(video)
      })
    }

    if (muteButton) {
      listen(muteButton, 'pointerdown', (event) => event.stopPropagation())
      listen(muteButton, 'click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setVideoMuted(video, !video.muted)
      })
    }

    if (retryButton) {
      listen(retryButton, 'pointerdown', (event) => event.stopPropagation())
      listen(retryButton, 'click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        recoverVideo(video, { manual: true, reason: 'manual' })
      })
    }

    bindings.set(video, cleanups)
    setVideoState(video, existingSource ? 'idle' : 'resolving', existingSource ? '' : 'Loading video…')
  }

  function unbindVideo(video) {
    const cleanups = bindings.get(video)
    if (cleanups) cleanups.forEach((cleanup) => cleanup())
    bindings.delete(video)
    visibility.delete(video)
    warmVisibility.delete(video)
    userPaused.delete(video)
    const taps = tapState.get(video)
    if (taps?.singleTapTimer) globalThis.clearTimeout(taps.singleTapTimer)
    if (taps?.likeBurstTimer) globalThis.clearTimeout(taps.likeBurstTimer)
    tapState.delete(video)
    clearReliabilityTimers(video)
    try { observer?.unobserve(video) } catch {}
    try { warmObserver?.unobserve(video) } catch {}
    releaseSource(video, { force: true })
    reliabilityState.delete(video)
  }

  function ratioFor(video) {
    const observed = visibility.get(video)
    if (observer && Number.isFinite(observed)) return clamp(observed)
    return measuredIntersectionRatio(video, observerRoot)
  }

  function scoreVideo(video) {
    return ratioFor(video) * 10 - centerDistance(video, observerRoot)
  }

  function chooseWinner(videos) {
    const eligible = videos.filter((video) => {
      const state = reliabilityFor(video)
      return ratioFor(video) >= PLAY_THRESHOLD
        && !video.ended
        && !userPaused.has(video)
        && !state.exhausted
    })
    if (!eligible.length) {
      if (activeVideo && videos.includes(activeVideo) && ratioFor(activeVideo) > STOP_THRESHOLD && !activeVideo.ended && !userPaused.has(activeVideo)) {
        return activeVideo
      }
      return null
    }
    eligible.sort((a, b) => scoreVideo(b) - scoreVideo(a))
    const best = eligible[0]
    if (activeVideo && eligible.includes(activeVideo) && scoreVideo(activeVideo) >= scoreVideo(best) - 0.2) {
      return activeVideo
    }
    return best
  }

  function clearDwell() {
    if (dwellTimer) globalThis.clearTimeout(dwellTimer)
    dwellTimer = 0
    pendingWinner = null
    pendingWinnerSince = 0
  }

  function scheduleWinnerAfterDwell(video) {
    if (!video) {
      clearDwell()
      return
    }
    if (pendingWinner !== video) {
      clearDwell()
      pendingWinner = video
      pendingWinnerSince = nowMs()
    }
    const remaining = Math.max(0, AUTOPLAY_DWELL_MS - (nowMs() - pendingWinnerSince))
    if (remaining <= 0) {
      clearDwell()
      requestPlayback(video)
      return
    }
    if (dwellTimer) return
    dwellTimer = globalThis.setTimeout(() => {
      dwellTimer = 0
      scheduleEvaluate()
    }, remaining)
  }

  function evaluate() {
    evaluateFrame = 0
    if (suspended || playbackBlockedByUi()) {
      clearDwell()
      pauseAll()
      return
    }
    const videos = Array.from(visibility.keys()).filter((video) => video.isConnected && scope?.contains?.(video))
    if (!videos.length) {
      clearDwell()
      activeVideo = null
      return
    }

    if (!observer) {
      videos.forEach((video) => {
        const ratio = measuredIntersectionRatio(video, observerRoot)
        visibility.set(video, ratio)
        if (ratio <= STOP_THRESHOLD) userPaused.delete(video)
      })
    }

    const winner = chooseWinner(videos)
    if (!winner) {
      clearDwell()
      if (activeVideo && ratioFor(activeVideo) <= STOP_THRESHOLD) pauseVideo(activeVideo)
      return
    }

    attachSource(winner)

    if (winner === activeVideo && !winner.paused) {
      clearDwell()
      return
    }

    if (activeVideo && activeVideo !== winner && ratioFor(activeVideo) <= STOP_THRESHOLD) {
      pauseVideo(activeVideo)
    }

    scheduleWinnerAfterDwell(winner)
  }

  function scheduleEvaluate() {
    if (evaluateFrame || suspended) return
    const raf = globalThis.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 16))
    evaluateFrame = raf(evaluate)
  }

  function clearObservation() {
    observer?.disconnect?.()
    warmObserver?.disconnect?.()
    observer = null
    warmObserver = null
    if (fallbackScrollTarget) {
      fallbackScrollTarget.removeEventListener?.('scroll', scheduleEvaluate)
      fallbackScrollTarget = null
    }
    globalThis.removeEventListener?.('resize', scheduleEvaluate)
  }

  function rebuildObservation() {
    clearObservation()
    if (suspended || !scope) return
    observerRoot = mediaViewportRoot(scope)
    const videos = Array.from(visibility.keys()).filter((video) => video.isConnected && scope.contains(video))

    if ('IntersectionObserver' in globalThis) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const ratio = entry.isIntersecting ? entry.intersectionRatio : 0
          visibility.set(entry.target, ratio)
          if (ratio <= STOP_THRESHOLD) userPaused.delete(entry.target)
        })
        scheduleEvaluate()
      }, {
        root: observerRoot,
        threshold: OBSERVER_THRESHOLDS
      })

      const rootMargin = connectionIsConstrained() ? '45% 0px' : '150% 0px'
      warmObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const video = entry.target
          const warm = Boolean(entry.isIntersecting)
          warmVisibility.set(video, warm)
          const state = reliabilityFor(video)
          if (warm) {
            clearTimer(state.releaseTimer)
            state.releaseTimer = 0
            attachSource(video)
          } else {
            scheduleRelease(video)
          }
        })
      }, {
        root: observerRoot,
        rootMargin,
        threshold: 0
      })

      videos.forEach((video) => {
        observer.observe(video)
        warmObserver.observe(video)
      })
    } else {
      fallbackScrollTarget = observerRoot || globalThis
      fallbackScrollTarget.addEventListener?.('scroll', scheduleEvaluate, { passive: true })
      globalThis.addEventListener?.('resize', scheduleEvaluate, { passive: true })
      videos.forEach((video) => {
        const ratio = measuredIntersectionRatio(video, observerRoot)
        visibility.set(video, ratio)
        const warm = ratio > 0
        warmVisibility.set(video, warm)
        if (warm) attachSource(video)
        else scheduleRelease(video)
      })
    }
    scheduleEvaluate()
  }

  function sync(nextScope = scope) {
    if (!nextScope?.querySelectorAll) return
    scope = nextScope
    const current = new Set(scope.querySelectorAll(VIDEO_SELECTOR))
    for (const video of Array.from(visibility.keys())) {
      if (!current.has(video)) unbindVideo(video)
    }
    current.forEach((video) => {
      bindVideo(video)
      if (!visibility.has(video)) visibility.set(video, 0)
      if (!warmVisibility.has(video)) warmVisibility.set(video, false)
    })
    rebuildObservation()
  }

  function suspend() {
    suspended = true
    clearDwell()
    if (evaluateFrame) {
      const cancel = globalThis.cancelAnimationFrame || globalThis.clearTimeout
      cancel?.(evaluateFrame)
      evaluateFrame = 0
    }
    clearObservation()
    pauseAll()
    for (const video of visibility.keys()) releaseSource(video, { force: true })
  }

  function resume(nextScope = scope) {
    suspended = false
    if (nextScope?.querySelectorAll) sync(nextScope)
    else rebuildObservation()
    scheduleEvaluate()
  }

  function handleVisibilityChange() {
    if (playbackBlockedByUi()) {
      clearDwell()
      pauseAll()
    } else {
      scheduleEvaluate()
    }
  }

  function handleCommunityUiMutation() {
    if (playbackBlockedByUi()) {
      clearDwell()
      pauseAll()
    } else {
      scheduleEvaluate()
    }
  }

  function handleVolumeKey(event) {
    const key = String(event?.key || '')
    if (key !== 'AudioVolumeUp' && key !== 'VolumeUp') return
    if (!activeVideo || playbackBlockedByUi() || !activeVideo.muted) return
    setVideoMuted(activeVideo, false)
  }

  function pauseWithin(nextScope = scope) {
    clearDwell()
    const videos = nextScope?.querySelectorAll
      ? Array.from(nextScope.querySelectorAll(VIDEO_SELECTOR))
      : Array.from(visibility.keys())
    videos.forEach((video) => pauseVideo(video))
  }

  function handleOnline() {
    for (const video of visibility.keys()) {
      const state = reliabilityFor(video)
      if (!state.exhausted || !warmVisibility.get(video)) continue
      recoverVideo(video, { manual: true, reason: 'online' })
    }
  }

  function handlePageHide() {
    clearDwell()
    pauseAll()
    for (const video of visibility.keys()) releaseSource(video, { force: true })
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('keydown', handleVolumeKey, { capture: true })
  const uiMutationObserver = typeof MutationObserver !== 'undefined' && document.body
    ? new MutationObserver(handleCommunityUiMutation)
    : null
  uiMutationObserver?.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  globalThis.addEventListener?.('online', handleOnline)
  globalThis.addEventListener?.('pagehide', handlePageHide)
  globalThis.addEventListener?.('pageshow', () => {
    suspended = false
    rebuildObservation()
    scheduleEvaluate()
  })

  return {
    sync,
    suspend,
    resume,
    pause: pauseWithin,
    get activeVideo() { return activeVideo }
  }
}
