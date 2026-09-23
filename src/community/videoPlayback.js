const VIDEO_SELECTOR = 'video[data-community-feed-video]'
const PLAY_THRESHOLD = 0.62
const STOP_THRESHOLD = 0.28
const OBSERVER_THRESHOLDS = [0, 0.2, STOP_THRESHOLD, 0.45, PLAY_THRESHOLD, 0.8, 1]

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

function configureInlineVideo(video) {
  if (!video) return
  video.controls = false
  video.removeAttribute('controls')
  video.autoplay = false
  video.removeAttribute('autoplay')
  video.muted = true
  video.defaultMuted = true
  video.setAttribute('muted', '')
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

export function createCommunityFeedVideoCoordinator() {
  let scope = null
  let observerRoot = null
  let observer = null
  let fallbackScrollTarget = null
  let activeVideo = null
  let suspended = false
  let evaluateFrame = 0
  const visibility = new Map()
  const bindings = new WeakMap()

  const shellFor = (video) => video?.closest?.('[data-community-video-shell]') || null

  function setVideoState(video, state, statusText = '') {
    const shell = shellFor(video)
    if (!shell) return
    shell.setAttribute('data-community-video-state', state)
    const status = shell.querySelector('[data-community-video-load-state]')
    if (status && statusText) status.textContent = statusText
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
    if (!except) activeVideo = null
  }

  function onNativePlay(video) {
    pauseAll(video)
    activeVideo = video
    setVideoState(video, 'playing')
  }

  function bindVideo(video) {
    if (!video || bindings.has(video)) return
    configureInlineVideo(video)
    const handlers = {
      play: () => onNativePlay(video),
      pause: () => {
        if (video === activeVideo && video.paused) activeVideo = null
        if (!video.ended) setVideoState(video, 'paused')
      },
      ended: () => {
        if (video === activeVideo) activeVideo = null
        setVideoState(video, 'ended')
      },
      loadstart: () => setVideoState(video, 'loading', 'Loading video…'),
      waiting: () => setVideoState(video, 'loading', 'Loading video…'),
      canplay: () => {
        if (video !== activeVideo) setVideoState(video, 'idle')
        scheduleEvaluate()
      },
      loadedmetadata: () => scheduleEvaluate(),
      error: () => {
        if (video === activeVideo) activeVideo = null
        setVideoState(video, 'error', 'Video unavailable')
      }
    }
    Object.entries(handlers).forEach(([type, handler]) => video.addEventListener(type, handler))
    bindings.set(video, handlers)
  }

  function unbindVideo(video) {
    const handlers = bindings.get(video)
    if (handlers) Object.entries(handlers).forEach(([type, handler]) => video.removeEventListener(type, handler))
    bindings.delete(video)
    visibility.delete(video)
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
    const eligible = videos.filter((video) => ratioFor(video) >= PLAY_THRESHOLD && !video.error)
    if (!eligible.length) {
      if (activeVideo && videos.includes(activeVideo) && ratioFor(activeVideo) > STOP_THRESHOLD && !activeVideo.ended) {
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

  function requestPlayback(video) {
    if (!video || suspended || document.hidden) return
    if (!video.getAttribute('src') && !video.currentSrc) {
      setVideoState(video, 'resolving', 'Loading video…')
      return
    }
    if (activeVideo && activeVideo !== video) pauseVideo(activeVideo)
    activeVideo = video
    configureInlineVideo(video)
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
    if (!observer) videos.forEach((video) => visibility.set(video, measuredIntersectionRatio(video, observerRoot)))
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
        entries.forEach((entry) => visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0))
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
