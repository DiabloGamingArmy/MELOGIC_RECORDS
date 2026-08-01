const test = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp({ projectId: 'melogic-test' })

const { __test } = require('../src/music/musicLiveStreams')

test('secondary remote detection distinguishes the primary device', () => {
  const stream = { primaryControlDeviceId: 'primary-device' }
  assert.equal(__test.isSecondaryStreamingRemote(stream, { controlDevice: { deviceId: 'primary-device' } }), false)
  assert.equal(__test.isSecondaryStreamingRemote(stream, { controlDevice: { deviceId: 'remote-device' } }), true)
  assert.equal(__test.isSecondaryStreamingRemote({}, { controlDevice: { deviceId: 'remote-device' } }), false)
})

test('remote shared controls exclude publisher and ingest health fields', () => {
  const shared = __test.remoteSharedProgramFields({
    chatEnabled: true,
    audioEnabled: true,
    videoEnabled: true,
    activeAudioSources: { browser: true, sequence: false },
    activeVideoSource: 'screen',
    programState: { activeSceneId: 'scene-1' },
    audioPublished: false,
    videoPublished: false,
    programHasAudio: false,
    programHasVideo: false,
    providerDiagnostics: { ingestConnectionState: 'disconnected' }
  })

  assert.deepEqual(shared, {
    chatEnabled: true,
    audioEnabled: true,
    videoEnabled: true,
    audioOnly: false,
    activeAudioSources: { browser: true, sequence: false },
    activeVideoSource: 'screen',
    programState: { activeSceneId: 'scene-1' }
  })
  assert.equal('audioPublished' in shared, false)
  assert.equal('providerDiagnostics' in shared, false)
})
