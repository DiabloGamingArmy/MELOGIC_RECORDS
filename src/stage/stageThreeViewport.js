import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const DEFAULT_STAGE_OBJECTS = [
  { key: 'stage-deck', label: 'Stage Deck', type: 'Base Stage', position: [0, 0.5, 0], size: [32, 1, 24], selectable: true },
  { key: 'drum-riser', label: 'Drum Riser', type: 'Backline', position: [0, 1.1, -2], size: [6, 0.6, 5], selectable: true },
  { key: 'truss-a', label: 'Truss A', type: 'Rigging', position: [0, 8.4, -8], size: [34, 0.35, 0.35], selectable: true },
  { key: 'speaker-left', label: 'Speaker Left', type: 'Audio', position: [-14, 2.5, -2], size: [1.8, 5, 1.6], selectable: true },
  { key: 'speaker-right', label: 'Speaker Right', type: 'Audio', position: [14, 2.5, -2], size: [1.8, 5, 1.6], selectable: true },
  { key: 'camera-1', label: 'Camera 1', type: 'Video', position: [0, 1.3, 17], size: [0.8, 2, 0.8], selectable: true },
  { key: 'moving-head', label: 'Moving Head', type: 'Lighting', position: [5.8, 8, -8], size: [0.8, 0.8, 0.8], selectable: true }
]

const makeLabel = (text, position, tone = '#64d9ff') => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(7, 13, 24, 0.82)'
  ctx.strokeStyle = tone
  ctx.lineWidth = 4
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
  ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16)
  ctx.font = '600 40px Inter, Arial'
  ctx.fillStyle = '#d9f2ff'
  ctx.fillText(text, 24, 78)
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.scale.set(6.4, 1.6, 1)
  sprite.position.set(...position)
  return sprite
}

