// S1.2 binary boundary: a typed array can be evidence only as a sealed artifact.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readArtifact, sealArray, sha256Hex } from './artifacts'
import { ENGINES, executeSpec, exportExperimentRuns } from './protocol'
import { importRuns } from './runRepository'

const engine = ENGINES.kakeyaWorker
const nodeSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('sha256Hex', () => {
  it('matches the published vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('matches an independent implementation across every padding boundary', () => {
    for (let n = 0; n <= 130; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff)
      expect(sha256Hex(bytes), `length ${n}`).toBe(nodeSha256(bytes))
    }
    const large = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 7) & 0xff)
    expect(sha256Hex(large)).toBe(nodeSha256(large))
  })
})

describe('sealArray', () => {
  it('records dtype, shape, byteLength, content hash and engine', () => {
    const data = new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8])
    const ref = sealArray(data, { shape: [2, 2, 2], engine })
    expect(ref).toMatchObject({ artifact: 'ndarray', dtype: 'uint16', shape: [2, 2, 2], byteLength: 16, engine: engine.engine, engineVersion: engine.version })
    expect(ref.hash).toBe(`sha256:${nodeSha256(new Uint8Array(data.buffer))}`)
  })

  it('evidence survives the producer changing its buffer after sealing', () => {
    const data = new Float64Array([1.5, 2.5])
    const ref = sealArray(data, { shape: [2], engine })
    data[0] = 999
    expect(Array.from(readArtifact(ref) as Float64Array)).toEqual([1.5, 2.5])
  })

  it('a reader gets its own copy and cannot write back to the evidence', () => {
    const ref = sealArray(new Float64Array([1, 2]), { shape: [2], engine })
    const first = readArtifact(ref) as Float64Array
    first[0] = 999
    expect((readArtifact(ref) as Float64Array)[0]).toBe(1)
  })

  it('seals only the viewed range of a larger buffer', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9])
    const ref = sealArray(backing.subarray(2, 5), { shape: [3], engine })
    expect(Array.from(readArtifact(ref) as Uint8Array)).toEqual([1, 2, 3])
    expect(ref.hash).toBe(`sha256:${nodeSha256(new Uint8Array([1, 2, 3]))}`)
  })

  it.each([
    ['NaN', new Float64Array([1, NaN])],
    ['Infinity', new Float32Array([Infinity])],
    ['-Infinity', new Float64Array([-Infinity])],
  ])('rejects %s', (_label, data) => {
    expect(() => sealArray(data, { shape: [data.length], engine })).toThrow(/non-finite/)
  })

  it('rejects a shape that does not describe the data', () => {
    expect(() => sealArray(new Uint8Array(8), { shape: [3, 3], engine })).toThrow(/shape/)
    expect(() => sealArray(new Uint8Array(8), { shape: [-2, -4], engine })).toThrow(/shape/)
    expect(() => sealArray(new Uint8Array(8), { shape: [2.5, 3.2], engine })).toThrow(/shape/)
  })

  it('rejects shared buffers and unsupported views', () => {
    expect(() => sealArray(new Uint8Array(new SharedArrayBuffer(4)), { shape: [4], engine })).toThrow(/shared/i)
    expect(() => sealArray(new DataView(new ArrayBuffer(4)) as unknown as Uint8Array, { shape: [4], engine })).toThrow(/unsupported/i)
    expect(() => sealArray(new BigInt64Array(1) as unknown as Uint8Array, { shape: [1], engine })).toThrow(/unsupported/i)
  })
})

describe('artifact references through a Run', () => {
  it('survive JSON export and import with dtype, shape and hash intact', async () => {
    const ref = sealArray(new Uint16Array([5, 6, 7, 8]), { shape: [2, 2], engine })
    const run = await executeSpec({ kind: 'kakeya.voxel', params: {}, seed: 0 }, engine, () => ({ occupancy: ref }))
    const parsed = JSON.parse(exportExperimentRuns([run.runId]))
    const back = parsed[0].result.occupancy
    expect(back).toEqual(ref)
    expect(Array.from(readArtifact(back) as Uint16Array)).toEqual([5, 6, 7, 8])
    parsed[0].runId = `${run.runId}-imported`
    expect(importRuns(JSON.stringify(parsed)).imported).toBe(1)
  })

  it('a reference whose dtype, shape or hash was altered does not resolve to the evidence', () => {
    const ref = sealArray(new Uint16Array([1, 2, 3, 4]), { shape: [4], engine })
    expect(readArtifact({ ...ref, dtype: 'uint8' })).toBeUndefined()
    expect(readArtifact({ ...ref, shape: [2, 2] })).toBeUndefined()
    expect(readArtifact({ ...ref, hash: 'sha256:0000' })).toBeUndefined()
    // string shape elements must never collide with integers (join("x") would)
    expect(readArtifact({ ...ref, shape: ['2x2'] as unknown as number[] })).toBeUndefined()
    expect(readArtifact({ ...ref, byteLength: ref.byteLength + 1 })).toBeUndefined()
    expect(readArtifact({ ...ref, engine: 'forged' })).toBeUndefined()
    expect(readArtifact({ ...ref, engineVersion: '9.9.9' })).toBeUndefined()
  })

  it('a newly sealed 2x3 artifact does not collide with the string-shape forgery of a 6-element array', () => {
    const real = sealArray(new Uint16Array(6), { shape: [2, 3], engine })
    expect(readArtifact({ ...real, shape: ['2x3'] as unknown as number[] })).toBeUndefined()
    expect(readArtifact(real)).toBeInstanceOf(Uint16Array)
  })

  it('identical bytes with a different meaning stay distinct', () => {
    const asU8 = sealArray(new Uint8Array([1, 0, 2, 0]), { shape: [4], engine })
    const asU16 = sealArray(new Uint16Array([1, 2]), { shape: [2], engine })
    expect(asU8.hash).toBe(asU16.hash)
    expect(Array.from(readArtifact(asU8) as Uint8Array)).toEqual([1, 0, 2, 0])
    expect(Array.from(readArtifact(asU16) as Uint16Array)).toEqual([1, 2])
  })
})
