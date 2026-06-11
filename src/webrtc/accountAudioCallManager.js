import {
  addCalleeIceCandidate,
  addCallerIceCandidate,
  failAccountCall,
  saveCallAnswer,
  saveCallOffer,
  updateAccountCallStatus,
  watchAccountCall,
  watchCalleeIceCandidates,
  watchCallerIceCandidates
} from '../data/accountCallService'

export const ACCOUNT_CALL_DEBUG = false

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

function debug(...args) {
  if (ACCOUNT_CALL_DEBUG) console.info('[account-call]', ...args)
}

function callErrorMessage(error) {
  const name = String(error?.name || '')
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone access is required to start an audio call.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found for this call.'
  }
  return error?.message || 'Call failed to connect. This network may require TURN support.'
}

export class AccountAudioCallManager {
  constructor({ onStateChange, onRemoteStream, onError } = {}) {
    this.state = 'idle'
    this.callId = ''
    this.role = ''
    this.peerConnection = null
    this.localStream = null
    this.remoteStream = null
    this.muted = false
    this.unsubscribers = []
    this.seenCandidateIds = new Set()
    this.onStateChange = onStateChange || (() => {})
    this.onRemoteStream = onRemoteStream || (() => {})
    this.onError = onError || (() => {})
  }

  setState(state, detail = {}) {
    this.state = state
    debug('state', state, detail)
    this.onStateChange({ state, muted: this.muted, callId: this.callId, ...detail })
  }

  assertSupported() {
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      throw new Error('Audio calling requires a secure HTTPS connection.')
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('This browser does not support WebRTC audio calling.')
    }
  }

  async requestMicrophone() {
    this.assertSupported()
    this.setState('requesting-mic')
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      })
      debug('microphone granted')
      return this.localStream
    } catch (error) {
      debug('microphone failed', error?.name, error?.message)
      throw new Error(callErrorMessage(error))
    }
  }

  createPeerConnection(callId, role) {
    this.callId = callId
    this.role = role
    this.peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.remoteStream = new MediaStream()
    this.localStream.getTracks().forEach((track) => this.peerConnection.addTrack(track, this.localStream))

    this.peerConnection.addEventListener('track', (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        if (!this.remoteStream.getTracks().some((item) => item.id === track.id)) this.remoteStream.addTrack(track)
      })
      this.onRemoteStream(this.remoteStream)
    })
    this.peerConnection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return
      const writer = role === 'caller' ? addCallerIceCandidate : addCalleeIceCandidate
      writer(callId, event.candidate).then(() => debug('ICE candidate added', role)).catch((error) => this.handleError(error))
    })
    this.peerConnection.addEventListener('connectionstatechange', () => {
      const connectionState = this.peerConnection?.connectionState || ''
      debug('peer connection state', connectionState)
      if (connectionState === 'connected') {
        this.setState('active')
        updateAccountCallStatus(callId, 'active', { connectedAt: new Date() }).catch((error) => debug('active status failed', error))
      } else if (['failed', 'disconnected'].includes(connectionState)) {
        this.setState('failed', { error: 'Call failed to connect. This network may require TURN support.' })
      } else if (connectionState === 'connecting') {
        this.setState('connecting')
      }
    })

    // TURN server support should be added later for networks where direct peer-to-peer WebRTC fails.
    return this.peerConnection
  }

  watchRemoteCandidates(callId, role) {
    const watcher = role === 'caller' ? watchCalleeIceCandidates : watchCallerIceCandidates
    const unsubscribe = watcher(callId, async (candidate) => {
      if (!candidate?.id || this.seenCandidateIds.has(candidate.id) || !candidate.candidate) return
      this.seenCandidateIds.add(candidate.id)
      try {
        await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (error) {
        this.handleError(error)
      }
    }, (error) => this.handleError(error))
    this.unsubscribers.push(unsubscribe)
  }

  watchCallDocument(callId, role) {
    const unsubscribe = watchAccountCall(callId, async (call) => {
      if (!call) return
      if (role === 'caller' && call.answer?.sdp && !this.peerConnection?.remoteDescription) {
        await this.peerConnection.setRemoteDescription(call.answer)
        this.setState('connecting')
      }
      if (['ended', 'declined', 'missed', 'failed', 'cancelled'].includes(call.status)) {
        this.setState(call.status === 'failed' ? 'failed' : 'ended', { call })
        this.cleanup({ preserveState: true })
      }
    }, (error) => this.handleError(error))
    this.unsubscribers.push(unsubscribe)
  }

  async startCaller(call) {
    try {
      await this.requestMicrophone()
      this.createPeerConnection(call.id, 'caller')
      this.watchRemoteCandidates(call.id, 'caller')
      this.watchCallDocument(call.id, 'caller')
      const offer = await this.peerConnection.createOffer()
      await this.peerConnection.setLocalDescription(offer)
      await saveCallOffer(call.id, offer)
      debug('offer saved')
      this.setState('calling')
      return call
    } catch (error) {
      await failAccountCall(call.id, 'caller-setup-failed').catch(() => {})
      this.handleError(error)
      throw error
    }
  }

  async acceptCallee(call) {
    try {
      if (!call?.offer?.sdp) throw new Error('The caller offer is not ready yet. Try accepting again.')
      await this.requestMicrophone()
      this.createPeerConnection(call.id, 'callee')
      this.watchRemoteCandidates(call.id, 'callee')
      this.watchCallDocument(call.id, 'callee')
      await this.peerConnection.setRemoteDescription(call.offer)
      const answer = await this.peerConnection.createAnswer()
      await this.peerConnection.setLocalDescription(answer)
      await saveCallAnswer(call.id, answer)
      await updateAccountCallStatus(call.id, 'connecting', { acceptedAt: new Date() })
      debug('answer saved')
      this.setState('connecting')
      return call
    } catch (error) {
      await failAccountCall(call.id, 'callee-setup-failed').catch(() => {})
      this.handleError(error)
      throw error
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted)
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !this.muted
    })
    this.setState(this.state, { muted: this.muted })
    return this.muted
  }

  toggleMuted() {
    return this.setMuted(!this.muted)
  }

  handleError(error) {
    const message = callErrorMessage(error)
    debug('error', error?.name, error?.message)
    this.setState('failed', { error: message })
    this.onError({ message, error })
  }

  cleanup({ preserveState = false } = {}) {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.())
    this.peerConnection?.close()
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.remoteStream?.getTracks().forEach((track) => track.stop())
    this.peerConnection = null
    this.localStream = null
    this.remoteStream = null
    this.seenCandidateIds.clear()
    this.onRemoteStream(null)
    if (!preserveState) this.setState('idle')
  }
}
