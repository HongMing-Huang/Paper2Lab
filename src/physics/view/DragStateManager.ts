// DragStateManager — ported from zalo/mujoco_wasm@f6b202ca… src/utils/
// DragStateManager.js (raycast pick → bodyID, world-hit anchor, drag arrow).
// Used by the physics lab to feed mj_applyFT with a spring force at the
// grabbed point (the upstream interaction model).
import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class DragStateManager {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  mousePos = new THREE.Vector2()
  raycaster = new THREE.Raycaster()
  private lastX = 0
  private lastY = 0
  grabDistance = 0.0
  active = false
  physicsObject: (THREE.Object3D & { bodyID?: number }) | null = null
  controls: OrbitControls
  arrow: THREE.ArrowHelper
  localHit = new THREE.Vector3()
  worldHit = new THREE.Vector3()
  currentWorld = new THREE.Vector3()

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    container: HTMLElement,
    controls: OrbitControls,
  ) {
    this.scene = scene
    this.renderer = renderer
    this.camera = camera
    this.controls = controls
    this.raycaster.params.Line.threshold = 0.1

    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 15, 0x666666)
    this.arrow.setLength(15, 3, 1)
    this.scene.add(this.arrow)
    const lineMat = this.arrow.line.material as THREE.Material
    const coneMat = this.arrow.cone.material as THREE.Material
    lineMat.transparent = true
    coneMat.transparent = true
    lineMat.opacity = 0.5
    coneMat.opacity = 0.5
    this.arrow.visible = false

    container.addEventListener('pointerdown', this.onPointer.bind(this) as EventListener, true)
    document.addEventListener('pointermove', this.onPointer.bind(this) as EventListener, true)
    document.addEventListener('pointerup', this.onPointer.bind(this) as EventListener, true)
    container.addEventListener('dblclick', this.onPointer.bind(this) as EventListener, false)
  }

  updateRaycaster(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    // camera matrices must be CURRENT before casting — after an orbit the
    // stale view matrix bends the ray, and the drag force then pushes the
    // wrong way (Lane C: direction error after camera rotation)
    this.camera.updateMatrixWorld()
    this.camera.updateProjectionMatrix()
    this.mousePos.x = ((x - rect.left) / rect.width) * 2 - 1
    this.mousePos.y = -((y - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.mousePos, this.camera)
  }

  start(x: number, y: number) {
    this.physicsObject = null
    this.updateRaycaster(x, y)
    const intersects = this.raycaster.intersectObjects(this.scene.children, true)
    for (let i = 0; i < intersects.length; i++) {
      const obj = intersects[i].object as THREE.Object3D & { bodyID?: number }
      if (obj.bodyID && obj.bodyID > 0) {
        this.physicsObject = obj
        this.grabDistance = intersects[i].distance
        const hit = this.raycaster.ray.origin.clone()
        hit.addScaledVector(this.raycaster.ray.direction, this.grabDistance)
        this.arrow.position.copy(hit)
        this.active = true
        this.controls.enabled = false
        this.localHit = obj.worldToLocal(hit.clone())
        this.worldHit.copy(hit)
        this.currentWorld.copy(hit)
        this.arrow.visible = true
        break
      }
    }
  }

  move(x: number, y: number) {
    this.lastX = x
    this.lastY = y
    if (!this.active) return
    this.updateRaycaster(x, y)
    this.currentWorld.copy(this.raycaster.ray.origin)
    this.currentWorld.addScaledVector(this.raycaster.ray.direction, this.grabDistance)
    this.arrow.setDirection(this.currentWorld.clone().sub(this.arrow.position).normalize())
  }

  /** re-anchor the force origin from the latest pointer position (the physics
   *  loop calls this every step, mirroring upstream update()) */
  update() {
    if (this.active) this.move(this.lastX, this.lastY)
  }

  end() {
    this.active = false
    this.physicsObject = null
    this.controls.enabled = true
    this.arrow.visible = false
  }

  onPointer(event: PointerEvent | MouseEvent) {
    if (event.type === 'pointerdown') {
      event.preventDefault()
      this.start(event.clientX, event.clientY)
    } else if (event.type === 'pointermove') {
      this.move(event.clientX, event.clientY)
    } else {
      this.end()
    }
  }

  /** headless/testing: drive a synthetic drag (pick at x,y then move to x2,y2) */
  syntheticDrag(x: number, y: number, x2: number, y2: number) {
    this.start(x, y)
    if (this.active) this.move(x2, y2)
  }
}
