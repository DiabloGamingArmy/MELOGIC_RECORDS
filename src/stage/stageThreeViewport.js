import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createDefaultStagePlan } from './stagePlanModel'
const FORCE_STAGE_VIEWPORT_SMOKE_TEST = false
const SHOW_VIEWPORT_DIAGNOSTICS = Boolean(import.meta?.env?.DEV)

const defaultStagePlan = () => createDefaultStagePlan({ id: 'viewport-fallback', name: 'Viewport Fallback' })

const objectDefsFromProject = (project = {}) => {
  const source = Array.isArray(project.objects) && project.objects.length ? project.objects : defaultStagePlan().objects
  return source.map((object) => {
    const dimensions = object.dimensions || {}
    const position = object.position || {}
    return {
      key: object.id || object.key || object.name,
      label: object.label || object.name || object.id || object.key || 'Stage Object',
      type: object.type || object.category || 'Object',
      category: object.category || 'stage',
      color: object.color || object.metadata?.color || '',
      position: Array.isArray(object.position) ? object.position : [Number(position.x || 0), Number(position.y || 0), Number(position.z || 0)],
      size: Array.isArray(object.size) ? object.size : [Number(dimensions.width || 1), Number(dimensions.height || 1), Number(dimensions.depth || 1)],
      rotation: object.rotation || { x: 0, y: 0, z: 0 },
      selectable: object.selectable !== false,
      visible: object.visible !== false,
      locked: !!object.locked
    }
  }).filter((object) => object.key)
}

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
    let camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300)
    camera.position.set(22, 15, 24)
    camera.lookAt(0, 1.5, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.appendChild(renderer.domElement)
    console.info('[stageThreeViewport] renderer initialized')

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 1.5, 0)
    controls.minDistance = 12
    controls.maxDistance = 70
    controls.maxPolarAngle = Math.PI * 0.48
    const formatNum = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
    let currentViewMode = options.viewportMode || 'perspective3d'
    let currentRenderMode = options.renderMode || 'technical'
    let currentToolMode = options.toolMode || 'select'
    let currentShowBeams = options.showBeams !== false
    let currentShowLabels = options.showLabels !== false
    let currentSnapEnabled = options.snapEnabled !== false
    let currentSnapInterval = Number(options.snapInterval) || 1
    const snapNumber = (value) => currentSnapEnabled && currentSnapInterval > 0 ? Math.round(value / currentSnapInterval) * currentSnapInterval : value
    const setOrthoBounds = (orthoCamera, size, aspect) => {
      orthoCamera.left = -size * aspect
      orthoCamera.right = size * aspect
      orthoCamera.top = size
      orthoCamera.bottom = -size
    }
    const setPlanningControls = (isPlanningView) => {
      controls.enableRotate = !isPlanningView
      controls.enablePan = true
      controls.enableZoom = true
      controls.mouseButtons.LEFT = isPlanningView ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
      controls.touches.ONE = isPlanningView ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
    }
    const setViewMode = (mode = 'perspective3d') => {
      currentViewMode = mode
      const w = Math.max(container.clientWidth || 1, 1)
      const h = Math.max(container.clientHeight || 1, 1)
      const aspect = w / h
      const orthoSize = mode === 'front' || mode === 'side' ? 20 : 24
      if (mode === 'perspective3d') {
        camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 300)
        camera.position.set(22, 15, 24)
        camera.up.set(0, 1, 0)
        setPlanningControls(false)
        controls.minPolarAngle = 0
        controls.maxPolarAngle = Math.PI * 0.48
      } else {
        camera = new THREE.OrthographicCamera()
        setOrthoBounds(camera, orthoSize, aspect)
        setPlanningControls(true)
        controls.minPolarAngle = 0
        controls.maxPolarAngle = Math.PI
        camera.up.set(0, 1, 0)
        if (mode === 'top2d') {
          camera.position.set(0, 64, 0.001)
          camera.up.set(0, 0, -1)
        } else if (mode === 'front') camera.position.set(0, 12, 64)
        else if (mode === 'side') camera.position.set(64, 12, 0)
        else camera.position.set(36, 30, 36)
      }
      camera.lookAt(0, 1.5, 0)
      controls.object = camera
      controls.target.set(0, 1.5, 0)
      if (camera.isOrthographicCamera) camera.zoom = mode === 'top2d' ? 1.12 : mode === 'isometric' ? 1.05 : 1
      controls.update()
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
    }
    setViewMode(options.viewportMode || 'perspective3d')

    scene.add(new THREE.AmbientLight('#90a8d4', 0.72))
    const key = new THREE.DirectionalLight('#d8e9ff', 1.25); key.position.set(14, 24, 9); scene.add(key)
    const rim = new THREE.DirectionalLight('#7ca7ff', 0.55); rim.position.set(-22, 10, -18); scene.add(rim)

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#050912', roughness: 0.95, metalness: 0.05 }))
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    const gridHelper = new THREE.GridHelper(120, 96, '#243956', '#14233a')
    gridHelper.visible = options.showGrid !== false
    scene.add(gridHelper)

    const stageObjectDefs = objectDefsFromProject(options.project)
    const stageDimensions = options.project?.stageDimensions || {}
    const deckDef = stageObjectDefs.find((d) => d.key === 'stage-deck') || objectDefsFromProject(defaultStagePlan())[0]
    const deckWidth = Number(stageDimensions.width || deckDef.size?.[0] || 32)
    const deckDepth = Number(stageDimensions.depth || deckDef.size?.[2] || 24)
    const deckHeight = Number(stageDimensions.deckHeight || deckDef.size?.[1] || 1)
    const pickables = []
    const objects = {}
    const objectMeta = Object.fromEntries(stageObjectDefs.map((d) => [d.key, d]))
    const addPickable = (mesh, key) => { mesh.userData.objectKey = key; mesh.userData.stageLocked = !!objectMeta[key]?.locked; pickables.push(mesh); objects[key] = mesh }
    const materialColorFor = (d) => d.color || (d.category === 'rigging' ? '#6762d2' : d.category === 'lighting' ? '#49c8ff' : d.category === 'video' ? '#4fc8b4' : d.category === 'audio' ? '#26364b' : d.category === 'power' ? '#ffb86b' : '#222b39')
    const geometryFor = (d) => {
      if (d.type?.includes('cylinder') || d.type === 'microphone') return new THREE.CylinderGeometry(Math.max(0.12, d.size[0] / 2), Math.max(0.12, d.size[0] / 2), Math.max(0.2, d.size[1]), 18)
      if (d.type?.includes('circle')) return new THREE.CylinderGeometry(Math.max(0.2, d.size[0] / 2), Math.max(0.2, d.size[0] / 2), Math.max(0.12, d.size[1]), 32)
      return new THREE.BoxGeometry(...d.size)
    }

    const deckGroup = new THREE.Group(); deckGroup.name = 'stage-deck-group'; deckGroup.userData.objectKey = 'stage-deck'
    const top = new THREE.Mesh(new THREE.BoxGeometry(deckWidth, Math.max(0.42, deckHeight * 0.18), deckDepth), new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.72, metalness: 0.16 }))
    top.position.y = 0.86
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(deckWidth + 0.3, 0.46, deckDepth + 0.3), new THREE.MeshStandardMaterial({ color: '#12161f', roughness: 0.9, metalness: 0.12 }))
    skirt.position.y = 0.35
    const frontLip = new THREE.Mesh(new THREE.BoxGeometry(deckWidth + 0.35, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: '#4e6576' }))
    frontLip.position.set(0, 1.24, deckDepth / 2 + 0.12)
    deckGroup.add(top, skirt, frontLip)
    for (let x = -deckWidth / 2 + 2; x <= deckWidth / 2 - 2; x += Math.max(6, deckWidth / 4)) for (let z = -deckDepth / 2 + 3; z <= deckDepth / 2 - 3; z += Math.max(5, deckDepth / 4)) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.44, 2.6, 0.44), new THREE.MeshStandardMaterial({ color: '#0f131b', roughness: 0.92 }))
      leg.position.set(x, -1.05, z)
      deckGroup.add(leg)
    }
    scene.add(deckGroup)
    addPickable(deckGroup, 'stage-deck')

    stageObjectDefs.filter((d) => d.key !== 'stage-deck' && d.visible !== false).forEach((d) => {
      const mesh = new THREE.Mesh(geometryFor(d), new THREE.MeshStandardMaterial({ color: materialColorFor(d), roughness: 0.72, metalness: 0.22 }))
      mesh.position.set(...d.position)
      mesh.rotation.set(THREE.MathUtils.degToRad(d.rotation?.x || 0), THREE.MathUtils.degToRad(d.rotation?.y || 0), THREE.MathUtils.degToRad(d.rotation?.z || 0))
      if (d.key === 'camera-1' && !d.rotation?.z) mesh.rotation.z = Math.PI / 2
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

    const labelSprites = [
      [`${formatNum(deckWidth, 0)}' x ${formatNum(deckDepth, 0)}' Stage Deck`, [-deckWidth / 2 + 2, 2.8, deckDepth / 2 + 2], '#6bdcff'],
      ['Downstage Centerline', [0, 2.6, 20], '#61d7ff'],
      ['DSC', [-17, 2.5, 12], '#ffb16d'], ['USC', [1, 2.4, -11.5], '#ffb16d'],
      ['US Left', [-8, 2.2, -8], '#ffb16d'], ['Stage Left', [-20, 1.8, 18], '#ffb16d'],
      ['Stage Right', [20, 1.8, 18], '#ffb16d'], ['FOH', [0, 2.3, 31], '#6bdcff'],
      ['Ground supported trusses', [11, 9.8, -8], '#ffb16d']
    ].map(([t, p, c]) => makeLabel(t, p, c))
    labelSprites.forEach((sprite) => { sprite.visible = options.showLabels !== false; scene.add(sprite) })

    const beams = new THREE.Group()
    const beamSources = Array.isArray(options.project?.fixtures) && options.project.fixtures.length
      ? options.project.fixtures.map((fixture) => ({ pos: [fixture.position?.x || 0, fixture.position?.y || 8, fixture.position?.z || -8], target: Array.isArray(fixture.target) ? fixture.target : [fixture.target?.x || 0, fixture.target?.y || 1.2, fixture.target?.z || 0], color: fixture.color || '#61dcff', angle: fixture.beamAngle || 24 }))
      : [
          { pos: [0, 8, -8], target: [0, 1.2, 0], color: '#61dcff' },
          { pos: [6, 8, -8], target: [6, 1.1, 2], color: '#6f87ff' },
          { pos: [-6, 8, -8], target: [-6, 1.1, 2], color: '#df79ff' }
        ]
    beamSources.forEach((b) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 20), new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.16, depthWrite: false }))
      cone.position.set(...b.pos)
      cone.lookAt(new THREE.Vector3(...b.target))
      cone.rotateX(Math.PI / 2)
      beams.add(cone)
    })
    beams.visible = currentShowBeams && currentRenderMode !== 'simple' && currentRenderMode !== 'export-clean'
    scene.add(beams)

    const gizmo = new THREE.Group(); scene.add(gizmo)
    const addArrow = (dir, color) => gizmo.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 2.2, color, 0.45, 0.25))
    addArrow(new THREE.Vector3(1, 0, 0), '#ff6f6f'); addArrow(new THREE.Vector3(0, 1, 0), '#7cff87'); addArrow(new THREE.Vector3(0, 0, 1), '#5bc7ff')
    let boxHelper = null
    let selectedLabel = null
    let selectedKey = objects[options.selectedObjectKey] ? options.selectedObjectKey : 'stage-deck'

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2()
    const drag = {
      active: false,
      mode: '',
      key: '',
      pointerId: 0,
      startX: 0,
      startRotY: 0,
      startScale: new THREE.Vector3(1, 1, 1),
      startSize: [1, 1, 1],
      scaleFactor: 1,
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      offset: new THREE.Vector3(),
      point: new THREE.Vector3()
    }
    const syncSelection = () => {
      pickables.forEach((m) => {
        const active = m.userData.objectKey === selectedKey
        if (m.material?.emissive) { m.material.emissive.set(active ? '#1ca8a3' : '#000000'); m.material.emissiveIntensity = active ? 0.3 : 0 }
      })
      const target = objects[selectedKey]
      if (!target) {
        gizmo.visible = false
        boxHelper?.removeFromParent()
        selectedLabel?.removeFromParent()
        return
      }
      gizmo.visible = currentToolMode === 'move' && !target.userData.stageLocked
      gizmo.position.copy(target.position)
      boxHelper?.removeFromParent(); boxHelper = new THREE.BoxHelper(target, '#5ce9ff'); scene.add(boxHelper)
      const label = objectMeta[target.userData.objectKey]?.label || target.userData.objectKey
      try { selectedLabel?.removeFromParent(); selectedLabel = makeLabel(label, [target.position.x, target.position.y + 1.8, target.position.z], '#6bdcff'); scene.add(selectedLabel) } catch (e) { console.warn('[stageThreeViewport] label render skipped', e) }
    }
    const setSelectedKey = (nextKey, { notify = false } = {}) => {
      if (!nextKey || !objects[nextKey]) return
      const changed = selectedKey !== nextKey
      selectedKey = nextKey
      syncSelection()
      if (notify && changed) options.onSelectObject?.(selectedKey)
    }

    const objectBox = (key = selectedKey) => {
      const target = objects[key]
      if (!target) return null
      return new THREE.Box3().setFromObject(target)
    }

    const frameBox = (box) => {
      if (!box || box.isEmpty()) return
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z, 4)
      controls.target.copy(center)
      if (camera.isPerspectiveCamera) {
        const direction = camera.position.clone().sub(controls.target).normalize()
        if (!Number.isFinite(direction.length()) || direction.length() < 0.01) direction.set(1, 0.6, 1).normalize()
        const distance = Math.max(10, radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.2)
        camera.position.copy(center).add(direction.multiplyScalar(distance))
      } else {
        if (currentViewMode === 'top2d') camera.position.set(center.x, 64, center.z + 0.001)
        else if (currentViewMode === 'front') camera.position.set(center.x, center.y + 8, 64)
        else if (currentViewMode === 'side') camera.position.set(64, center.y + 8, center.z)
        else camera.position.set(center.x + 36, center.y + 30, center.z + 36)
        camera.lookAt(center)
        const viewWidth = currentViewMode === 'side' ? Math.max(size.z, 1) : Math.max(size.x, 1)
        const viewHeight = currentViewMode === 'top2d' ? Math.max(size.z, 1) : Math.max(size.y, 1)
        const availableW = Math.max(Math.abs(camera.right - camera.left), 1)
        const availableH = Math.max(Math.abs(camera.top - camera.bottom), 1)
        camera.zoom = Math.max(0.3, Math.min(4, Math.min(availableW / (viewWidth * 1.55), availableH / (viewHeight * 1.55))))
        camera.updateProjectionMatrix()
      }
      controls.update()
      renderer.render(scene, camera)
    }

    const frameAll = () => {
      const box = new THREE.Box3()
      pickables.forEach((obj) => box.expandByObject(obj))
      frameBox(box)
    }

    const focusSelected = () => frameBox(objectBox(selectedKey))

    const applyObjectTransforms = (transforms = {}) => {
      Object.entries(transforms).forEach(([k, t]) => {
        const obj = objects[k]
        if (!obj || !t) return
        obj.position.set(t.x ?? obj.position.x, t.y ?? obj.position.y, t.z ?? obj.position.z)
        if (Number.isFinite(t.rotY)) obj.rotation.y = THREE.MathUtils.degToRad(t.rotY)
      })
      if (objects[selectedKey]) {
        gizmo.position.copy(objects[selectedKey].position)
        boxHelper?.update()
        selectedLabel?.position.set(objects[selectedKey].position.x, objects[selectedKey].position.y + 1.8, objects[selectedKey].position.z)
      }
    }
    applyObjectTransforms(options.objectTransforms || {})

    const onPointerDown = (event) => {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickables, true).find((h) => h.object?.userData?.objectKey || h.object?.parent?.userData?.objectKey)
      if (!hit && !['move', 'rotate', 'scale'].includes(currentToolMode)) return
      let hitKey = hit ? (hit.object.userData.objectKey || hit.object.parent.userData.objectKey) : selectedKey
      if (!hitKey || !objects[hitKey]) return
      const selectedTarget = objects[selectedKey]
      const hitTarget = objects[hitKey]
      if (['move', 'rotate', 'scale'].includes(currentToolMode) && hitTarget?.userData?.stageLocked && selectedTarget && !selectedTarget.userData?.stageLocked) {
        hitKey = selectedKey
      }
      setSelectedKey(hitKey, { notify: true })
      const target = objects[hitKey]
      if (!target || target.userData?.stageLocked || !['move', 'rotate', 'scale'].includes(currentToolMode)) return
      drag.active = true
      drag.mode = currentToolMode
      drag.key = hitKey
      drag.pointerId = event.pointerId
      drag.startX = event.clientX
      drag.startRotY = THREE.MathUtils.radToDeg(target.rotation.y || 0)
      drag.startScale.copy(target.scale || new THREE.Vector3(1, 1, 1))
      drag.startSize = objectMeta[hitKey]?.size || [1, 1, 1]
      drag.scaleFactor = 1
      if (currentToolMode === 'move') {
        drag.plane.set(new THREE.Vector3(0, 1, 0), -target.position.y)
        raycaster.ray.intersectPlane(drag.plane, drag.point)
        drag.offset.copy(target.position).sub(drag.point)
      }
      controls.enabled = false
      event.preventDefault()
      renderer.domElement.setPointerCapture?.(event.pointerId)
    }
    const onPointerMove = (event) => {
      if (!drag.active) return
      const target = objects[drag.key]
      if (!target) return
      const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      if (drag.mode === 'move') {
        if (!raycaster.ray.intersectPlane(drag.plane, drag.point)) return
        target.position.x = snapNumber(drag.point.x + drag.offset.x)
        target.position.z = snapNumber(drag.point.z + drag.offset.z)
      }
      if (drag.mode === 'rotate') {
        const nextRot = drag.startRotY + ((event.clientX - drag.startX) * 0.35)
        target.rotation.y = THREE.MathUtils.degToRad(snapNumber(nextRot))
      }
      if (drag.mode === 'scale') {
        drag.scaleFactor = Math.max(0.2, Math.min(4, 1 + ((event.clientX - drag.startX) / 180)))
        target.scale.set(drag.startScale.x * drag.scaleFactor, drag.startScale.y * drag.scaleFactor, drag.startScale.z * drag.scaleFactor)
      }
      gizmo.position.copy(target.position)
      boxHelper?.update()
      selectedLabel?.position.set(target.position.x, target.position.y + 1.8, target.position.z)
      renderer.render(scene, camera)
    }
    const onPointerUp = (event) => {
      if (!drag.active) return
      const target = objects[drag.key]
      drag.active = false
      controls.enabled = true
      renderer.domElement.releasePointerCapture?.(event.pointerId || drag.pointerId)
      if (target) {
        const transform = drag.mode === 'rotate'
          ? { rotY: THREE.MathUtils.radToDeg(target.rotation.y || 0) }
          : drag.mode === 'scale'
            ? {
                width: Math.max(0.05, Number(drag.startSize[0] || 1) * drag.scaleFactor),
                height: Math.max(0.05, Number(drag.startSize[1] || 1) * drag.scaleFactor),
                depth: Math.max(0.05, Number(drag.startSize[2] || 1) * drag.scaleFactor)
              }
            : { x: target.position.x, y: target.position.y, z: target.position.z }
        options.onTransformObject?.(drag.key, transform)
      }
      drag.mode = ''
    }
    const onKeyDown = (event) => {
      const obj = objects[selectedKey]; if (!obj) return
      if (obj.userData.stageLocked) return
      const step = event.shiftKey ? 2 : event.altKey ? 0.25 : currentSnapEnabled ? currentSnapInterval : 0.5
      const axis = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['z', -1], ArrowDown: ['z', 1], PageUp: ['y', 1], PageDown: ['y', -1] }[event.key]
      if (!axis) return
      event.preventDefault(); obj.position[axis[0]] += step * axis[1]; if (axis[0] !== 'y') obj.position[axis[0]] = snapNumber(obj.position[axis[0]]); gizmo.position.copy(obj.position); boxHelper?.update(); selectedLabel?.position.set(obj.position.x, obj.position.y + 1.8, obj.position.z)
      options.onTransformObject?.(selectedKey, { x: obj.position.x, y: obj.position.y, z: obj.position.z })
    }
    const statusOverlay = document.createElement('div')
    statusOverlay.className = 'stage-three-runtime-status'
    const diagnosticsEnabled = SHOW_VIEWPORT_DIAGNOSTICS || !!options.showDiagnostics
    statusOverlay.hidden = !diagnosticsEnabled
    container.appendChild(statusOverlay)
    const writeStatus = (message = '') => {
      const canvas = renderer.domElement
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2())
      const projectState = options.projectLoadStatus || (options.project ? 'loaded' : 'fallback')
      const camDetails = camera?.isPerspectiveCamera
        ? `Perspective aspect ${formatNum(camera.aspect)}`
        : `Ortho l/r/t/b ${formatNum(camera.left)}/${formatNum(camera.right)}/${formatNum(camera.top)}/${formatNum(camera.bottom)} z ${formatNum(camera.zoom)}`
      const base = `Viewport ${container.clientWidth}x${container.clientHeight} | Canvas ${canvas?.clientWidth || 0}x${canvas?.clientHeight || 0} | Buffer ${buf.x}x${buf.y} | Scene ${scene.children.length} | Objects ${Object.keys(objects).length} | Project ${projectState} | ${camDetails} @ ${formatNum(camera.position.x, 1)},${formatNum(camera.position.y, 1)},${formatNum(camera.position.z, 1)}`
      if (!diagnosticsEnabled) return
      statusOverlay.textContent = message ? `${base} | ${message}` : `${base} | Render loop: running`
    }
    const onResize = () => {
      const w = container.clientWidth || 0
      const h = container.clientHeight || 0
      if (w < 2 || h < 2) {
        statusOverlay.hidden = !diagnosticsEnabled
        writeStatus(`Viewport size is ${w}x${h}`)
        return
      }
      statusOverlay.hidden = !diagnosticsEnabled
      if (camera.isPerspectiveCamera) camera.aspect = w / h
      if (camera.isOrthographicCamera) setOrthoBounds(camera, currentViewMode === 'front' || currentViewMode === 'side' ? 20 : 24, w / h)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      renderer.render(scene, camera)
      writeStatus()
    }
    const ro = new ResizeObserver(onResize); ro.observe(container)

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)
    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('pointerdown', () => container.focus())
    if (FORCE_STAGE_VIEWPORT_SMOKE_TEST) {
      scene.clear()
      scene.add(new THREE.AmbientLight('#ffffff', 0.9))
      const dl = new THREE.DirectionalLight('#ffffff', 0.8); dl.position.set(8, 12, 6); scene.add(dl)
      const box = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 4), new THREE.MeshStandardMaterial({ color: '#4c5c73' })); box.position.y = 0.5; scene.add(box)
      scene.add(new THREE.GridHelper(40, 40, '#2f3d54', '#1b2230'))
    }
    setSelectedKey(options.selectedObjectKey || selectedKey, { notify: false }); requestAnimationFrame(onResize); console.info('[stageThreeViewport] mounted', { projectId: options.project?.id, selectedObjectKey: selectedKey, sceneChildren: scene.children.length })
    let raf = 0
    let disposed = false
    let loggedFirstRender = false
    const animate = () => { if (disposed) return; raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); if (!loggedFirstRender) { loggedFirstRender = true; console.info('[stageThreeViewport] first render complete'); writeStatus() } }
    animate()

    const update = (nextOptions = {}) => {
      if (nextOptions.viewportMode) setViewMode(nextOptions.viewportMode)
      if (typeof nextOptions.showGrid === 'boolean') gridHelper.visible = nextOptions.showGrid
      if (typeof nextOptions.showBeams === 'boolean') currentShowBeams = nextOptions.showBeams
      if (typeof nextOptions.showLabels === 'boolean') currentShowLabels = nextOptions.showLabels
      if (typeof nextOptions.snapEnabled === 'boolean') currentSnapEnabled = nextOptions.snapEnabled
      if (Number.isFinite(Number(nextOptions.snapInterval))) currentSnapInterval = Number(nextOptions.snapInterval)
      if (typeof nextOptions.toolMode === 'string') {
        currentToolMode = nextOptions.toolMode || 'select'
        syncSelection()
      }
      if (nextOptions.renderMode) {
        currentRenderMode = nextOptions.renderMode
      }
      beams.visible = currentShowBeams && currentRenderMode !== 'simple' && currentRenderMode !== 'export-clean'
      labelSprites.forEach((sprite) => { sprite.visible = currentShowLabels && currentRenderMode !== 'export-clean' })
      if (nextOptions.objectTransforms) applyObjectTransforms(nextOptions.objectTransforms)
      if (typeof nextOptions.selectedObjectKey === 'string') setSelectedKey(nextOptions.selectedObjectKey, { notify: false })
      renderer.render(scene, camera)
      writeStatus('Updated viewport options')
    }

    const dispose = () => {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('keydown', onKeyDown)
      controls.dispose()
      scene.traverse((obj) => { if (obj.geometry?.dispose) obj.geometry.dispose(); const mat = obj.material; if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.()); else mat?.dispose?.(); if (obj.material?.map?.dispose) obj.material.map.dispose() })
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      console.info('[stageThreeViewport] disposed')
    }

    return { dispose, update, focusSelected, frameAll }
  } catch (error) {
    console.error('[stageThreeViewport] mount failed', error)
    container.classList.add('is-three-error')
    container.innerHTML = '<div class="stage-three-error-panel"><p class="stage-three-error-code">RENDER STATUS: ERROR</p><p>3D viewport could not initialize.</p><p>Rendering error. Refresh the page or check console details.</p></div>'
    return () => {}
  }
}
