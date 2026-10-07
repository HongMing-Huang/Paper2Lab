// loadScene — ported from zalo/mujoco_wasm@f6b202ca… src/mujocoUtils.js
// (loadSceneFromURL): builds a three.js scene graph from a compiled MjModel
// (geoms by type, mesh buffers with axis swizzle, materials with textures
// from model.tex_data, tendon instanced meshes, lights, body hierarchy).
// Deviation from upstream: PLANE geoms render as a plain ground mesh instead
// of the patched Reflector (three's stock Reflector has no texture option);
// planes still render, raycast and receive shadows.
import * as THREE from 'three'

/** the mjModel fields this builder reads (wasm typed-array views) */
export interface MjModelLike {
  nbody: number
  ngeom: number
  names: Uint8Array
  name_bodyadr: ArrayLike<number>
  geom_bodyid: ArrayLike<number>
  geom_type: ArrayLike<number>
  geom_group: ArrayLike<number>
  geom_size: ArrayLike<number>
  geom_pos: ArrayLike<number>
  geom_quat: ArrayLike<number>
  geom_rgba: ArrayLike<number>
  geom_matid: ArrayLike<number>
  geom_dataid: ArrayLike<number>
  mesh_vert: Float32Array
  mesh_vertadr: ArrayLike<number>
  mesh_vertnum: ArrayLike<number>
  mesh_normal: Float32Array
  mesh_normaladr: ArrayLike<number>
  mesh_normalnum: ArrayLike<number>
  mesh_texcoord: Float32Array
  mesh_texcoordadr: ArrayLike<number>
  mesh_texcoordnum: ArrayLike<number>
  mesh_face: Uint32Array
  mesh_faceadr: ArrayLike<number>
  mesh_facenum: ArrayLike<number>
  mesh_facetexcoord: Uint32Array
  mesh_facenormal: ArrayLike<number>
  mat_rgba: ArrayLike<number>
  mat_texid: ArrayLike<number>
  mat_texrepeat: ArrayLike<number>
  mat_specular: ArrayLike<number>
  mat_reflectance: ArrayLike<number>
  mat_shininess: ArrayLike<number>
  tex_width: ArrayLike<number>
  tex_height: ArrayLike<number>
  tex_adr: ArrayLike<bigint>
  tex_nchannel: ArrayLike<number>
  tex_data: ArrayLike<number>
  nlight: number
  light_type: ArrayLike<number>
  light_attenuation: ArrayLike<number>
  nten: number
  ten_wrapadr?: ArrayLike<number>
}

