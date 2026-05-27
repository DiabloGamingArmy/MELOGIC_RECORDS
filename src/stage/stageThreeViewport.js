import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const OBJECT_KEYS = ['stage-deck', 'drum-riser', 'truss-a', 'speaker-left', 'speaker-right', 'camera-1']

export function mountStageThreeViewport(container, options = {}) {
  try {
    container.classList.remove('is-three-error')
    container.innerHTML = ''
    container.setAttribute('tabindex', '0')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#09101b')
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300)
    camera.position.set(16, 12, 18)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.AmbientLight('#9ab4ff', 0.7))
    const key = new THREE.DirectionalLight('#d9f5ff', 1.1); key.position.set(9, 14, 8); scene.add(key)
    scene.add(new THREE.GridHelper(48, 48, '#4b607f', '#2b3750'))
    const pickables = []
    const make = (k, geo, mat, p) => { const m = new THREE.Mesh(geo, mat); m.position.copy(p); m.userData.objectKey = k; scene.add(m); pickables.push(m); return m }
    const objects = {
      'stage-deck': make('stage-deck', new THREE.BoxGeometry(16, 1, 12), new THREE.MeshStandardMaterial({ color: '#294a63' }), new THREE.Vector3(0, 0.5, 0)),
      'drum-riser': make('drum-riser', new THREE.BoxGeometry(4, 0.6, 4), new THREE.MeshStandardMaterial({ color: '#3d4e68' }), new THREE.Vector3(0, 1.1, -2)),
      'truss-a': make('truss-a', new THREE.BoxGeometry(14, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#6558a8' }), new THREE.Vector3(0, 6, -4)),
      'speaker-left': make('speaker-left', new THREE.BoxGeometry(1.6, 3, 1.6), new THREE.MeshStandardMaterial({ color: '#232b39' }), new THREE.Vector3(-9, 1.5, -1)),
      'speaker-right': make('speaker-right', new THREE.BoxGeometry(1.6, 3, 1.6), new THREE.MeshStandardMaterial({ color: '#232b39' }), new THREE.Vector3(9, 1.5, -1)),
      'camera-1': make('camera-1', new THREE.ConeGeometry(0.6, 1.6, 8), new THREE.MeshStandardMaterial({ color: '#2fae94' }), new THREE.Vector3(0, 0.8, 11))
    }
    objects['camera-1'].rotation.x = Math.PI / 2
    const axes = new THREE.AxesHelper(2.5); axes.visible = false; scene.add(axes)
    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let selectedKey = options.selectedObjectKey || 'stage-deck'
    const applyTransforms = () => { const transforms = options.objectTransforms || {}; OBJECT_KEYS.forEach((k) => { const mesh = objects[k]; const t = transforms[k]; if (mesh && t) mesh.position.set(t.x ?? mesh.position.x, t.y ?? mesh.position.y, t.z ?? mesh.position.z) }) }
    const syncSelection = () => { pickables.forEach((m) => { const active = m.userData.objectKey === selectedKey; m.material.emissive = new THREE.Color(active ? '#1ca8a3' : '#000000'); m.material.emissiveIntensity = active ? 0.45 : 0 }); const target = objects[selectedKey]; if (target) { axes.visible = true; axes.position.copy(target.position) } else axes.visible = false }
    const onPointerDown = (event) => { const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(pickables)[0]; if (!hit?.object) return; selectedKey = hit.object.userData.objectKey; syncSelection(); options.onSelectObject?.(selectedKey) }
    const onKeyDown = (event) => { const obj = objects[selectedKey]; if (!obj) return; const step = event.shiftKey ? 0.5 : 0.15; let moved = false; if (event.key === 'ArrowLeft') { obj.position.x -= step; moved = true } if (event.key === 'ArrowRight') { obj.position.x += step; moved = true } if (event.key === 'ArrowUp') { obj.position.z -= step; moved = true } if (event.key === 'ArrowDown') { obj.position.z += step; moved = true } if (event.key === 'PageUp') { obj.position.y += step; moved = true } if (event.key === 'PageDown') { obj.position.y -= step; moved = true } if (!moved) return; event.preventDefault(); axes.position.copy(obj.position); options.onTransformObject?.(selectedKey, { x: obj.position.x, y: obj.position.y, z: obj.position.z }) }
    const onResize = () => { const w = Math.max(container.clientWidth, 10); const h = Math.max(container.clientHeight, 10); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false) }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('pointerdown', () => container.focus())
    window.addEventListener('resize', onResize)
    applyTransforms(); syncSelection(); onResize()
    let raf = 0; const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }; animate()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); renderer.domElement.removeEventListener('pointerdown', onPointerDown); container.removeEventListener('keydown', onKeyDown); controls.dispose(); renderer.dispose(); container.innerHTML = '' }
  } catch (error) {
    console.error('[stageThreeViewport] mount failed', error)
    container.classList.add('is-three-error')
    container.innerHTML = '<div class="stage-three-error-panel"><p>3D viewport could not initialize.</p><p>Check browser WebGL support.</p></div>'
    return () => {}
  }
}