export function mountStageThreeViewport(container, options = {}) {
  try {
    container.classList.remove('is-three-error')
    container.innerHTML = ''
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#070c16')
    scene.fog = new THREE.Fog('#070c16', 38, 120)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300)
    camera.position.set(22, 15, 24)
    camera.lookAt(0, 1.5, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 1.5, 0)
    controls.minDistance = 12
    controls.maxDistance = 70
    controls.maxPolarAngle = Math.PI * 0.48

    scene.add(new THREE.AmbientLight('#90a8d4', 0.72))
    const key = new THREE.DirectionalLight('#d8e9ff', 1.25); key.position.set(14, 24, 9); scene.add(key)
    const rim = new THREE.DirectionalLight('#7ca7ff', 0.55); rim.position.set(-22, 10, -18); scene.add(rim)

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#050912', roughness: 0.95, metalness: 0.05 }))
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    scene.add(new THREE.GridHelper(120, 96, '#243956', '#14233a'))

    const pickables = []
    const objects = {}
    const addPickable = (mesh, key) => { mesh.userData.objectKey = key; pickables.push(mesh); objects[key] = mesh }

    const deckGroup = new THREE.Group(); deckGroup.name = 'stage-deck-group'; deckGroup.userData.objectKey = 'stage-deck'
    const top = new THREE.Mesh(new THREE.BoxGeometry(32, 0.72, 24), new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.72, metalness: 0.16 }))
    top.position.y = 0.86
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(32.3, 0.46, 24.3), new THREE.MeshStandardMaterial({ color: '#12161f', roughness: 0.9, metalness: 0.12 }))
    skirt.position.y = 0.35
    const frontLip = new THREE.Mesh(new THREE.BoxGeometry(32.35, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: '#4e6576' }))
    frontLip.position.set(0, 1.24, 12.12)
    deckGroup.add(top, skirt, frontLip)
    for (let x = -14; x <= 14; x += 7) for (let z = -9; z <= 9; z += 6) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.44, 2.6, 0.44), new THREE.MeshStandardMaterial({ color: '#0f131b', roughness: 0.92 }))
      leg.position.set(x, -1.05, z)
      deckGroup.add(leg)
    }
    scene.add(deckGroup)
    addPickable(deckGroup, 'stage-deck')

    DEFAULT_STAGE_OBJECTS.filter((d) => d.key !== 'stage-deck').forEach((d) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...d.size), new THREE.MeshStandardMaterial({ color: d.key.includes('truss') ? '#6762d2' : d.key.includes('moving') ? '#49c8ff' : d.key.includes('camera') ? '#4fc8b4' : '#222b39', roughness: 0.72, metalness: 0.22 }))
      mesh.position.set(...d.position)
      if (d.key === 'camera-1') mesh.rotation.z = Math.PI / 2
      scene.add(mesh)
      addPickable(mesh, d.key)
    })

    const line = (points, color) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color })))
    line([[0, 1.1, 12], [0, 1.1, 30]], '#5dd9ff')
    line([[-16, 1.2, -12], [-26, 1.2, -22]], '#ffbf7f')
    line([[16, 1.2, -12], [26, 1.2, -22]], '#ffbf7f')
    line([[-16.5, 1.1, 12.8], [16.5, 1.1, 12.8]], '#57d4ff')
    line([[0, 1.1, -12], [0, 1.1, -30]], '#6b8aff')
    line([[16, 1.2, 6], [24, 1.6, 10], [28, 1.6, 20]], '#d468ff')

    ;[
      ["32' x 24' Stage Deck", [-14, 2.8, 14], '#6bdcff'],
      ['Downstage Centerline', [0, 2.6, 20], '#61d7ff'],
      ['DSC', [-17, 2.5, 12], '#ffb16d'], ['USC', [1, 2.4, -11.5], '#ffb16d'],
      ['US Left', [-8, 2.2, -8], '#ffb16d'], ['Stage Left', [-20, 1.8, 18], '#ffb16d'],
      ['Stage Right', [20, 1.8, 18], '#ffb16d'], ['FOH', [0, 2.3, 31], '#6bdcff'],
      ['Ground supported trusses', [11, 9.8, -8], '#ffb16d']
    ].forEach(([t, p, c]) => scene.add(makeLabel(t, p, c)))

    const beams = new THREE.Group()
    ;[
      { pos: [0, 8, -8], target: [0, 1.2, 0], color: '#61dcff' },
      { pos: [6, 8, -8], target: [6, 1.1, 2], color: '#6f87ff' },
      { pos: [-6, 8, -8], target: [-6, 1.1, 2], color: '#df79ff' }
    ].forEach((b) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 20), new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.16, depthWrite: false }))
      cone.position.set(...b.pos)
      cone.lookAt(new THREE.Vector3(...b.target))
      cone.rotateX(Math.PI / 2)
      beams.add(cone)
    })
    scene.add(beams)

    const gizmo = new THREE.Group(); scene.add(gizmo)
    const addArrow = (dir, color) => gizmo.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 2.2, color, 0.45, 0.25))
    addArrow(new THREE.Vector3(1, 0, 0), '#ff6f6f'); addArrow(new THREE.Vector3(0, 1, 0), '#7cff87'); addArrow(new THREE.Vector3(0, 0, 1), '#5bc7ff')
    let boxHelper = null
    let selectedLabel = null
    let selectedKey = options.selectedObjectKey || 'stage-deck'

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2()
    const syncSelection = () => {
      pickables.forEach((m) => {
        const active = m.userData.objectKey === selectedKey
        if (m.material?.emissive) { m.material.emissive.set(active ? '#1ca8a3' : '#000000'); m.material.emissiveIntensity = active ? 0.3 : 0 }
      })
      const target = objects[selectedKey]
      if (!target) return
      gizmo.visible = true
      gizmo.position.copy(target.position)
      boxHelper?.removeFromParent(); boxHelper = new THREE.BoxHelper(target, '#5ce9ff'); scene.add(boxHelper)
      selectedLabel?.removeFromParent(); selectedLabel = makeLabel(target.userData.objectKey, [target.position.x, target.position.y + 1.8, target.position.z], '#6bdcff'); scene.add(selectedLabel)
      options.onSelectObject?.(selectedKey)
    }

    const transforms = options.objectTransforms || {}
    Object.entries(transforms).forEach(([k, t]) => objects[k]?.position.set(t.x ?? objects[k].position.x, t.y ?? objects[k].position.y, t.z ?? objects[k].position.z))

    const onPointerDown = (event) => {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickables, true).find((h) => h.object?.userData?.objectKey || h.object?.parent?.userData?.objectKey)
      if (!hit) return
      selectedKey = hit.object.userData.objectKey || hit.object.parent.userData.objectKey
      syncSelection()
    }
    const onKeyDown = (event) => {
      const obj = objects[selectedKey]; if (!obj) return
      const step = event.shiftKey ? 0.6 : 0.2
      const axis = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['z', -1], ArrowDown: ['z', 1], PageUp: ['y', 1], PageDown: ['y', -1] }[event.key]
      if (!axis) return
      event.preventDefault(); obj.position[axis[0]] += step * axis[1]; gizmo.position.copy(obj.position); boxHelper?.update(); selectedLabel?.position.set(obj.position.x, obj.position.y + 1.8, obj.position.z)
      options.onTransformObject?.(selectedKey, { x: obj.position.x, y: obj.position.y, z: obj.position.z })
    }
    const onResize = () => { const w = Math.max(container.clientWidth, 10); const h = Math.max(container.clientHeight, 10); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false) }
    const ro = new ResizeObserver(onResize); ro.observe(container)

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('pointerdown', () => container.focus())
    syncSelection(); onResize()
    let raf = 0
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }
    animate()
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.domElement.removeEventListener('pointerdown', onPointerDown); container.removeEventListener('keydown', onKeyDown); controls.dispose(); renderer.dispose(); scene.clear(); container.innerHTML = '' }
  } catch (error) {
    console.error('[stageThreeViewport] mount failed', error)
    container.classList.add('is-three-error')
    container.innerHTML = '<div class="stage-three-error-panel"><p>3D viewport could not initialize.</p><p>Check browser WebGL support.</p></div>'
    return () => {}
  }
}
