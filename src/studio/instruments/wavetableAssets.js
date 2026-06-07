export const WAVETABLE_ASSET_SCHEMA_EXAMPLE = {
  collection: 'audioAssets',
  fields: {
    type: 'wavetable',
    title: 'Display name',
    creatorUid: 'system-or-user-uid',
    storagePath: 'audio/wavetables/basic/saw.wav',
    frameCount: 1,
    frameSize: 2048,
    sampleRate: 44100,
    tags: ['basic'],
    visibility: 'public',
    license: 'Melogic built-in',
    checksum: '',
    version: 1,
    createdAt: null,
    updatedAt: null
  }
}

export const BUILT_IN_WAVETABLE_METADATA = [
  {
    assetId: 'builtin-sine',
    type: 'wavetable',
    title: 'Sine',
    creatorUid: 'system',
    storagePath: '',
    frameCount: 1,
    frameSize: 2048,
    sampleRate: 44100,
    tags: ['basic', 'clean'],
    visibility: 'public',
    license: 'Melogic built-in',
    checksum: 'generated:sine:v1',
    version: 1
  },
  {
    assetId: 'builtin-saw',
    type: 'wavetable',
    title: 'Saw Stack',
    creatorUid: 'system',
    storagePath: 'audio/wavetables/basic/saw.wav',
    frameCount: 3,
    frameSize: 2048,
    sampleRate: 44100,
    tags: ['basic', 'bright'],
    visibility: 'public',
    license: 'Melogic built-in',
    checksum: 'generated:saw:v1',
    version: 1
  },
  {
    assetId: 'builtin-square',
    type: 'wavetable',
    title: 'Square Hollow',
    creatorUid: 'system',
    storagePath: 'audio/wavetables/basic/square.wav',
    frameCount: 3,
    frameSize: 2048,
    sampleRate: 44100,
    tags: ['basic', 'hollow'],
    visibility: 'public',
    license: 'Melogic built-in',
    checksum: 'generated:square:v1',
    version: 1
  },
  {
    assetId: 'builtin-triangle',
    type: 'wavetable',
    title: 'Triangle Soft',
    creatorUid: 'system',
    storagePath: 'audio/wavetables/basic/triangle.wav',
    frameCount: 2,
    frameSize: 2048,
    sampleRate: 44100,
    tags: ['basic', 'soft'],
    visibility: 'public',
    license: 'Melogic built-in',
    checksum: 'generated:triangle:v1',
    version: 1
  },
  {
    assetId: 'builtin-digital-glass',
    type: 'wavetable',
    title: 'Digital Glass',
    creatorUid: 'system',
    storagePath: 'audio/wavetables/digital/fm-glass.wav',
    frameCount: 4,
    frameSize: 2048,
    sampleRate: 44100,
    tags: ['digital', 'fm', 'glass'],
    visibility: 'public',
    license: 'Melogic built-in',
    checksum: 'generated:digital-glass:v1',
    version: 1
  }
]

const HARMONIC_COUNT = 48

function harmonicFrame(generator) {
  const real = new Float32Array(HARMONIC_COUNT + 1)
  const imag = new Float32Array(HARMONIC_COUNT + 1)
  for (let harmonic = 1; harmonic <= HARMONIC_COUNT; harmonic += 1) {
    imag[harmonic] = generator(harmonic)
  }
  return { real, imag }
}

function sawFrame(tilt = 1) {
  return harmonicFrame((harmonic) => ((harmonic % 2 === 0 ? -1 : 1) / harmonic) * tilt)
}

function squareFrame(tilt = 1) {
  return harmonicFrame((harmonic) => (harmonic % 2 ? (1 / harmonic) * tilt : 0))
}

function triangleFrame(tilt = 1) {
  return harmonicFrame((harmonic) => {
    if (harmonic % 2 === 0) return 0
    const sign = ((harmonic - 1) / 2) % 2 === 0 ? 1 : -1
    return sign * (1 / (harmonic * harmonic)) * tilt
  })
}

function sineFrame() {
  return harmonicFrame((harmonic) => harmonic === 1 ? 1 : 0)
}

function digitalGlassFrame(spread = 1) {
  return harmonicFrame((harmonic) => {
    const cluster = Math.sin(harmonic * 1.73 * spread) * Math.cos(harmonic * 0.31)
    const shimmer = harmonic % 5 === 0 ? 0.28 : 1
    return (cluster / Math.max(1, harmonic ** 0.82)) * shimmer
  })
}

export function getBuiltInWavetableFrames(assetId = 'builtin-saw') {
  if (assetId === 'builtin-sine') return [sineFrame()]
  if (assetId === 'builtin-square') return [squareFrame(0.75), squareFrame(1), squareFrame(1.3)]
  if (assetId === 'builtin-triangle') return [triangleFrame(0.85), triangleFrame(1.25)]
  if (assetId === 'builtin-digital-glass') return [digitalGlassFrame(0.5), digitalGlassFrame(0.85), digitalGlassFrame(1.2), digitalGlassFrame(1.7)]
  return [sawFrame(0.65), sawFrame(1), sawFrame(1.35)]
}

export function getBuiltInWavetable(assetId = 'builtin-saw') {
  const metadata = BUILT_IN_WAVETABLE_METADATA.find((item) => item.assetId === assetId) || BUILT_IN_WAVETABLE_METADATA[1]
  return {
    ...metadata,
    frames: getBuiltInWavetableFrames(metadata.assetId)
  }
}