export interface LoadedScene {
  model: MjModelLike & { delete(): void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  bodies: Record<number, THREE.Group & { bodyID?: number }>
  lights: THREE.Light[]
  mujocoRoot: THREE.Group
}

const GEOM_PLANE = 0
const GEOM_SPHERE = 2
const GEOM_CAPSULE = 3
const GEOM_ELLIPSOID = 4
const GEOM_CYLINDER = 5
const GEOM_BOX = 6
const GEOM_MESH = 7

/** upstream getPosition: MuJoCo z-up → three y-up (exact port) */
export function getPosition(buffer: ArrayLike<number>, index: number, target: THREE.Vector3, swizzle = true) {
  if (swizzle) target.set(buffer[index * 3 + 0], buffer[index * 3 + 2], -buffer[index * 3 + 1])
  else target.set(buffer[index * 3 + 0], buffer[index * 3 + 1], buffer[index * 3 + 2])
  return target
}

/** upstream getQuaternion (w,x,y,z buffer → three x,y,z,w, exact port) */
export function getQuaternion(buffer: ArrayLike<number>, index: number, target: THREE.Quaternion, swizzle = true) {
  if (swizzle) {
    target.set(-buffer[index * 4 + 1], -buffer[index * 4 + 3], buffer[index * 4 + 2], -buffer[index * 4 + 0])
  } else {
    target.set(buffer[index * 4 + 1], buffer[index * 4 + 2], buffer[index * 4 + 3], buffer[index * 4 + 0])
  }
  return target
}

/** three screen-space → MuJoCo world-space */
export function toMujocoPos(target: THREE.Vector3) {
  return target.set(target.x, -target.z, target.y)
}

const textDecoder = new TextDecoder('utf8')
const NULL = '\0'

export function loadSceneInto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mujoco: any,
  filename: string,
  parent: { scene: THREE.Scene; mujocoRoot?: THREE.Group },
): LoadedScene {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = mujoco.MjModel.mj_loadXML('/working/' + filename) as LoadedScene['model']
  if (!model) throw new Error(`mj_loadXML failed for ${filename}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = new mujoco.MjData(model)

  const names = textDecoder.decode(model.names).split(NULL)
  const namesArray = new Uint8Array(model.names)

  const mujocoRoot = new THREE.Group()
  mujocoRoot.name = 'MuJoCo Root'
  if (parent.mujocoRoot) {
    // #33: a scene switch must FREE the old GPU resources, not just detach
    // the group — otherwise every switch leaks geometries + materials
    parent.mujocoRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) mat.dispose()
    })
    parent.scene.remove(parent.mujocoRoot)
  }
  parent.scene.add(mujocoRoot)
  parent.mujocoRoot = mujocoRoot

  const bodies: Record<number, THREE.Group & { bodyID?: number }> = {}
  const meshes: Record<number, THREE.BufferGeometry> = {}
  const lights: THREE.Light[] = []

  for (let g = 0; g < model.ngeom; g++) {
    if (!(model.geom_group[g] < 3)) continue
    const b = model.geom_bodyid[g]
    const type = model.geom_type[g]
    const size = [model.geom_size[g * 3], model.geom_size[g * 3 + 1], model.geom_size[g * 3 + 2]]

    if (!(b in bodies)) {
      bodies[b] = new THREE.Group() as THREE.Group & { bodyID?: number }
      const start = model.name_bodyadr[b]
      let end = start
      while (end < namesArray.length && namesArray[end] !== 0) end++
      bodies[b].name = textDecoder.decode(namesArray.subarray(start, end))
      bodies[b].bodyID = b
    }

    let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(size[0] * 0.5)
    if (type === GEOM_PLANE) {
      geometry = new THREE.PlaneGeometry(100, 100)
    } else if (type === GEOM_SPHERE) {
      geometry = new THREE.SphereGeometry(size[0])
    } else if (type === GEOM_CAPSULE) {
      geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2, 20, 20)
    } else if (type === GEOM_ELLIPSOID) {
      geometry = new THREE.SphereGeometry(1)
    } else if (type === GEOM_CYLINDER) {
      geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2)
    } else if (type === GEOM_BOX) {
      geometry = new THREE.BoxGeometry(size[0] * 2, size[2] * 2, size[1] * 2)
    } else if (type === GEOM_MESH) {
      const meshID = model.geom_dataid[g]
      if (!(meshID in meshes)) {
        geometry = new THREE.BufferGeometry()
        const vb = model.mesh_vert.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3,
        ) as Float32Array
        for (let v = 0; v < vb.length; v += 3) {
          const temp = vb[v + 1]
          vb[v + 1] = vb[v + 2]
          vb[v + 2] = -temp
        }
        const uvb = model.mesh_texcoord.subarray(
          model.mesh_texcoordadr[meshID] * 2,
          (model.mesh_texcoordadr[meshID] + model.mesh_texcoordnum[meshID]) * 2,
        ) as Float32Array
        const f2v = model.mesh_face.subarray(
          model.mesh_faceadr[meshID] * 3,
          (model.mesh_faceadr[meshID] + model.mesh_facenum[meshID]) * 3,
        )
        const f2uv = model.mesh_facetexcoord.subarray(
          model.mesh_faceadr[meshID] * 3,
          (model.mesh_faceadr[meshID] + model.mesh_facenum[meshID]) * 3,
        )
        const swizzledUv = new Float32Array((vb.length / 3) * 2)
        for (let t = 0; t < f2v.length / 3; t++) {
          const vi = [f2v[t * 3], f2v[t * 3 + 1], f2v[t * 3 + 2]]
          const ui = [f2uv[t * 3], f2uv[t * 3 + 1], f2uv[t * 3 + 2]]
          for (let k = 0; k < 3; k++) {
            swizzledUv[vi[k] * 2] = uvb[ui[k] * 2]
            swizzledUv[vi[k] * 2 + 1] = uvb[ui[k] * 2 + 1]
          }
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(vb, 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(swizzledUv, 2))
        geometry.setIndex(Array.from(f2v))
        geometry.computeVertexNormals()
        meshes[meshID] = geometry
      } else {
        geometry = meshes[meshID]
      }
    }

    let texture: THREE.DataTexture | undefined
    let color = [model.geom_rgba[g * 4], model.geom_rgba[g * 4 + 1], model.geom_rgba[g * 4 + 2], model.geom_rgba[g * 4 + 3]]
    if (model.geom_matid[g] !== -1) {
      const matId = model.geom_matid[g]
      color = [model.mat_rgba[matId * 4], model.mat_rgba[matId * 4 + 1], model.mat_rgba[matId * 4 + 2], model.mat_rgba[matId * 4 + 3]]
      const mjNTEXROLE = 10
      const mjTEXROLE_RGB = 1
      const texId = model.mat_texid[matId * mjNTEXROLE + mjTEXROLE_RGB]
      if (texId !== -1) {
        const width = model.tex_width[texId]
        const height = model.tex_height[texId]
        const offset = Number(model.tex_adr[texId])
        const channels = model.tex_nchannel[texId]
        const texData = model.tex_data
        const rgba = new Uint8Array(width * height * 4)
        for (let p = 0; p < width * height; p++) {
          rgba[p * 4] = texData[offset + p * channels]
          rgba[p * 4 + 1] = channels > 1 ? texData[offset + p * channels + 1] : rgba[p * 4]
          rgba[p * 4 + 2] = channels > 2 ? texData[offset + p * channels + 2] : rgba[p * 4]
          rgba[p * 4 + 3] = 255
        }
        texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
        texture.repeat = new THREE.Vector2(
          model.mat_texrepeat[matId * 2],
          model.mat_texrepeat[matId * 2 + 1],
        )
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.needsUpdate = true
      }
    }

    const currentMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color[0], color[1], color[2]),
      transparent: color[3] < 1,
      opacity: color[3],
      roughness: model.geom_matid[g] !== -1 ? Math.max(0, Math.min(1, 1 - model.mat_shininess[model.geom_matid[g]])) : 0.7,
      metalness: 0.1,
      map: texture,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, currentMaterial)
    mesh.castShadow = g === 0 ? false : true
    mesh.receiveShadow = true
    ;(mesh as THREE.Mesh & { bodyID?: number }).bodyID = b
    bodies[b].add(mesh)
    getPosition(model.geom_pos, g, mesh.position)
    if (type !== GEOM_PLANE) getQuaternion(model.geom_quat, g, mesh.quaternion)
    if (type === GEOM_ELLIPSOID) mesh.scale.set(size[0], size[2], size[1])
  }

  // tendon instanced meshes (positions updated per frame by the lab loop)
  const tendonMat = new THREE.MeshPhongMaterial({ color: 0xcc4c4c })
  const cylinders = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1), tendonMat, 1023)
  cylinders.castShadow = true
  cylinders.count = 0
  mujocoRoot.add(cylinders)
  const spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 10), tendonMat, 1023)
  spheres.castShadow = true
  spheres.count = 0
  mujocoRoot.add(spheres)

  for (let l = 0; l < model.nlight; l++) {
    let light: THREE.Light
    const t = model.light_type[l]
    if (t === 0) {
      const spot = new THREE.SpotLight()
      spot.angle = 1.11
      spot.penumbra = 0.5
      light = spot
    } else if (t === 2) {
      light = new THREE.PointLight()
    } else {
      light = new THREE.DirectionalLight()
    }
    light.intensity = light.intensity * 3.14
    if (bodies[0]) bodies[0].add(light)
    else mujocoRoot.add(light)
    lights.push(light)
  }
  if (model.nlight === 0) mujocoRoot.add(new THREE.DirectionalLight())

  for (let b = 0; b < model.nbody; b++) {
    if (b === 0 || !bodies[0]) {
      if (bodies[b]) mujocoRoot.add(bodies[b])
    } else if (bodies[b]) {
      bodies[0].add(bodies[b])
    } else {
      bodies[b] = new THREE.Group() as THREE.Group & { bodyID?: number }
      bodies[b].name = names[b + 1] ?? `body${b}`
      bodies[b].bodyID = b
      bodies[0].add(bodies[b])
    }
  }

  return { model, data, bodies, lights, mujocoRoot }
}
