// Sealed binary artifacts (PLAN §3.3). A Run result is JSON only; a large numeric
// array lives here and the Run holds a reference naming its dtype, shape, byte
// length, content hash and engine. Sealing copies the bytes, so the producer can
// keep using its buffer; reading returns another copy, so a renderer can build
// on it freely but can never write back to the evidence. Storage is in-process
// until D1 persists it, so a reference from another session reads as absent.

export type ArtifactDtype = 'uint8' | 'uint16' | 'uint32' | 'int32' | 'float32' | 'float64'
export type SealableArray = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array

const ARRAY_BY_DTYPE = {
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
  int32: Int32Array,
  float32: Float32Array,
  float64: Float64Array,
} as const

const DTYPE_BY_TAG: Record<string, ArtifactDtype> = {
  '[object Uint8Array]': 'uint8',
  '[object Uint16Array]': 'uint16',
  '[object Uint32Array]': 'uint32',
  '[object Int32Array]': 'int32',
  '[object Float32Array]': 'float32',
  '[object Float64Array]': 'float64',
}

export interface ArtifactRef {
  artifact: 'ndarray'
  dtype: ArtifactDtype
  /** row-major dimensions; their product is the element count */
  shape: number[]
  byteLength: number
  /** `sha256:<hex>` of the raw little-endian element bytes */
  hash: string
  engine: string
  engineVersion: string
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/**
 * SHA-256 over bytes. Written out because sealing happens in the browser as well
 * as in Node: node:crypto is not bundled there, and crypto.subtle is async and
 * absent outside secure contexts (a plain-http LAN deployment).
 */
export function sha256Hex(bytes: Uint8Array): string {
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const padded = new Uint8Array(((bytes.length + 9 + 63) >>> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** the same bytes under a different dtype/shape/engine are a different artifact */
const sealed = new Map<string, ArrayBuffer>()
// JSON.stringify, not join: ["2x3"] and [2,3] must never collide
const keyOf = (r: Pick<ArtifactRef, 'hash' | 'dtype' | 'shape' | 'byteLength' | 'engine' | 'engineVersion'>) =>
  `${r.hash}|${r.dtype}|${JSON.stringify(r.shape)}|${r.byteLength}|${r.engine}@${r.engineVersion}`

/** validate and copy an array into the sealed store; throws rather than seal bad data */
export function sealArray(data: SealableArray, meta: { shape: number[]; engine: { engine: string; version: string } }): ArtifactRef {
  const dtype = DTYPE_BY_TAG[Object.prototype.toString.call(data)]
  if (!dtype) throw new Error(`unsupported artifact array type: ${Object.prototype.toString.call(data)}`)
  if (typeof SharedArrayBuffer !== 'undefined' && data.buffer instanceof SharedArrayBuffer) {
    throw new Error('a shared buffer cannot be sealed: another thread could change it underneath the hash')
  }
  const { shape } = meta
  if (!shape.every((n) => Number.isSafeInteger(n) && n > 0) || shape.reduce((a, b) => a * b, 1) !== data.length) {
    throw new Error(`artifact shape ${JSON.stringify(shape)} does not describe ${data.length} elements`)
  }
  if (dtype === 'float32' || dtype === 'float64') {
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) throw new Error(`non-finite value at artifact index ${i}: ${data[i]}`)
    }
  }
  const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength).slice()
  const ref: ArtifactRef = {
    artifact: 'ndarray',
    dtype,
    shape: [...shape],
    byteLength: bytes.byteLength,
    hash: `sha256:${sha256Hex(bytes)}`,
    engine: meta.engine.engine,
    engineVersion: meta.engine.version,
  }
  sealed.set(keyOf(ref), bytes.buffer)
  return ref
}

/** a fresh copy of the sealed data; undefined when this session never sealed it */
export function readArtifact(ref: ArtifactRef): SealableArray | undefined {
  // a forged shape must not resolve even by key luck — elements are positive
  // integers exactly as sealArray demanded
  if (!Array.isArray(ref.shape) || !ref.shape.every((n) => Number.isSafeInteger(n) && n > 0)) return undefined
  const buffer = sealed.get(keyOf(ref))
  return buffer && new ARRAY_BY_DTYPE[ref.dtype](buffer.slice(0))
}
