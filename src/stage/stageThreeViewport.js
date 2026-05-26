const THREE_URL = 'https://unpkg.com/three@0.181.0/build/three.module.js'
const ORBIT_URL = 'https://unpkg.com/three@0.181.0/examples/jsm/controls/OrbitControls.js'

const SCENE_OBJECTS = [
  { key: 'stage-deck', label: 'Stage Deck', type: 'Base Stage', position: [0, 0.1, 0], size: [32, 0.35, 24] },
  { key: 'drum-riser', label: 'Drum Riser', type: 'Backline', position: [0, 1, -5], size: [8, 1, 8] },
  { key: 'truss-a', label: 'Truss A', type: 'Rigging', position: [0, 10, -9], size: [34, 0.35, 0.35] },
  { key: 'speaker-left', label: 'L Main', type: 'Audio', position: [-18, 2, 4], size: [1.5, 4, 1.5] },
  { key: 'speaker-right', label: 'R Main', type: 'Audio', position: [18, 2, 4], size: [1.5, 4, 1.5] },
  { key: 'camera-1', label: 'Camera 1', type: 'Video', position: [0, 1, 18], size: [1.5, 1.5, 1.5] }
]
const COLORS = { 'Base Stage': 0x33455f, Backline: 0x405d8a, Rigging: 0x5f4a88, Audio: 0x2b7fab, Video: 0x3c9c88 }

export function mountStageThreeViewport(container, options = {}) {
  let disposed = false
  let rafId = 0
  const cleanups = []

  const boot = async () => {
    const THREE = await import(THREE_URL)
    const { OrbitControls } = await import(ORBIT_URL)
    if (disposed) return

    container.innerHTML = ''
    container.tabIndex = 0

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x060b16, 0.015)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x060b16, 1)
    container.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200)
    camera.position.set(18, 14, 22)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 2, 0)

    scene.add(new THREE.AmbientLight(0x90a6cc, 0.7))
    const keyLight = new THREE.DirectionalLight(0xdde9ff, 1)
    keyLight.position.set(12, 28, 8)
    scene.add(keyLight)
    const fill = new THREE.PointLight(0x38d5ff, 0.45, 80)
    fill.position.set(-16, 10, 12)
    scene.add(fill)
    scene.add(new THREE.GridHelper(90, 90, 0x294f86, 0x1a2a45))

    const meshes = new Map()
    const selectableMeshes = []
    SCENE_OBJECTS.forEach((obj) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(obj.size[0], obj.size[1], obj.size[2]),
        new THREE.MeshStandardMaterial({ color: COLORS[obj.type] || 0x597193, metalness: 0.1, roughness: 0.7 })
      )
      mesh.position.set(...obj.position)
      mesh.userData.objectKey = obj.key
      scene.add(mesh)
      meshes.set(obj.key, mesh)
      selectableMeshes.push(mesh)
    })

    ;[-6, 0, 6].forEach((x, i) => {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 12), new THREE.MeshStandardMaterial({ color: 0x89a9d5 }))
      stand.position.set(x, 0.8, 8)
      stand.userData.objectKey = `mic-${i + 1}`
      scene.add(stand)
      meshes.set(`mic-${i + 1}`, stand)
      selectableMeshes.push(stand)
    })

    const gizmo = new THREE.Group()
    const makeAxis = (dir, color, name) => {
      const axis = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 2.1, color, 0.45, 0.3)
      axis.cone.userData.axis = name
      axis.line.userData.axis = name
      gizmo.add(axis)
    }
    makeAxis(new THREE.Vector3(1, 0, 0), 0xff6a3a, 'x')
    makeAxis(new THREE.Vector3(0, 1, 0), 0x45d37a, 'y')
    makeAxis(new THREE.Vector3(0, 0, 1), 0x3cb8ff, 'z')
    scene.add(gizmo)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const setSelectionVisual = () => {
      const selectedKey = options.getSelectedObjectKey?.() || options.selectedObjectKey || 'stage-deck'
      meshes.forEach((mesh, key) => {
        if (mesh.material?.emissive) mesh.material.emissive.setHex(key === selectedKey ? 0x1f5e8f : 0x000000)
      })
      if (meshes.get(selectedKey)) gizmo.position.copy(meshes.get(selectedKey).position)
    }

    const resize = () => {
      const width = container.clientWidth || 1
      const height = container.clientHeight || 1
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    const onPick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(selectableMeshes, false)[0]
      if (!hit?.object?.userData?.objectKey) return
      options.onSelectObject?.(hit.object.userData.objectKey)
    }

    const onKey = (event) => {
      const selectedKey = options.getSelectedObjectKey?.() || options.selectedObjectKey
      const selected = meshes.get(selectedKey)
      if (!selected) return
      const step = event.shiftKey ? 1 : 0.25
      let moved = false
      if (event.key === 'ArrowLeft') { selected.position.x -= step; moved = true }
      if (event.key === 'ArrowRight') { selected.position.x += step; moved = true }
      if (event.key === 'ArrowUp') { selected.position.z -= step; moved = true }
      if (event.key === 'ArrowDown') { selected.position.z += step; moved = true }
      if (event.key === 'PageUp') { selected.position.y += step; moved = true }
      if (event.key === 'PageDown') { selected.position.y -= step; moved = true }
      if (!moved) return
      event.preventDefault()
      gizmo.position.copy(selected.position)
      options.onTransformObject?.(selectedKey, { position: { x: selected.position.x, y: selected.position.y, z: selected.position.z } })
    }

    renderer.domElement.addEventListener('pointerdown', onPick)
    container.addEventListener('keydown', onKey)
    cleanups.push(() => renderer.domElement.removeEventListener('pointerdown', onPick))
    cleanups.push(() => container.removeEventListener('keydown', onKey))

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    cleanups.push(() => ro.disconnect())

    resize()
    setSelectionVisual()

    const tick = () => {
      if (disposed) return
      controls.update()
      setSelectionVisual()
      renderer.render(scene, camera)
      rafId = requestAnimationFrame(tick)
    }
    tick()

    cleanups.push(() => {
      cancelAnimationFrame(rafId)
      controls.dispose()
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material?.dispose) obj.material.dispose()
      })
      renderer.dispose()
      container.innerHTML = ''
    })
  }

  boot().catch((error) => {
    console.error('[stageThreeViewport] Failed to mount', error)
    container.innerHTML = '<p class="stage-viewport-fallback">3D viewport unavailable in this environment.</p>'
  })

  return () => {
    disposed = true
    cleanups.splice(0).forEach((fn) => fn())
  }
}
