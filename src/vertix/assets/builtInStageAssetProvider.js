import { createVertixAssetRegistry } from './assetRegistry.js'

export const builtInStageAssetPackage = Object.freeze({
  packageId: 'com.melogic.vertix.builtin-stage-assets',
  packageVersion: '1.0.0',
  publisherId: 'melogic',
  source: 'built-in',
  integrity: 'vertix-builtin-stage-assets-v1'
})

const primitiveStageAssets = [
  { id: 'primitive-rectangle', label: 'Rectangle', type: 'primitive-rectangle', category: 'primitive', layer: 'stage', icon: '▭', dimensions: { width: 4, depth: 3, height: 0.2 }, position: { x: 0, y: 1.1, z: 0 }, metadata: { color: '#4e6576' } },
  { id: 'primitive-square', label: 'Square', type: 'primitive-square', category: 'primitive', layer: 'stage', icon: '□', dimensions: { width: 3, depth: 3, height: 0.2 }, position: { x: 0, y: 1.1, z: 0 }, metadata: { color: '#4e6576' } },
  { id: 'primitive-circle', label: 'Circle', type: 'primitive-circle', category: 'primitive', layer: 'stage', icon: '○', dimensions: { width: 3, depth: 3, height: 0.2 }, position: { x: 0, y: 1.1, z: 0 }, metadata: { color: '#4e6576' } },
  { id: 'primitive-cube', label: 'Cube', type: 'primitive-cube', category: 'primitive', layer: 'stage', icon: '◼', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 2, z: 0 }, metadata: { color: '#38475c' } },
  { id: 'primitive-cylinder', label: 'Cylinder', type: 'primitive-cylinder', category: 'primitive', layer: 'stage', icon: '◉', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 2, z: 0 }, metadata: { color: '#38475c' } },
  { id: 'primitive-label', label: 'Label', type: 'label', category: 'notes', layer: 'notes', icon: 'Aa', dimensions: { width: 3, depth: 0.3, height: 0.1 }, position: { x: 0, y: 1.5, z: 0 }, metadata: { text: 'Label' } }
]

