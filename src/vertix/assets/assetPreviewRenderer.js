import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getDownloadURL, ref } from 'firebase/storage'
import { storage } from '../../firebase/storage'

let disposeCurrent = () => {}
const gltfCache = new Map()

function primitiveGeometry(type = '') {
  if (type === 'primitive-plane') return new THREE.BoxGeometry(2.7, 0.05, 2.7)
  if (type === 'primitive-uv-sphere') return new THREE.SphereGeometry(1.2, 32, 20)
  if (type === 'primitive-icosphere') return new THREE.IcosahedronGeometry(1.2, 2)
  if (type === 'primitive-cylinder') return new THREE.CylinderGeometry(1, 1, 2.3, 32)
  if (type === 'primitive-cone') return new THREE.ConeGeometry(1.15, 2.4, 32)
  if (type === 'primitive-torus') return new THREE.TorusGeometry(1.15, 0.38, 18, 48)
  return new THREE.BoxGeometry(2, 2, 2)
}

async function previewObject(asset) {
  if (asset?.preview?.sourceUri && storage) {
    const key = `${asset.id}:${asset.preview.sourceUri}`
    if (!gltfCache.has(key)) {
      gltfCache.set(key, getDownloadURL(ref(storage, asset.preview.sourceUri)).then((url) => new Promise((resolve, reject) => new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject))))
    }
    try { return (await gltfCache.get(key)).clone(true) } catch {}
  }
  return new THREE.Mesh(primitiveGeometry(asset?.type), new THREE.MeshStandardMaterial({ color: asset?.metadata?.color || '#7187a8', roughness: 0.62, metalness: 0.15 }))
}

function frameObject(object, camera) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  object.position.sub(center)
  const max = Math.max(0.1, size.x, size.y, size.z)
  camera.position.set(max * 1.7, max * 1.25, max * 1.8)
  camera.near = Math.max(0.01, max / 100)
  camera.far = max * 20
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
}

function previewScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0d121b')
  scene.add(new THREE.HemisphereLight('#dbe8ff', '#182230', 1.55))
  const light = new THREE.DirectionalLight('#ffffff', 2.1); light.position.set(5, 7, 6); scene.add(light)
  return scene
}

async function renderCards(root, registry, disposed) {
  const canvases = [...root.querySelectorAll('[data-vertix-preview-id]')]
  if (!canvases.length) return
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(1)
  renderer.setSize(96, 96, false)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100)
  for (const canvas of canvases) {
    if (disposed()) break
    const asset = registry.getAsset(canvas.dataset.vertixPreviewId)
    if (!asset) continue
    const scene = previewScene()
    const object = await previewObject(asset)
    scene.add(object)
    object.rotation.set(-0.16, 0.62, 0)
    frameObject(object, camera)
    renderer.render(scene, camera)
    canvas.width = 96; canvas.height = 96
    canvas.getContext('2d')?.drawImage(renderer.domElement, 0, 0, 96, 96)
    if (!asset.preview?.sourceUri) object.traverse((node) => { node.geometry?.dispose?.(); node.material?.dispose?.() })
  }
  renderer.dispose()
}

async function mountDetail(container, asset, disposed) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1))
  renderer.setSize(Math.max(220, container.clientWidth), Math.max(120, container.clientHeight), false)
  container.replaceChildren(renderer.domElement)
  const scene = previewScene()
  const camera = new THREE.PerspectiveCamera(38, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.01, 1000)
  const object = await previewObject(asset)
  if (disposed()) { renderer.dispose(); return () => {} }
  scene.add(object)
  frameObject(object, camera)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false
  controls.target.set(0, 0, 0)
  controls.update()
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  let frame = 0
  let last = performance.now()
  const animate = (time) => {
    if (disposed()) return
    frame = requestAnimationFrame(animate)
    if (!reduced && time - last > 16) { object.rotation.y += 0.0018 * (time - last); last = time }
    controls.update()
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(animate)
  return () => { cancelAnimationFrame(frame); controls.dispose(); renderer.dispose(); container.replaceChildren() }
}

/** One shared thumbnail renderer plus at most one interactive detail context. */
export function mountVertixAssetPreviews(root, registry) {
  disposeCurrent()
  let dead = false
  let disposeDetail = () => {}
  const disposed = () => dead
  renderCards(root, registry, disposed).catch(() => {})
  const detail = root.querySelector('[data-vertix-detail-preview]')
  const asset = detail ? registry.getAsset(detail.dataset.vertixDetailPreview) : null
  if (detail && asset) mountDetail(detail, asset, disposed).then((dispose) => { if (dead) dispose(); else disposeDetail = dispose }).catch(() => {})
  disposeCurrent = () => { dead = true; disposeDetail() }
  return disposeCurrent
}
