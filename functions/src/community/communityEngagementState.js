function safeCount(value = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function canonicalCounter(record = {}, flatKey = '', nestedKey = '') {
  const flatValue = record?.[flatKey]
  if (flatValue !== undefined && flatValue !== null && Number.isFinite(Number(flatValue))) {
    return safeCount(flatValue)
  }
  return safeCount(record?.counts?.[nestedKey])
}

function desiredToggleState(current = false, requestedState = null) {
  return typeof requestedState === 'boolean' ? requestedState : !current
}

function reactionTransition({
  likeExists = false,
  dislikeExists = false,
  requestedReaction = 'like',
  requestedActive = null
} = {}) {
  const target = requestedReaction === 'dislike' ? 'dislike' : 'like'
  const targetExists = target === 'like' ? Boolean(likeExists) : Boolean(dislikeExists)
  let nextReaction = ''

  if (typeof requestedActive === 'boolean') {
    if (requestedActive) nextReaction = target
    else if (target === 'like' && dislikeExists) nextReaction = 'dislike'
    else if (target === 'dislike' && likeExists) nextReaction = 'like'
  } else if (!targetExists) {
    nextReaction = target
  }

  const liked = nextReaction === 'like'
  const disliked = nextReaction === 'dislike'
  return {
    reaction: nextReaction || null,
    liked,
    disliked,
    likeDelta: Number(liked) - Number(Boolean(likeExists)),
    dislikeDelta: Number(disliked) - Number(Boolean(dislikeExists))
  }
}

module.exports = {
  canonicalCounter,
  desiredToggleState,
  reactionTransition,
  safeCount
}