const productionStageAssets = [
  { id: 'asset-drum-riser', label: 'Drum Riser', type: 'drum-riser', category: 'backline', layer: 'backline', icon: 'Rise', dimensions: { width: 8, depth: 8, height: 1 }, position: { x: 0, y: 1.5, z: -5 }, metadata: { notes: 'Backline riser block' } },
  { id: 'asset-vocal-mic', label: 'Vocal Mic', type: 'microphone', category: 'audio', layer: 'audio', icon: 'Mic', dimensions: { width: 0.5, depth: 0.5, height: 4.5 }, position: { x: 0, y: 2.4, z: 7 }, metadata: { source: 'Lead Vocal', micDi: 'Wireless Handheld', stand: 'Straight', monitorSend: 'Mix 1', stageLocation: 'DSC' } },
  { id: 'asset-guitar-amp', label: 'Guitar Amp', type: 'guitar-amp', category: 'backline', layer: 'backline', icon: 'Amp', dimensions: { width: 2.4, depth: 1.2, height: 2.2 }, position: { x: -7, y: 2.0, z: -2 }, metadata: { source: 'Guitar Amp', micDi: 'SM57', stand: 'Short', stageLocation: 'USL' } },
  { id: 'asset-bass-di', label: 'Bass DI', type: 'bass-di', category: 'audio', layer: 'audio', icon: 'DI', dimensions: { width: 1, depth: 0.8, height: 0.4 }, position: { x: 6, y: 1.3, z: -2 }, metadata: { source: 'Bass DI', micDi: 'DI', stand: 'N/A', stageLocation: 'USR' } },
  { id: 'asset-playback-rack', label: 'Playback Rack', type: 'playback-rack', category: 'audio', layer: 'audio', icon: 'Rack', dimensions: { width: 2, depth: 2, height: 3 }, position: { x: 9, y: 2.2, z: -6 }, metadata: { source: 'Playback', micDi: 'Interface', stand: 'N/A', stageLocation: 'USR', stereoInputs: true } },
  { id: 'asset-speaker-stack', label: 'Speaker Stack', type: 'speaker', category: 'audio', layer: 'audio', icon: 'Spk', dimensions: { width: 1.8, depth: 1.6, height: 5 }, position: { x: -14, y: 2.5, z: -2 }, metadata: { stageLocation: 'DS edge', notes: 'PA / house audio placeholder' } },
  { id: 'asset-subwoofer', label: 'Subwoofer', type: 'subwoofer', category: 'audio', layer: 'audio', icon: 'Sub', dimensions: { width: 3, depth: 2.5, height: 1.4 }, position: { x: -5, y: 1.2, z: 11 }, metadata: { stageLocation: 'Downstage', notes: 'Subwoofer placement placeholder' } },
  { id: 'asset-wedge-monitor', label: 'Wedge Monitor', type: 'wedge-monitor', category: 'audio', layer: 'audio', icon: 'Mon', dimensions: { width: 2.2, depth: 1.4, height: 0.8 }, position: { x: 0, y: 1.35, z: 9 }, metadata: { monitorSend: 'Mix 1', stageLocation: 'DSC' } },
  { id: 'asset-moving-head', label: 'Moving Head', type: 'moving-head', category: 'lighting', layer: 'lighting', icon: 'MH', dimensions: { width: 0.9, depth: 0.9, height: 0.9 }, position: { x: 0, y: 8, z: -8 }, metadata: { fixtureType: 'Moving Head', universe: 1, address: 1, mode: '24ch', beamAngle: 24, color: '#61dcff', target: 'DSC', trussAssignment: 'Truss A' } },
  { id: 'asset-led-bar', label: 'LED Bar', type: 'led-bar', category: 'lighting', layer: 'lighting', icon: 'LED', dimensions: { width: 4, depth: 0.35, height: 0.35 }, position: { x: 0, y: 1.5, z: -10 }, metadata: { fixtureType: 'LED Bar', universe: 1, address: 101, mode: '16ch', beamAngle: 35, color: '#7cffdf', target: 'Backdrop' } },
  { id: 'asset-truss', label: 'Truss', type: 'truss', category: 'rigging', layer: 'rigging', icon: 'Trs', dimensions: { width: 20, depth: 0.35, height: 0.35 }, position: { x: 0, y: 8.4, z: -8 }, metadata: { trussType: 'Box Truss', qualifiedOnly: true, safetyNote: 'Load calculation required by qualified rigger.' } },
  { id: 'asset-led-wall', label: 'LED Wall', type: 'led-wall', category: 'video', layer: 'video', icon: 'LED', dimensions: { width: 12, depth: 0.4, height: 6 }, position: { x: 0, y: 4, z: -11.5 }, metadata: { screenType: 'LED Wall', aspectRatio: '16:9', resolution: '1920x1080', inputSource: 'Video Playback' } },
  { id: 'asset-screen', label: 'Projection Screen', type: 'screen', category: 'video', layer: 'video', icon: 'Scr', dimensions: { width: 10, depth: 0.35, height: 5.6 }, position: { x: 0, y: 3.8, z: -11.2 }, metadata: { screenType: 'Projection Screen', aspectRatio: '16:9', inputSource: 'Projector' } },
  { id: 'asset-camera', label: 'Camera', type: 'camera', category: 'video', layer: 'video', icon: 'Cam', dimensions: { width: 0.8, depth: 0.8, height: 2 }, position: { x: 0, y: 1.3, z: 17 }, metadata: { cameraAngle: 'FOH Wide', lens: '24-70mm', inputSource: 'Camera 1' } },
  { id: 'asset-foh', label: 'FOH Position', type: 'foh-position', category: 'venue', layer: 'venue', icon: 'FOH', dimensions: { width: 5, depth: 4, height: 0.2 }, position: { x: 0, y: 0.2, z: 28 }, metadata: { venueMarker: true, notes: 'Console / production position' } },
  { id: 'asset-road-case', label: 'Road Case', type: 'road-case', category: 'cases', layer: 'venue', icon: 'Case', dimensions: { width: 2.4, depth: 2, height: 2.6 }, position: { x: 12, y: 1.8, z: 8 }, metadata: { notes: 'Storage / backline case' } },
  { id: 'asset-power-distro', label: 'Power Distro', type: 'power-distro', category: 'power', layer: 'power', icon: 'Pwr', dimensions: { width: 2, depth: 1.4, height: 2.2 }, position: { x: -14, y: 1.7, z: -10 }, metadata: { powerLocation: 'USL', notes: 'Confirm service and tie-in with venue.' } }
]

function defineBuiltInAsset(asset) {
  return Object.freeze({
    ...asset,
    tags: [asset.category, asset.layer, asset.type].filter(Boolean),
    source: builtInStageAssetPackage.source,
    preview: { icon: asset.icon },
    defaultTransform: {
      position: { ...asset.position },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    },
    provenance: {
      ...builtInStageAssetPackage,
      assetUuid: `${builtInStageAssetPackage.packageId}:${asset.id}`
    }
  })
}

export const builtInStageAssets = Object.freeze([
  ...primitiveStageAssets,
  ...productionStageAssets
].map(defineBuiltInAsset))

export const builtInStageAssetProvider = Object.freeze({
  id: 'builtin-stage-assets',
  package: builtInStageAssetPackage,
  listAssets: () => builtInStageAssets,
  getAsset: (assetId) => builtInStageAssets.find((asset) => asset.id === assetId),
  listAssetGroups: () => [
    { key: 'primitives', label: 'Primitive Shapes', assetIds: primitiveStageAssets.map((asset) => asset.id) },
    { key: 'production', label: 'Production Objects', assetIds: productionStageAssets.map((asset) => asset.id) }
  ]
})

export const vertixAssetRegistry = createVertixAssetRegistry([builtInStageAssetProvider])
