const VIDEO_SELECTOR = 'video[data-community-feed-video]'
const PLAY_THRESHOLD = 0.62
const STOP_THRESHOLD = 0.28
const OBSERVER_THRESHOLDS = [0, 0.2, STOP_THRESHOLD, 0.45, PLAY_THRESHOLD, 0.8, 1]
const DOUBLE_TAP_DELAY_MS = 280
const TAP_MAX_DURATION_MS = 650
const TAP_MOVE_TOLERANCE_PX = 14
const DOUBLE_TAP_DISTANCE_PX = 48

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0))
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
  if (resetMute) {
    video.muted = true
    video.defaultMuted = true
    video.setAttribute('muted', '')
  }
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = video.preload || 'metadata'
  video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback')
  video.setAttribute('disablepictureinpicture', '')
  video.setAttribute('disableremoteplayback', '')
  try { video.disablePictureInPicture = true } catch {}
  try { video.disableRemotePlayback = true } catch {}
}

export function createCommunityFeedVideoCoordinator({ onDoubleLike = null } = {}) {
  let scope = null
  let observerRoot = null
  let observer = null
  let fallbackScrollTarget = null
  let activeVideo = null
  let suspended = false
  let evaluateFrame = 0
  const visibility = new Map()
  const bindings = new WeakMap()
  const userPaused = new WeakSet()
  const tapState = new WeakMap()

  const shellFor = (video) => video?.closest?.('[data-community-video-shell]') || null

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

  function setVideoState(video, state, statusText = '') {
    const shell = shellFor(video)
    if (!shell) return
    shell.setAttribute('data-community-video-state', state)
    const status = shell.querySelector('[data-community-video-load-state]')
    if (status && statusText) status.textContent = statusText
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

  function pauseVideo(video, state = 'paused') {
    if (!video) return
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

  function onNativePlay(video) {
    userPaused.delete(video)
    pauseAll(video)
    activeVideo = video
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
    if (!video || suspended || document.hidden || userPaused.has(video)) return
    if (!video.getAttribute('src') && !video.currentSrc) {
      setVideoState(video, 'resolving', 'Loading video…')
      return
    }
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
        try { video.currentTime = 0 } catch {}
      }
      userPaused.delete(video)
      setVideoMuted(video, false)
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
    const now = globalThis.performance?.now?.() ?? Date.now()
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
    configureInlineVideo(video, { resetMute: true })
    const shell = shellFor(video)
    const hitTarget = shell?.querySelector('[data-community-video-toggle]') || null
    const muteButton = shell?.querySelector('[data-community-video-mute]') || null
    const cleanups = []
    const listen = (target, type, handler, options) => {
      if (!target?.addEventListener) return
      target.addEventListener(type, handler, options)
      cleanups.push(() => target.removeEventListener(type, handler, options))
    }

    listen(video, 'play', () => onNativePlay(video))
    listen(video, 'pause', () => {
      if (video === activeVideo && video.paused) activeVideo = null
      if (!video.ended) setVideoState(video, 'paused')
    })
    listen(video, 'ended', () => {
      if (video === activeVideo) activeVideo = null
      setVideoState(video, 'ended')
    })
    listen(video, 'loadstart', () => setVideoState(video, 'loading', 'Loading video…'))
    listen(video, 'waiting', () => setVideoState(video, 'loading', 'Loading video…'))
    listen(video, 'canplay', () => {
      if (video !== activeVideo) setVideoState(video, video.paused ? 'paused' : 'idle')
      scheduleEvaluate()
    })
    listen(video, 'loadedmetadata', () => scheduleEvaluate())
    listen(video, 'error', () => {
      if (video === activeVideo) activeVideo = null
      setVideoState(video, 'error', 'Video unavailable')
    })
    listen(video, 'volumechange', () => syncControlState(video))

    if (hitTarget) {
      listen(hitTarget, 'pointerdown', (event) => {
        if (event.isPrimary === false || (Number.isFinite(event.button) && event.button !== 0)) return
        const taps = tapStateFor(video)
        taps.pointerId = event.pointerId
        taps.downX = event.clientX
        taps.downY = event.clientY
        taps.downAt = globalThis.performance?.now?.() ?? Date.now()
      })
      listen(hitTarget, 'pointerup', (event) => {
        const taps = tapStateFor(video)
        if (taps.pointerId !== event.pointerId) return
        const now = globalThis.performance?.now?.() ?? Date.now()
        const moved = distance(taps.downX, taps.downY, event.clientX, event.clientY)
        const duration = now - taps.downAt
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

    bindings.set(video, cleanups)
    setVideoState(video, 'idle')
  }

  function unbindVideo(video) {
    const cleanups = bindings.get(video)
    if (cleanups) cleanups.forEach((cleanup) => cleanup())
    bindings.delete(video)
    visibility.delete(video)
    userPaused.delete(video)
    const taps = tapState.get(video)
    if (taps?.singleTapTimer) globalThis.clearTimeout(taps.singleTapTimer)
    if (taps?.likeBurstTimer) globalThis.clearTimeout(taps.likeBurstTimer)
    tapState.delete(video)
    try { observer?.unobserve(video) } catch {}
    pauseVideo(video)
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
    const eligible = videos.filter((video) => ratioFor(video) >= PLAY_THRESHOLD && !video.error && !video.ended && !userPaused.has(video))
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

  function evaluate() {
    evaluateFrame = 0
    if (suspended || document.hidden) {
      pauseAll()
      return
    }
    const videos = Array.from(visibility.keys()).filter((video) => video.isConnected && scope?.contains?.(video))
    if (!videos.length) {
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
      if (activeVideo) pauseVideo(activeVideo)
      return
    }
    if (activeVideo && activeVideo !== winner) pauseVideo(activeVideo)
    if (winner.paused && !winner.ended) requestPlayback(winner)
  }

  function scheduleEvaluate() {
    if (evaluateFrame || suspended) return
    const raf = globalThis.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 16))
    evaluateFrame = raf(evaluate)
  }

  function clearObservation() {
    observer?.disconnect?.()
    observer = null
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
      videos.forEach((video) => observer.observe(video))
    } else {
      fallbackScrollTarget = observerRoot || globalThis
      fallbackScrollTarget.addEventListener?.('scroll', scheduleEvaluate, { passive: true })
      globalThis.addEventListener?.('resize', scheduleEvaluate, { passive: true })
      videos.forEach((video) => visibility.set(video, measuredIntersectionRatio(video, observerRoot)))
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
    })
    rebuildObservation()
  }

  function suspend() {
    suspended = true
    if (evaluateFrame) {
      const cancel = globalThis.cancelAnimationFrame || globalThis.clearTimeout
      cancel?.(evaluateFrame)
      evaluateFrame = 0
    }
    clearObservation()
    pauseAll()
  }

  function resume(nextScope = scope) {
    suspended = false
    if (nextScope?.querySelectorAll) sync(nextScope)
    else rebuildObservation()
    scheduleEvaluate()
  }

  function handleVisibilityChange() {
    if (document.hidden) pauseAll()
    else scheduleEvaluate()
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  globalThis.addEventListener?.('pagehide', () => pauseAll())
  globalThis.addEventListener?.('pageshow', () => scheduleEvaluate())

  return {
    sync,
    suspend,
    resume,
    get activeVideo() { return activeVideo }
  }
}
