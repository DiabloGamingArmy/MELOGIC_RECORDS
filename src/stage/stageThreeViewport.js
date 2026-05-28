import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createDefaultStagePlan } from './stagePlanModel'
const FORCE_STAGE_VIEWPORT_SMOKE_TEST = false
const SHOW_VIEWPORT_DIAGNOSTICS = Boolean(import.meta?.env?.DEV)

const defaultStagePlan = () => createDefaultStagePlan({ id: 'viewport-fallback', name: 'Viewport Fallback' })

const objectDefsFromProject = (project = {}) => {
  const source = Array.isArray(project.objects) ? project.objects : defaultStagePlan().objects
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
    const deckDef = stageObjectDefs.find((d) => d.key === 'stage-deck' && d.visible !== false)
    const deckWidth = Number(stageDimensions.width || deckDef?.size?.[0] || 32)
    const deckDepth = Number(stageDimensions.depth || deckDef?.size?.[2] || 24)
    const deckHeight = Number(stageDimensions.deckHeight || deckDef?.size?.[1] || 1)
    const pickables = []
    const objects = {}
    const objectMeta = Object.fromEntries(stageObjectDefs.map((d) => [d.key, d]))
    const addPickable = (mesh, key) => { mesh.userData.objectKey = key; mesh.userData.stageLocked = !!objectMeta[key]?.locked; pickables.push(mesh); objects[key] = mesh }
    const materialColorFor = (d) => d.color || (d.type === 'speaker' ? '#365875' : d.category === 'rigging' ? '#6762d2' : d.category === 'lighting' ? '#49c8ff' : d.category === 'video' ? '#4fc8b4' : d.category === 'audio' ? '#2d4059' : d.category === 'power' ? '#ffb86b' : '#222b39')
    const geometryFor = (d) => {
      if (d.type?.includes('cylinder') || d.type === 'microphone') return new THREE.CylinderGeometry(Math.max(0.12, d.size[0] / 2), Math.max(0.12, d.size[0] / 2), Math.max(0.2, d.size[1]), 18)
      if (d.type?.includes('circle')) return new THREE.CylinderGeometry(Math.max(0.2, d.size[0] / 2), Math.max(0.2, d.size[0] / 2), Math.max(0.12, d.size[1]), 32)
      return new THREE.BoxGeometry(...d.size)
    }

    if (deckDef) {
      const deckGroup = new THREE.Group(); deckGroup.name = 'stage-deck-group'; deckGroup.userData.objectKey = 'stage-deck'
      deckGroup.position.set(Number(deckDef.position?.[0] || 0), 0, Number(deckDef.position?.[2] || 0))
      deckGroup.rotation.set(THREE.MathUtils.degToRad(deckDef.rotation?.x || 0), THREE.MathUtils.degToRad(deckDef.rotation?.y || 0), THREE.MathUtils.degToRad(deckDef.rotation?.z || 0))
      const deckY = Number(deckDef.position?.[1] ?? 0.5)
      const top = new THREE.Mesh(new THREE.BoxGeometry(deckWidth, Math.max(0.42, deckDef.size?.[1] || deckHeight * 0.18), deckDepth), new THREE.MeshStandardMaterial({ color: deckDef.color || '#2b2f37', roughness: 0.72, metalness: 0.16 }))
      top.position.y = deckY + 0.36
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(deckWidth + 0.3, 0.46, deckDepth + 0.3), new THREE.MeshStandardMaterial({ color: '#12161f', roughness: 0.9, metalness: 0.12 }))
      skirt.position.y = deckY - 0.15
      const frontLip = new THREE.Mesh(new THREE.BoxGeometry(deckWidth + 0.35, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: '#4e6576' }))
      frontLip.position.set(0, deckY + 0.74, deckDepth / 2 + 0.12)
      deckGroup.add(top, skirt, frontLip)
      for (let x = -deckWidth / 2 + 2; x <= deckWidth / 2 - 2; x += Math.max(6, deckWidth / 4)) for (let z = -deckDepth / 2 + 3; z <= deckDepth / 2 - 3; z += Math.max(5, deckDepth / 4)) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.44, 2.6, 0.44), new THREE.MeshStandardMaterial({ color: '#0f131b', roughness: 0.92 }))
        leg.position.set(x, deckY - 1.55, z)
        deckGroup.add(leg)
      }
      scene.add(deckGroup)
      addPickable(deckGroup, 'stage-deck')
    }

    stageObjectDefs.filter((d) => d.key !== 'stage-deck' && d.visible !== false).forEach((d) => {
      const mesh = new THREE.Mesh(geometryFor(d), new THREE.MeshStandardMaterial({ color: materialColorFor(d), roughness: 0.72, metalness: 0.22 }))
      mesh.position.set(...d.position)
      mesh.rotation.set(THREE.MathUtils.degToRad(d.rotation?.x || 0), THREE.MathUtils.degToRad(d.rotation?.y || 0), THREE.MathUtils.degToRad(d.rotation?.z || 0))
      if (d.key === 'camera-1' && !d.rotation?.z) mesh.rotation.z = Math.PI / 2
      scene.add(mesh)
      addPickable(mesh, d.key)
    })

    const labelSprites = []
    const line = (points, color) => {
      const helper = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color }))
      helper.userData.generatedAnnotation = true
      scene.add(helper)
      return helper
    }
    if (deckDef) {
      const deckY = Number(deckDef.position?.[1] ?? 0.5)
      line([[0, deckY + 0.65, deckDepth / 2], [0, deckY + 0.65, deckDepth / 2 + 18]], '#5dd9ff')
      line([[-deckWidth / 2, deckY + 0.67, deckDepth / 2 + 0.8], [deckWidth / 2, deckY + 0.67, deckDepth / 2 + 0.8]], '#57d4ff')
      line([[0, deckY + 0.65, -deckDepth / 2], [0, deckY + 0.65, -deckDepth / 2 - 8]], '#6b8aff')
      labelSprites.push(
        makeLabel(`${formatNum(deckWidth, 0)}' x ${formatNum(deckDepth, 0)}' Stage Deck`, [-deckWidth / 2 + 2, deckY + 2.3, deckDepth / 2 + 2], '#6bdcff'),
        makeLabel('Downstage Centerline', [0, deckY + 2.1, deckDepth / 2 + 8], '#61d7ff'),
        makeLabel('DSC', [-deckWidth / 2 + 2, deckY + 2, deckDepth / 2], '#ffb16d'),
        makeLabel('USC', [0, deckY + 2, -deckDepth / 2 + 1], '#ffb16d'),
        makeLabel('Stage Left', [-deckWidth / 2 - 4, deckY + 1.7, deckDepth / 2 + 3], '#ffb16d'),
        makeLabel('Stage Right', [deckWidth / 2 + 4, deckY + 1.7, deckDepth / 2 + 3], '#ffb16d')
      )
    }
    labelSprites.forEach((sprite) => { sprite.visible = options.showLabels !== false; scene.add(sprite) })

    const beams = new THREE.Group()
    const beamSources = Array.isArray(options.project?.fixtures) && options.project.fixtures.length
      ? options.project.fixtures.map((fixture) => ({ pos: [fixture.position?.x || 0, fixture.position?.y || 8, fixture.position?.z || -8], target: Array.isArray(fixture.target) ? fixture.target : [fixture.target?.x || 0, fixture.target?.y || 1.2, fixture.target?.z || 0], color: fixture.color || '#61dcff', angle: fixture.beamAngle || 24 }))
      : []
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
    let boxHelpers = []
    let selectedLabel = null
    const initialSelectedKeys = (Array.isArray(options.selectedObjectKeys) && options.selectedObjectKeys.length ? options.selectedObjectKeys : [options.selectedObjectKey]).filter((key) => key && objects[key])
    let selectedKeys = [...new Set(initialSelectedKeys)]
    let selectedKey = selectedKeys[0] || (objects[options.selectedObjectKey] ? options.selectedObjectKey : objects['stage-deck'] ? 'stage-deck' : Object.keys(objects)[0] || '')

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
    const marqueeEl = document.createElement('div')
    marqueeEl.className = 'stage-select-marquee'
    marqueeEl.hidden = true
    container.appendChild(marqueeEl)
    const marquee = {
      active: false,
      pointerId: 0,
      hitKey: '',
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      additive: false,
      subtractive: false,
      moved: false
    }
    const pointerToNdc = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      return rect
    }
    const selectionRectFromMarquee = () => ({
      left: Math.min(marquee.startX, marquee.currentX),
      right: Math.max(marquee.startX, marquee.currentX),
      top: Math.min(marquee.startY, marquee.currentY),
      bottom: Math.max(marquee.startY, marquee.currentY)
    })
    const updateMarqueeElement = () => {
      const rect = selectionRectFromMarquee()
      const bounds = container.getBoundingClientRect()
      marqueeEl.style.left = `${rect.left - bounds.left}px`
      marqueeEl.style.top = `${rect.top - bounds.top}px`
      marqueeEl.style.width = `${Math.max(1, rect.right - rect.left)}px`
      marqueeEl.style.height = `${Math.max(1, rect.bottom - rect.top)}px`
    }
    const hideMarquee = () => {
      marquee.active = false
      marquee.moved = false
      marqueeEl.hidden = true
      controls.enabled = true
    }
    const rectsIntersect = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
    const screenBoxForObject = (object) => {
      const canvasRect = renderer.domElement.getBoundingClientRect()
      const box = new THREE.Box3().setFromObject(object)
      if (box.isEmpty()) return null
      const min = box.min
      const max = box.max
      const points = [
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(min.x, min.y, max.z),
        new THREE.Vector3(min.x, max.y, min.z),
        new THREE.Vector3(min.x, max.y, max.z),
        new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3(max.x, max.y, min.z),
        new THREE.Vector3(max.x, max.y, max.z)
      ].map((point) => point.project(camera)).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      if (!points.length) return null
      const xs = points.map((point) => canvasRect.left + ((point.x + 1) / 2) * canvasRect.width)
      const ys = points.map((point) => canvasRect.top + ((-point.y + 1) / 2) * canvasRect.height)
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
    }
    const keysInsideMarquee = () => {
      const rect = selectionRectFromMarquee()
      return pickables
        .map((object) => ({ key: object.userData.objectKey, box: screenBoxForObject(object) }))
        .filter(({ key, box }) => key && box && rectsIntersect(rect, box))
        .map(({ key }) => key)
    }
    const clearBoxHelpers = () => {
      boxHelpers.forEach((helper) => helper.removeFromParent())
      boxHelpers = []
    }
    const syncSelection = () => {
      pickables.forEach((m) => {
        const active = selectedKeys.includes(m.userData.objectKey)
        if (m.material?.emissive) { m.material.emissive.set(active ? '#1ca8a3' : '#000000'); m.material.emissiveIntensity = active ? 0.3 : 0 }
      })
      const target = objects[selectedKey]
      clearBoxHelpers()
      selectedLabel?.removeFromParent()
      selectedLabel = null
      if (!target) {
        gizmo.visible = false
        return
      }
      gizmo.visible = currentToolMode === 'move' && !target.userData.stageLocked
      gizmo.position.copy(target.position)
      selectedKeys.forEach((key, index) => {
        const object = objects[key]
        if (!object) return
        const helper = new THREE.BoxHelper(object, index === 0 ? '#5ce9ff' : '#7ba7ff')
        boxHelpers.push(helper)
        scene.add(helper)
      })
      const label = objectMeta[target.userData.objectKey]?.label || target.userData.objectKey
      try { selectedLabel = makeLabel(label, [target.position.x, target.position.y + 1.8, target.position.z], '#6bdcff'); scene.add(selectedLabel) } catch (e) { console.warn('[stageThreeViewport] label render skipped', e) }
    }
    const setSelectedKeys = (nextKeys = [], { notify = false, primary = '' } = {}) => {
      const clean = [...new Set((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).filter((key) => key && objects[key]))]
      const nextPrimary = primary && clean.includes(primary) ? primary : clean[0] || ''
      const ordered = nextPrimary ? [nextPrimary, ...clean.filter((key) => key !== nextPrimary)] : clean
      const changed = ordered.join('|') !== selectedKeys.join('|') || nextPrimary !== selectedKey
      selectedKeys = ordered
      selectedKey = nextPrimary
      syncSelection()
      if (notify && changed) {
        if (options.onSelectObjects) options.onSelectObjects(selectedKeys, selectedKey)
        else if (selectedKey) options.onSelectObject?.(selectedKey)
      }
    }
    const setSelectedKey = (nextKey, { notify = false } = {}) => {
      if (!nextKey || !objects[nextKey]) {
        setSelectedKeys([], { notify })
        return
      }
      setSelectedKeys([nextKey], { notify, primary: nextKey })
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

    const focusSelected = () => selectedKey ? frameBox(objectBox(selectedKey)) : frameAll()

    const applyObjectTransforms = (transforms = {}) => {
      Object.entries(transforms).forEach(([k, t]) => {
        const obj = objects[k]
        if (!obj || !t) return
        obj.position.set(t.x ?? obj.position.x, t.y ?? obj.position.y, t.z ?? obj.position.z)
        if (Number.isFinite(t.rotY)) obj.rotation.y = THREE.MathUtils.degToRad(t.rotY)
      })
      if (objects[selectedKey]) {
        gizmo.position.copy(objects[selectedKey].position)
        boxHelpers.forEach((helper) => helper.update())
        selectedLabel?.position.set(objects[selectedKey].position.x, objects[selectedKey].position.y + 1.8, objects[selectedKey].position.z)
      }
    }
    applyObjectTransforms(options.objectTransforms || {})

    const onPointerDown = (event) => {
      pointerToNdc(event)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickables, true).find((h) => h.object?.userData?.objectKey || h.object?.parent?.userData?.objectKey)
      const pointerHitKey = hit ? (hit.object.userData.objectKey || hit.object.parent.userData.objectKey) : ''
      if (currentToolMode === 'pan') return
      if (currentToolMode === 'select') {
        marquee.active = true
        marquee.pointerId = event.pointerId
        marquee.hitKey = pointerHitKey
        marquee.startX = event.clientX
        marquee.startY = event.clientY
        marquee.currentX = event.clientX
        marquee.currentY = event.clientY
        marquee.additive = !!event.shiftKey
        marquee.subtractive = !!event.altKey
        marquee.moved = false
        controls.enabled = false
        event.preventDefault()
        event.stopImmediatePropagation?.()
        renderer.domElement.setPointerCapture?.(event.pointerId)
        return
      }
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
      event.stopImmediatePropagation?.()
      renderer.domElement.setPointerCapture?.(event.pointerId)
    }
    const onPointerMove = (event) => {
      if (marquee.active) {
        marquee.currentX = event.clientX
        marquee.currentY = event.clientY
        marquee.moved = marquee.moved || Math.hypot(marquee.currentX - marquee.startX, marquee.currentY - marquee.startY) > 5
        if (marquee.moved) {
          marqueeEl.hidden = false
          updateMarqueeElement()
        }
        event.preventDefault()
        return
      }
      if (!drag.active) return
      const target = objects[drag.key]
      if (!target) return
      pointerToNdc(event)
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
      boxHelpers.forEach((helper) => helper.update())
      selectedLabel?.position.set(target.position.x, target.position.y + 1.8, target.position.z)
      renderer.render(scene, camera)
    }
    const onPointerUp = (event) => {
      if (marquee.active) {
        marquee.currentX = event.clientX
        marquee.currentY = event.clientY
        renderer.domElement.releasePointerCapture?.(event.pointerId || marquee.pointerId)
        let nextKeys = []
        if (marquee.moved) {
          const hits = keysInsideMarquee()
          if (marquee.additive) nextKeys = [...selectedKeys, ...hits]
          else if (marquee.subtractive) nextKeys = selectedKeys.filter((key) => !hits.includes(key))
          else nextKeys = hits
        } else if (marquee.hitKey && objects[marquee.hitKey]) {
          if (marquee.additive) nextKeys = selectedKeys.includes(marquee.hitKey) ? selectedKeys : [...selectedKeys, marquee.hitKey]
          else if (marquee.subtractive) nextKeys = selectedKeys.filter((key) => key !== marquee.hitKey)
          else nextKeys = [marquee.hitKey]
        } else {
          nextKeys = marquee.additive || marquee.subtractive ? selectedKeys : []
        }
        const primary = nextKeys[0] || ''
        hideMarquee()
        setSelectedKeys(nextKeys, { notify: true, primary })
        renderer.render(scene, camera)
        return
      }
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
      if (event.key === 'Escape' && marquee.active) {
        event.preventDefault()
        hideMarquee()
        return
      }
      const obj = objects[selectedKey]; if (!obj) return
      if (obj.userData.stageLocked) return
      const step = event.shiftKey ? 2 : event.altKey ? 0.25 : currentSnapEnabled ? currentSnapInterval : 0.5
      const axis = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['z', -1], ArrowDown: ['z', 1], PageUp: ['y', 1], PageDown: ['y', -1] }[event.key]
      if (!axis) return
      event.preventDefault(); obj.position[axis[0]] += step * axis[1]; if (axis[0] !== 'y') obj.position[axis[0]] = snapNumber(obj.position[axis[0]]); gizmo.position.copy(obj.position); boxHelpers.forEach((helper) => helper.update()); selectedLabel?.position.set(obj.position.x, obj.position.y + 1.8, obj.position.z)
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

    renderer.domElement.addEventListener('pointerdown', onPointerDown, { capture: true })
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
    setSelectedKeys(selectedKeys.length ? selectedKeys : [options.selectedObjectKey || selectedKey].filter(Boolean), { notify: false, primary: options.selectedObjectKey || selectedKey }); requestAnimationFrame(onResize); console.info('[stageThreeViewport] mounted', { projectId: options.project?.id, selectedObjectKey: selectedKey, sceneChildren: scene.children.length })
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
      if (Array.isArray(nextOptions.selectedObjectKeys)) setSelectedKeys(nextOptions.selectedObjectKeys, { notify: false, primary: nextOptions.selectedObjectKey })
      else if (typeof nextOptions.selectedObjectKey === 'string') setSelectedKey(nextOptions.selectedObjectKey, { notify: false })
      renderer.render(scene, camera)
      writeStatus('Updated viewport options')
    }

    const dispose = () => {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, { capture: true })
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('keydown', onKeyDown)
      controls.dispose()
      scene.traverse((obj) => { if (obj.geometry?.dispose) obj.geometry.dispose(); const mat = obj.material; if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.()); else mat?.dispose?.(); if (obj.material?.map?.dispose) obj.material.map.dispose() })
      renderer.dispose()
      marqueeEl.remove()
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
