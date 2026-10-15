var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/kakeya/directions.ts
function fibonacciDirections(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}
var init_directions = __esm({
  "src/kakeya/directions.ts"() {
    "use strict";
  }
});

// src/kakeya/tubes.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeTubes(dirs, delta, packing, seed = 20250224) {
  const rand = mulberry32(seed);
  const p = clamp(packing, 0, 1);
  const tubes = [];
  for (const dir of dirs) {
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    const lo = { x: ax / 2, y: ay / 2, z: az / 2 };
    const hi = { x: 1 - ax / 2, y: 1 - ay / 2, z: 1 - az / 2 };
    const spread = {
      x: lo.x + (hi.x - lo.x) * rand(),
      y: lo.y + (hi.y - lo.y) * rand(),
      z: lo.z + (hi.z - lo.z) * rand()
    };
    const sticky = { x: 0.5, y: 0.5, z: 0.5 };
    tubes.push({
      dir,
      center: {
        x: spread.x + (sticky.x - spread.x) * p,
        y: spread.y + (sticky.y - spread.y) * p,
        z: spread.z + (sticky.z - spread.z) * p
      },
      radius: delta
    });
  }
  return tubes;
}
function segmentOf(t) {
  return {
    a: {
      x: t.center.x - t.dir.x / 2,
      y: t.center.y - t.dir.y / 2,
      z: t.center.z - t.dir.z / 2
    },
    b: {
      x: t.center.x + t.dir.x / 2,
      y: t.center.y + t.dir.y / 2,
      z: t.center.z + t.dir.z / 2
    }
  };
}
var clamp;
var init_tubes = __esm({
  "src/kakeya/tubes.ts"() {
    "use strict";
    clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  }
});

// src/kakeya/voxels3d.ts
var voxels3d_exports = {};
__export(voxels3d_exports, {
  computeVoxelCoverage: () => computeVoxelCoverage
});
function computeVoxelCoverage(tubes, res, visRes = 0) {
  const coverage = new Uint16Array(res * res * res);
  const h = 1 / res;
  let sumTubeVoxels = 0;
  for (const t of tubes) {
    const d = t.dir;
    const r = t.radius;
    const c = t.center;
    const minx = Math.max(0, Math.floor((c.x - (Math.abs(d.x) / 2 + r)) * res));
    const maxx = Math.min(res - 1, Math.ceil((c.x + (Math.abs(d.x) / 2 + r)) * res));
    const miny = Math.max(0, Math.floor((c.y - (Math.abs(d.y) / 2 + r)) * res));
    const maxy = Math.min(res - 1, Math.ceil((c.y + (Math.abs(d.y) / 2 + r)) * res));
    const minz = Math.max(0, Math.floor((c.z - (Math.abs(d.z) / 2 + r)) * res));
    const maxz = Math.min(res - 1, Math.ceil((c.z + (Math.abs(d.z) / 2 + r)) * res));
    let tubeVoxels = 0;
    for (let i = minx; i <= maxx; i++) {
      const px = (i + 0.5) * h - c.x;
      for (let j = miny; j <= maxy; j++) {
        const py = (j + 0.5) * h - c.y;
        for (let k = minz; k <= maxz; k++) {
          const pz = (k + 0.5) * h - c.z;
          let s = px * d.x + py * d.y + pz * d.z;
          if (s < -0.5) s = -0.5;
          else if (s > 0.5) s = 0.5;
          const qx = px - s * d.x;
          const qy = py - s * d.y;
          const qz = pz - s * d.z;
          if (qx * qx + qy * qy + qz * qz <= r * r) {
            coverage[(i * res + j) * res + k]++;
            tubeVoxels++;
          }
        }
      }
    }
    sumTubeVoxels += tubeVoxels;
  }
  let occupied = 0;
  let maxM = 0;
  for (let idx = 0; idx < coverage.length; idx++) {
    const m = coverage[idx];
    if (m > 0) {
      occupied++;
      if (m > maxM) maxM = m;
    }
  }
  const histogram = new Array(maxM + 1).fill(0);
  for (let idx = 0; idx < coverage.length; idx++) histogram[coverage[idx]]++;
  const delta = tubes[0]?.radius ?? 0;
  const result = {
    res,
    occupiedVolume: occupied / (res * res * res),
    sumTubeVolume: sumTubeVoxels / (res * res * res) * 1,
    maxMultiplicity: maxM,
    avgMultiplicity: occupied > 0 ? sumTubeVoxels / occupied : 0,
    histogram,
    // capsule = cylinder πδ²·L + a FULL sphere of radius δ (two hemispherical
    // caps); an earlier version used half the sphere and was caught by the
    // independent NumPy/Pyodide Monte-Carlo cross-check (verify.pyodide_numpy)
    analyticPerTube: Math.PI * delta * delta + 4 / 3 * Math.PI * delta ** 3
  };
  if (visRes > 0 && visRes <= res && res % visRes === 0) {
    const factor = res / visRes;
    const vis = new Uint16Array(visRes * visRes * visRes);
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const base = (i * res + j) * res;
        const vbase = (Math.floor(i / factor) * visRes + Math.floor(j / factor)) * visRes;
        for (let k = 0; k < res; k++) {
          const m = coverage[base + k];
          const vk = vbase + Math.floor(k / factor);
          if (m > vis[vk]) vis[vk] = m;
        }
      }
    }
    result.visGrid = { res: visRes, data: vis };
  }
  return result;
}
var init_voxels3d = __esm({
  "src/kakeya/voxels3d.ts"() {
    "use strict";
  }
});

// src/physics/mujocoKernel.ts
var mujocoKernel_exports = {};
__export(mujocoKernel_exports, {
  MUJOCO_ENGINE: () => MUJOCO_ENGINE,
  getMujoco: () => getMujoco,
  listScenes: () => listScenes,
  mujocoSimulate: () => mujocoSimulate,
  scenesChecksum: () => scenesChecksum,
  scenesManifest: () => scenesManifest
});
import load_mujoco from "@mujoco/mujoco";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function findScenesDir() {
  const candidates = [
    process.env.PAPER2LAB_SCENES_DIR,
    resolve(here, "scenes"),
    // source layout
    resolve(here, "../src/physics/scenes"),
    // bundle in scripts/, repo layout
    resolve(here, "../../src/physics/scenes")
    // bundle one level deeper
  ].filter((p) => typeof p === "string" && p.length > 0);
  for (const dir of candidates) {
    try {
      readFileSync(join(dir, "manifest.json"));
      return dir;
    } catch {
    }
  }
  throw new Error(`vendored scenes not found \u2014 tried: ${candidates.join(", ")}`);
}
function scenesManifest() {
  return JSON.parse(readFileSync(join(SCENES_DIR, "manifest.json"), "utf8"));
}
function listScenes() {
  return scenesManifest().scenes;
}
async function getMujoco() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = await load_mujoco();
      if (!scenesSeeded) {
        mod.FS.mkdir("/working");
        mod.FS.mount(mod.MEMFS, { root: "." }, "/working");
        const write = (dir, base = "") => {
          for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            const rel = base ? `${base}/${name}` : name;
            if (statSync(full).isDirectory()) {
              try {
                mod.FS.mkdir(`/working/${rel}`);
              } catch {
              }
              write(full, rel);
            } else {
              mod.FS.writeFile(`/working/${rel}`, new Uint8Array(readFileSync(full)));
            }
          }
        };
        write(SCENES_DIR);
        scenesSeeded = true;
      }
      return mod;
    })();
  }
  return modulePromise;
}
function finite(v) {
  return Number.isFinite(v);
}
async function mujocoSimulate(scene, opts) {
  const manifest = scenesManifest();
  if (!scene.startsWith("p2l-") && !manifest.scenes.includes(scene)) {
    throw new Error(`unknown scene '${scene}' \u2014 registered: ${manifest.scenes.join(", ")}`);
  }
  const steps = Math.floor(opts.steps);
  const sampleEvery = Math.max(1, Math.floor(opts.sampleEvery));
  if (!(steps >= 1) || steps > 1e5) throw new Error(`steps must be in [1, 100000]: ${steps}`);
  const { gravityZ, windX, timestep, forces, keyframe } = opts.params ?? {};
  for (const v of [gravityZ, windX, timestep]) {
    if (v !== void 0 && (!finite(v) || Math.abs(v) > 1e4)) throw new Error(`param out of range: ${v}`);
  }
  const forceEvents = (forces ?? []).filter((f) => {
    if (typeof f.bodyId !== "number" || !Number.isInteger(f.bodyId)) throw new Error(`force.bodyId must be an integer: ${f.bodyId}`);
    if (!Array.isArray(f.f) || f.f.length !== 3 || !Array.isArray(f.p) || f.p.length !== 3) throw new Error("force.f/p must be 3-vectors");
    for (const v of [...f.f, ...f.p]) if (!finite(v) || Math.abs(v) > 1e6) throw new Error(`force component out of range: ${v}`);
    return true;
  });
  const mujoco = await getMujoco();
  const model = mujoco.MjModel.mj_loadXML(`/working/${scene}`);
  if (!model) throw new Error(`mj_loadXML failed: ${scene}`);
  const data = new mujoco.MjData(model);
  const gravity = model.opt.gravity;
  const wind = model.opt.wind;
  if (gravityZ !== void 0) gravity[2] = gravityZ;
  if (windX !== void 0) wind[0] = windX;
  if (timestep !== void 0) model.opt.timestep = timestep;
  if (keyframe !== void 0) {
    const mk = model;
    if (!Number.isInteger(keyframe) || keyframe < 0 || keyframe >= mk.nkey) {
      throw new Error(`keyframe must be an integer in [0, nkey=${mk.nkey})`);
    }
    ;
    mujoco.mj_resetDataKeyframe(model, data, keyframe);
  }
  const nq = model.nq;
  const nv = model.nv;
  const qposAt = () => {
    const out = [];
    for (let i = 0; i < nq; i++) out.push(Number(data.qpos[i]));
    return out;
  };
  const t = [Number(data.time)];
  const qpos = [qposAt()];
  let qaccNormMean = 0;
  let qaccCount = 0;
  let allFinite = true;
  const step = (m, d) => mujoco.mj_step(m, d);
  const applyFT = (m, d, f) => mujoco.mj_applyFT(
    m,
    d,
    f.f,
    [0, 0, 0],
    f.p,
    f.bodyId,
    d.qfrc_applied
  );
  const clearFT = (d) => {
    const q = d.qfrc_applied;
    for (let i = 0; i < q.length; i++) q[i] = 0;
  };
  for (let i = 1; i <= steps; i++) {
    if (forceEvents.length > 0) {
      clearFT(data);
      for (const f of forceEvents) applyFT(model, data, f);
    }
    step(model, data);
    let qaccNorm = 0;
    for (let k = 0; k < nv; k++) {
      const a = Number(data.qacc[k]);
      if (!finite(a)) allFinite = false;
      qaccNorm += a * a;
    }
    qaccNormMean += Math.sqrt(qaccNorm);
    qaccCount++;
    if (i % sampleEvery === 0 || i === steps) {
      t.push(Number(data.time));
      qpos.push(qposAt());
    }
  }
  let qposNormFinal = 0;
  let qvelNormFinal = 0;
  for (let k = 0; k < nq; k++) {
    const q = Number(data.qpos[k]);
    if (!finite(q)) allFinite = false;
    qposNormFinal += q * q;
  }
  for (let k = 0; k < nv; k++) {
    const v = Number(data.qvel[k]);
    if (!finite(v)) allFinite = false;
    qvelNormFinal += v * v;
  }
  const comZFinal = model.nbody > 1 ? Number(data.xpos[5]) : null;
  const geoms = [];
  const gm = model;
  for (let g = 0; g < gm.ngeom; g++) {
    geoms.push({
      bodyId: Number(gm.geom_bodyid[g]),
      type: Number(gm.geom_type[g]),
      size: [Number(gm.geom_size[g * 3]), Number(gm.geom_size[g * 3 + 1]), Number(gm.geom_size[g * 3 + 2])],
      rgba: [Number(gm.geom_rgba[g * 4]), Number(gm.geom_rgba[g * 4 + 1]), Number(gm.geom_rgba[g * 4 + 2]), Number(gm.geom_rgba[g * 4 + 3])]
    });
  }
  const result = {
    scene,
    steps,
    sampleEvery,
    nq,
    geomSummary: { nbody: model.nbody, nq: model.nq, nv: model.nv, geoms },
    t,
    qpos,
    metrics: {
      finalTime: Number(data.time),
      qposNormFinal: Math.sqrt(qposNormFinal),
      qvelNormFinal: Math.sqrt(qvelNormFinal),
      qaccNormMean: qaccCount > 0 ? qaccNormMean / qaccCount : 0,
      comZFinal: comZFinal !== null && finite(comZFinal) ? comZFinal : null,
      allFinite
    }
  };
  data.delete();
  model.delete();
  return result;
}
function scenesChecksum() {
  const files = scenesManifest().files;
  const h = createHash("sha256");
  for (const name of Object.keys(files).sort()) h.update(name).update(files[name]);
  return h.digest("hex").slice(0, 16);
}
var MUJOCO_ENGINE, modulePromise, scenesSeeded, here, SCENES_DIR;
var init_mujocoKernel = __esm({
  "src/physics/mujocoKernel.ts"() {
    "use strict";
    MUJOCO_ENGINE = { engine: "mujoco-wasm", version: "3.12.0" };
    modulePromise = null;
    scenesSeeded = false;
    here = dirname(fileURLToPath(import.meta.url));
    SCENES_DIR = findScenesDir();
  }
});

// scripts/engine_server.ts
import { createInterface } from "node:readline";

// src/skills/executor.ts
import { compile as compile2 } from "@cortex-js/compute-engine";

// src/experiments/protocol.ts
var ENGINES = {
  kakeyaWorker: { engine: "ts-kakeya-worker", version: "v3" },
  kakeyaPreview: { engine: "ts-kakeya-preview", version: "v3" },
  cppPrecomputed: { engine: "cpp-precompute", version: "kakeya-voxel-v3-cpp" },
  pyodide: { engine: "pyodide-scipy", version: "v0.27.7" },
  cortexJs: { engine: "cortex-ce-js", version: "0.142.0" }
};
var runSeq = 0;
function nextRunId(prefix) {
  const ms = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${ms}-${rnd}-${runSeq++}`;
}
var history = /* @__PURE__ */ new Map();
function getExperimentRun(runId) {
  return history.get(runId);
}
function registerImportedRun(run) {
  if (history.has(run.runId)) throw new Error(`Run already recorded: ${run.runId}`);
  if (run.status === "resolved" && run.result === void 0) throw new Error(`Imported run ${run.runId} has no result`);
  history.set(run.runId, freezeRecord(structuredClone(run)));
}
function listExperimentRuns(filter) {
  let rows = [...history.values()];
  if (filter?.kind) rows = rows.filter((r) => r.spec.kind === filter.kind);
  if (filter?.parentRunId) rows = rows.filter((r) => r.parentRunId === filter.parentRunId);
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows.slice(0, filter?.limit ?? 50);
}
function exportExperimentRuns(runIds) {
  return JSON.stringify(runIds.map((id) => {
    const run = history.get(id);
    if (!run) throw new Error(`Unknown run: ${id}`);
    return run;
  }), null, 2);
}
function freezeRecord(value) {
  if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeRecord(child);
  }
  return value;
}
function assertFiniteNumbers(value, path = "result") {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertFiniteNumbers(value[i], `${path}[${i}]`);
    return;
  }
  if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    for (const [key, child] of Object.entries(value)) assertFiniteNumbers(child, `${path}.${key}`);
  }
}
var ExperimentExecutionError = class extends Error {
  constructor(run) {
    super(run.errors.join("; "));
    this.run = run;
  }
  run;
};
async function executeSpec(spec, engine2, compute, lineage = {}) {
  const t02 = performance.now();
  const startedAt = Date.now();
  const input = structuredClone(spec);
  let result;
  let failure;
  try {
    result = await compute();
    assertFiniteNumbers(result);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  const run = {
    runId: nextRunId(spec.kind.replace(/\./g, "-")),
    spec: input,
    status: failure === void 0 ? "resolved" : "error",
    result,
    engine: engine2.engine,
    engineVersion: engine2.version,
    durationMs: Math.max(0, Math.round(performance.now() - t02)),
    evidence: "CALCULATED",
    createdAt: startedAt,
    startedAt,
    parentRunId: lineage.parentRunId,
    errors: failure === void 0 ? [] : [failure]
  };
  freezeRecord(run);
  history.set(run.runId, run);
  if (failure !== void 0) throw new ExperimentExecutionError(run);
  return run;
}

// src/experiments/runRepository.ts
function numericLeaves(value, prefix = "") {
  const out = /* @__PURE__ */ new Map();
  if (typeof value === "number" && Number.isFinite(value)) {
    out.set(prefix || "value", value);
  } else if (Array.isArray(value)) {
    const finite2 = value.filter((v) => typeof v === "number" && Number.isFinite(v));
    if (finite2.length) out.set(`${prefix}(${finite2.length})`, finite2.length);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      for (const [pk, pv] of numericLeaves(v, prefix ? `${prefix}.${k}` : k)) out.set(pk, pv);
    }
  }
  return out;
}
function compareRuns(runA, runB) {
  const a = getExperimentRun(runA);
  const b = getExperimentRun(runB);
  if (!a) throw new Error(`Unknown run: ${runA}`);
  if (!b) throw new Error(`Unknown run: ${runB}`);
  const leavesA = numericLeaves(a.result);
  const leavesB = numericLeaves(b.result);
  const keys = [.../* @__PURE__ */ new Set([...leavesA.keys(), ...leavesB.keys()])].sort();
  const rows = keys.filter((k) => !k.includes("(")).map((k) => {
    const av = leavesA.get(k) ?? null;
    const bv = leavesB.get(k) ?? null;
    return { key: k, a: av, b: bv, delta: av !== null && bv !== null ? bv - av : null };
  });
  return { runA, runB, kindA: a.spec.kind, kindB: b.spec.kind, rows };
}
function importRuns(bundleJson) {
  const parsed = JSON.parse(bundleJson);
  if (!Array.isArray(parsed)) throw new Error("Run bundle must be a JSON array");
  const runs = parsed;
  for (const r of runs) {
    if (!r?.runId || !r?.spec || !r?.status || !Array.isArray(r.errors)) {
      throw new Error("Run bundle entry does not match the ExperimentRun protocol");
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const r of runs) {
    if (getExperimentRun(r.runId)) throw new Error(`Run already recorded: ${r.runId}`);
    if (seen.has(r.runId)) throw new Error(`Run already recorded: ${r.runId}`);
    seen.add(r.runId);
  }
  for (const r of runs) registerImportedRun(r);
  return { imported: runs.length };
}

// src/skills/registry.ts
var num = { type: "number" };
var range = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
var SKILL_REGISTRY = [
  {
    name: "formula.evaluate",
    description: "Evaluate a MathJSON expression at given variable bindings via the Cortex Compute Engine (no UI).",
    inputSchema: {
      type: "object",
      required: ["expression", "bindings"],
      properties: { expression: {}, bindings: { type: "object" } }
    },
    outputSchema: { type: "object", required: ["value"], properties: { value: num } },
    runtime: "cortex-js",
    renderer: "none",
    deterministic: true,
    version: "cortex-ce@0.142.0",
    evidence: "CALCULATED",
    runKind: "formula.curve",
    implemented: true
  },
  {
    name: "formula.plot",
    description: "Sample a compiled formula over the independent range with parameter chips; emits a curve run.",
    inputSchema: {
      type: "object",
      required: ["expression", "parameters", "independent", "range"],
      properties: {
        expression: {},
        parameters: { type: "array", items: { type: "string" } },
        independent: { type: "string" },
        range,
        values: { type: "object" },
        samples: { type: "integer", minimum: 2, maximum: 20001 }
      }
    },
    outputSchema: {
      type: "object",
      required: ["points", "peak", "integral"],
      properties: { points: { type: "array" }, peak: num, integral: num }
    },
    runtime: "cortex-js",
    renderer: "jsxgraph",
    deterministic: true,
    version: "cortex-ce@0.142.0",
    evidence: "CALCULATED",
    runKind: "formula.curve",
    implemented: true
  },
  {
    name: "geometry.2d",
    description: "2D geometric measurement: Perron tree (k, \u03B1) union area or unit-needle sweep area.",
    inputSchema: {
      type: "object",
      required: ["construction", "params"],
      properties: {
        construction: { type: "string", enum: ["perron-tree", "needle-sweep"] },
        params: { type: "object" }
      }
    },
    outputSchema: { type: "object", properties: { area: num, ratio: num } },
    runtime: "kakeya-worker",
    renderer: "jsxgraph",
    deterministic: true,
    version: "ts-kakeya-2d@v3",
    evidence: "CALCULATED",
    runKind: "perron.tree",
    implemented: true
  },
  {
    name: "ode.solve",
    description: "Integrate a 2-species Lotka\u2013Volterra system (system.kind='lv2') over tSpan with a fixed-step RK4 kernel.",
    inputSchema: {
      type: "object",
      required: ["system", "initialValues", "tSpan"],
      properties: {
        system: { type: "object" },
        initialValues: { type: "object" },
        tSpan: range
      }
    },
    outputSchema: { type: "object", properties: { t: { type: "array" }, y: { type: "object" } } },
    runtime: "pyodide",
    renderer: "plot",
    deterministic: true,
    version: "ts-rk4@0.1",
    evidence: "CALCULATED",
    runKind: "lv.ode",
    implemented: true
  },
  {
    name: "ode.phase",
    description: "Integrate a generic 2-state autonomous ODE (system.kind='generic2') whose right-hand sides are the PAPER'S OWN LaTeX, compiled by Cortex to JS and integrated with fixed-step RK4. Phase plane, time series and period all come from the ONE run. States may take any sign (damped oscillators are physics, not populations).",
    inputSchema: {
      type: "object",
      required: ["system", "initialState", "tSpan"],
      properties: {
        system: {
          type: "object",
          required: ["kind", "states", "rhs"],
          properties: {
            kind: { type: "string" },
            states: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
            rhs: { type: "object", description: "state name \u2192 LaTeX right-hand side" },
            params: { type: "object", description: "constant symbol \u2192 value bindings" }
          }
        },
        initialState: { type: "object", description: "state name \u2192 value at t0" },
        tSpan: range
      }
    },
    outputSchema: {
      type: "object",
      properties: { t: { type: "array" }, s0: { type: "array" }, s1: { type: "array" }, period0: { type: "number" }, maxAbs0: { type: "number" }, maxAbs1: { type: "number" } }
    },
    runtime: "cortex-js",
    renderer: "jsxgraph",
    deterministic: true,
    version: "ode-rk4@0.2",
    evidence: "CALCULATED",
    runKind: "ode.phase2",
    implemented: true
  },
  {
    name: "kakeya.generate",
    aliases: ["simulate_geometry"],
    description: "Generate the \u03B4-tube family geometry (directions, packing, radius) as a kakeya.geometry run.",
    inputSchema: {
      type: "object",
      required: ["deltaExp", "nTubes", "packing"],
      properties: { deltaExp: num, nTubes: { type: "integer" }, packing: num }
    },
    outputSchema: { type: "object", properties: { tubes: { type: "array" }, boundingRadius: num } },
    runtime: "kakeya-worker",
    renderer: "r3f",
    deterministic: true,
    version: "ts-kakeya-worker@v3",
    evidence: "CALCULATED",
    runKind: "kakeya.geometry",
    implemented: true
  },
  {
    name: "kakeya.measure",
    aliases: ["measure_volume", "measure_multiplicity"],
    description: "Finite-scale voxel measurement of a tube family: occupied cells, union volume, multiplicity.",
    inputSchema: {
      type: "object",
      required: ["deltaExp", "nTubes", "packing"],
      properties: {
        deltaExp: num,
        nTubes: { type: "integer" },
        packing: num,
        res: { type: "integer", minimum: 1, maximum: 1024 }
      }
    },
    outputSchema: {
      type: "object",
      required: ["occupiedVolume", "avgMultiplicity", "maxMultiplicity"],
      properties: { occupiedVolume: num, avgMultiplicity: num, maxMultiplicity: { type: "integer" } }
    },
    runtime: "kakeya-worker",
    renderer: "r3f",
    deterministic: true,
    version: "ts-kakeya-worker@v3",
    evidence: "CALCULATED",
    runKind: "kakeya.voxel",
    implemented: true
  },
  {
    name: "kakeya.sweep",
    aliases: ["run_scale_sweep"],
    description: "Parameter sweep of kakeya.measure over N \u2014 every datapoint is its own ExperimentRun.",
    inputSchema: {
      type: "object",
      required: ["param", "values"],
      properties: {
        param: { type: "string", enum: ["nTubes", "deltaExp", "packing"] },
        values: { type: "array", items: num, minItems: 1 },
        nTubes: { type: "integer" },
        deltaExp: num,
        packing: num,
        res: { type: "integer", minimum: 1, maximum: 1024 }
      }
    },
    outputSchema: {
      type: "object",
      properties: { points: { type: "array", items: { type: "object" } } }
    },
    runtime: "kakeya-worker",
    renderer: "plot",
    deterministic: true,
    version: "ts-kakeya-worker@v3",
    evidence: "CALCULATED",
    runKind: "kakeya.sweep",
    implemented: true
  },
  {
    name: "experiment.fork",
    aliases: ["fork_experiment"],
    description: "Clone an experiment (same skill, new run lineage via parentRunId). No numerics by itself.",
    inputSchema: {
      type: "object",
      required: ["sourceRunId"],
      properties: { sourceRunId: { type: "string" }, parameterChanges: { type: "object" } }
    },
    outputSchema: { type: "object", required: ["forkRunId"], properties: { forkRunId: { type: "string" } } },
    runtime: "canvas",
    renderer: "canvas",
    deterministic: true,
    version: "desk@v6",
    evidence: "CALCULATED",
    implemented: true
  },
  {
    name: "experiment.compare",
    aliases: ["compare_experiments"],
    description: "Compare two ExperimentRuns metric-by-metric; differences reference run ids only.",
    inputSchema: {
      type: "object",
      required: ["runA", "runB"],
      properties: { runA: { type: "string" }, runB: { type: "string" } }
    },
    outputSchema: { type: "object", properties: { rows: { type: "array" } } },
    runtime: "canvas",
    renderer: "canvas",
    deterministic: true,
    version: "desk@v6",
    evidence: "CALCULATED",
    implemented: true
  },
  {
    name: "paper.trace-source",
    description: "Return the Docling source anchor (page + bbox) for a formula/run and move the camera there.",
    inputSchema: { type: "object", required: ["anchorId"], properties: { anchorId: { type: "string" } } },
    outputSchema: { type: "object", properties: { page: { type: "integer" }, bbox: { type: "object" } } },
    runtime: "canvas",
    renderer: "canvas",
    deterministic: true,
    version: "desk@v6",
    evidence: "PAPER",
    implemented: true
  },
  {
    name: "mujoco.simulate",
    description: "Headless MuJoCo simulation of a vendored demo scene (upstream zalo/mujoco_wasm@f6b202c, @mujoco/mujoco 3.12.0 single-thread WASM): real mj_step physics with model-level params (gravityZ/windX/timestep). Runs in the backend engine; the page imports the resulting Runs.",
    inputSchema: {
      type: "object",
      required: ["scene", "steps"],
      properties: {
        scene: { type: "string" },
        steps: { type: "integer", minimum: 1, maximum: 1e5 },
        sampleEvery: { type: "integer", minimum: 1, maximum: 1e5 },
        params: { type: "object" }
      }
    },
    outputSchema: { type: "object", required: ["metrics"], properties: { metrics: { type: "object" } } },
    runtime: "wasm",
    renderer: "r3f",
    deterministic: true,
    version: "mujoco-wasm@3.12.0",
    evidence: "CALCULATED",
    runKind: "mujoco.sim",
    implemented: true
  },
  {
    name: "challenge.attempt",
    description: "Play one attempt of a playable challenge (projectile / pendulum / tubes): a code-built model (programmatic MJCF or Kakeya geometry) computed by the REAL engine; hit, error, period and score are read from the computed result \u2014 never asserted. Shares goal, constraints and budget between user and agent.",
    inputSchema: {
      type: "object",
      required: ["challenge", "changes"],
      properties: {
        challenge: { type: "string", enum: ["projectile", "pendulum", "tubes"] },
        changes: { type: "object" },
        level: { type: "object" }
      }
    },
    outputSchema: { type: "object", required: ["result"], properties: { result: { type: "object" } } },
    runtime: "wasm",
    renderer: "r3f",
    deterministic: true,
    version: "challenge-kernel@0.1",
    evidence: "CALCULATED",
    runKind: "challenge.attempt",
    implemented: true
  }
];
var byName = new Map(SKILL_REGISTRY.map((s) => [s.name, s]));
var byAlias = new Map(SKILL_REGISTRY.flatMap((s) => (s.aliases ?? []).map((a) => [a, s])));
function getSkill(name) {
  return byName.get(name) ?? byAlias.get(name);
}
function schemaError(schema, value, path) {
  const type = schema.type;
  if (type === "object" && (value === null || typeof value !== "object" || Array.isArray(value)) || type === "array" && !Array.isArray(value) || type === "string" && typeof value !== "string" || type === "number" && (typeof value !== "number" || !Number.isFinite(value)) || type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value))) return `${path}: expected ${type}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: invalid choice`;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${path}: below minimum ${schema.minimum}`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${path}: above maximum ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path}: too few items`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path}: too many items`;
    if (schema.items) for (let i = 0; i < value.length; i++) {
      const error = schemaError(schema.items, value[i], `${path}[${i}]`);
      if (error) return error;
    }
  } else if (value && typeof value === "object") {
    const obj = value;
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(obj, key)) return `${path}: missing field ${key}`;
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(obj, key)) {
        const error = schemaError(child, obj[key], `${path}.${key}`);
        if (error) return error;
      }
    }
  }
  return null;
}

// src/skills/executor.ts
init_directions();
init_tubes();
init_voxels3d();

// src/kakeya/perron.ts
var PERRON_TRIANGLE_AREA = 1 / Math.sqrt(3);
function perronTree(k, alpha, raster = 900) {
  if (k < 0 || k > 6) throw new Error("k must be in [0,6] (2^k \u2264 64 triangles)");
  if (alpha <= 0.5 || alpha > 1) throw new Error("alpha must be in (0.5, 1]");
  const W = 2 / Math.sqrt(3);
  const apex = { x: W / 2, y: 1 };
  const n = 2 ** k;
  const bSub = W / n;
  const offsets = new Float64Array(n);
  for (let r = 1; r <= k; r++) {
    const g = 2 ** (r - 1);
    const heartWidth = g * bSub * alpha ** (r - 1);
    const t = 2 * heartWidth * (1 - alpha);
    for (let m = 0; m < n / (2 * g); m++) {
      for (let i = m * 2 * g + g; i < (m + 1) * 2 * g; i++) offsets[i] -= t;
    }
  }
  const triangles = [];
  const medians = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * bSub + offsets[i];
    const x1 = (i + 1) * bSub + offsets[i];
    const a = { x: apex.x + offsets[i], y: 1 };
    triangles.push({ apex: a, base0: { x: x0, y: 0 }, base1: { x: x1, y: 0 } });
    const bx = (x0 + x1) / 2;
    const len = Math.hypot(bx - a.x, 1);
    medians.push({ a, b: { x: a.x + (bx - a.x) / len, y: a.y - 1 / len } });
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (const t of triangles) {
    minX = Math.min(minX, t.base0.x, t.apex.x);
    maxX = Math.max(maxX, t.base1.x, t.apex.x);
  }
  const cell = (maxX - minX) / raster;
  const rows = Math.max(1, Math.ceil(1 / cell) + 1);
  const grid = new Uint8Array(raster * rows);
  for (const t of triangles) {
    const ax = t.apex.x;
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * cell;
      if (y >= 1) break;
      const f = 1 - y;
      const left = ax + (t.base0.x - ax) * f;
      const right = ax + (t.base1.x - ax) * f;
      const i0 = Math.max(0, Math.floor((left - minX) / cell));
      const i1 = Math.min(raster - 1, Math.ceil((right - minX) / cell) - 1);
      for (let i = i0; i <= i1; i++) {
        const cx = minX + (i + 0.5) * cell;
        if (cx >= left && cx <= right) grid[j * raster + i] = 1;
      }
    }
  }
  let count = 0;
  for (let idx = 0; idx < grid.length; idx++) count += grid[idx];
  const computedArea = count * cell * cell;
  return {
    k,
    alpha,
    triangles,
    medians,
    triangleArea: PERRON_TRIANGLE_AREA,
    computedArea,
    boundArea: (alpha ** (2 * k) + 2 * (1 - alpha)) * PERRON_TRIANGLE_AREA,
    raster
  };
}

// src/workers/voxelClient.ts
import * as Comlink from "comlink";
var remote = null;
function getRemote() {
  if (remote) return remote;
  const worker = new Worker(new URL("./voxel.worker.ts", import.meta.url), { type: "module" });
  remote = Comlink.wrap(worker);
  return remote;
}
function isWorkerAvailable() {
  return typeof Worker !== "undefined";
}
async function measureVoxelCover(tubes, res, visRes) {
  if (!isWorkerAvailable()) {
    const { computeVoxelCoverage: computeVoxelCoverage2 } = await Promise.resolve().then(() => (init_voxels3d(), voxels3d_exports));
    return computeVoxelCoverage2(tubes, res, visRes);
  }
  return getRemote().measureVoxelCover(tubes, res, visRes);
}

// src/formula/engine.ts
import { ComputeEngine } from "@cortex-js/compute-engine";
var engine = null;
function getEngine() {
  if (!engine) engine = new ComputeEngine();
  return engine;
}
var CORTEX_VERSION = "0.142.0";

// src/formula/analyze.ts
var INDEPENDENT_PREFERENCE = ["x", "t", "\u03B8", "theta", "u", "s"];
var TRIG_DOMAIN = [-7, 7];
var PLAIN_DOMAIN = [-5, 5];
function containsTrig(e) {
  if (Array.isArray(e)) {
    const head = e[0];
    if (typeof head === "string" && /^(Sin|Cos|Tan|Sec|Csc|Cot)$/.test(head)) return true;
    return e.slice(1).some((x) => containsTrig(x));
  }
  if (e && typeof e === "object" && "fn" in e) {
    return containsTrig(e.fn);
  }
  return false;
}
var PARAM_DEFAULTS = { default: 1, min: -5, max: 5, step: 0.05 };
function analyzeFormula(latex) {
  const ce = getEngine();
  const trimmed = latex.trim().replace(/[.;,]+$/, "").trim();
  const base = {
    ok: false,
    latex: trimmed,
    mathjson: trimmed,
    rhs: trimmed,
    rhsLatex: trimmed,
    output: null,
    independent: null,
    params: [],
    domain: PLAIN_DOMAIN
  };
  if (!trimmed) return { ...base, error: "empty formula" };
  let expr;
  try {
    expr = ce.parse(trimmed);
  } catch (err) {
    return { ...base, error: `parse failed: ${String(err)}` };
  }
  if (expr.errors.length > 0 || !expr.isValid) {
    return { ...base, error: `invalid LaTeX: ${expr.errors.map(String).join("; ") || "parse error"}` };
  }
  const mathjson = expr.json;
  let lhs = null;
  let rhs = mathjson;
  if (Array.isArray(mathjson) && mathjson[0] === "Equal" && mathjson.length === 3) {
    lhs = mathjson[1];
    rhs = mathjson[2];
  }
  if (Array.isArray(rhs) && rhs.length === 0) return { ...base, error: "empty right-hand side" };
  const rhsExpr = ce.box(rhs);
  const free = [...rhsExpr.freeVariables];
  const independent = INDEPENDENT_PREFERENCE.find((name) => free.includes(name)) ?? (free.length === 1 ? free[0] : null);
  if (!independent) {
    return { ...base, error: "no independent variable found" };
  }
  const paramNames = free.filter((v) => v !== independent).sort((a, b) => a.localeCompare(b));
  let output = null;
  if (typeof lhs === "string") output = lhs;
  else if (Array.isArray(lhs) && lhs.length === 2 && typeof lhs[0] === "string") output = lhs[0];
  return {
    ok: true,
    latex: trimmed,
    mathjson,
    rhs,
    rhsLatex: rhsExpr.latex,
    output,
    independent,
    params: paramNames.map((name) => ({ name, ...PARAM_DEFAULTS })),
    domain: containsTrig(rhs) ? TRIG_DOMAIN : PLAIN_DOMAIN
  };
}

// src/skills/playPlan.ts
var PLAN_REGISTRY = /* @__PURE__ */ new Map();
var PLAN_COMPANION_SKILLS = /* @__PURE__ */ new Set([
  "experiment.fork",
  "experiment.compare",
  "paper.trace-source",
  "kakeya.sweep",
  // companion measurement of a kakeya plan's terminal run
  "kakeya.generate"
  // geometry prerequisite of a kakeya measurement plan
]);
function registerPlan(plan) {
  if (!plan || typeof plan.planId !== "string" || typeof plan.skill !== "string" || typeof plan.goal !== "string") {
    throw new Error("registerPlan: plan must carry planId/skill/goal");
  }
  if (!PLAN_REGISTRY.has(plan.planId)) PLAN_REGISTRY.set(plan.planId, plan);
  return plan;
}
function getPlan(planId) {
  return PLAN_REGISTRY.get(planId);
}
function planCoversSkill(plan, skill) {
  if (plan.skill === skill) return true;
  if (PLAN_COMPANION_SKILLS.has(skill)) return true;
  const target = getSkill(skill);
  const planned = getSkill(plan.skill);
  if (target && planned) {
    return (target.aliases?.includes(plan.skill) ?? false) || (planned.aliases?.includes(skill) ?? false);
  }
  return false;
}
function registerPlanFromJson(raw) {
  const p = raw;
  if (!p || typeof p.planId !== "string" || typeof p.skill !== "string" || typeof p.goal !== "string") {
    throw new Error("plan JSON must carry planId, skill and goal");
  }
  return registerPlan({
    planId: p.planId,
    goal: p.goal,
    source: p.source ?? { docId: "engine", title: "engine-submitted plan" },
    variables: Array.isArray(p.variables) ? p.variables : [],
    assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
    skill: p.skill,
    skillVersion: p.skillVersion ?? "?",
    renderer: p.renderer ?? "none",
    metrics: Array.isArray(p.metrics) ? p.metrics : [],
    inputs: p.inputs ?? {},
    evidenceBasis: p.evidenceBasis ?? "engine-submitted PlayPlan",
    successCriteria: p.successCriteria ?? "",
    nonClaims: Array.isArray(p.nonClaims) ? p.nonClaims : [],
    binding: p.binding,
    createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now()
  });
}

// src/formula/compile.ts
import { compile } from "@cortex-js/compute-engine";
function compileFormula(rhs) {
  let result;
  try {
    result = compile(rhs, { to: "javascript" });
  } catch {
    return null;
  }
  if (!result || typeof result.run !== "function") return null;
  const rawRun = result.run;
  const run = (vars) => {
    const v = rawRun(vars);
    return typeof v === "number" ? v : Number(v);
  };
  return {
    run,
    code: result.code ?? "",
    success: result.success,
    engine: result.success ? `cortex-ce@${CORTEX_VERSION}\xB7js` : `cortex-ce@${CORTEX_VERSION}\xB7interp`,
    freeSymbols: result.freeSymbols ?? []
  };
}

// src/skills/executor.ts
var KAKEYA_SEED = 20250224;
var VIS_RES = 16;
function compileExpr(expression) {
  let expr = expression;
  if (typeof expr === "string") {
    expr = getEngine().parse(expr).json;
  }
  if (Array.isArray(expr) && expr[0] === "Equal" && expr.length >= 3) {
    expr = expr[2];
  }
  const compiled = compile2(expr, { to: "javascript" });
  if (!compiled || typeof compiled.run !== "function") {
    throw new Error("Cortex could not compile the expression to JavaScript");
  }
  return compiled;
}
async function runFormulaEvaluate(input, opts = {}) {
  const compiled = compileExpr(input.expression);
  return executeSpec(
    {
      kind: "formula.value",
      params: {},
      seed: 0,
      model: { expression: input.expression, bindings: input.bindings },
      source: opts.source
    },
    ENGINES.cortexJs,
    () => {
      const raw = compiled.run(input.bindings);
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Formula produced a non-finite value: ${String(raw)}`);
      return { value };
    }
  );
}
async function runFormulaPlot(input, opts) {
  const parameters = input.parameters ?? [];
  const values = input.values ?? {};
  const independent = String(input.independent);
  const [x0, x1] = input.range;
  const samples = typeof input.samples === "number" ? input.samples : 361;
  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(`formula.plot requires samples >= 2 (got ${input.samples}) \u2014 fewer yields an empty curve or a divide-by-zero`);
  }
  const compiled = compileExpr(input.expression);
  return executeSpec(
    {
      kind: "formula.curve",
      params: Object.fromEntries(parameters.map((p) => [p, Number(values[p] ?? 1)])),
      seed: 0,
      model: { expression: input.expression, independent, range: [x0, x1], samples, parameters },
      source: opts.source
    },
    ENGINES.cortexJs,
    () => {
      const points = [];
      let peak = 0;
      let integral = 0;
      let previous = null;
      for (let i = 0; i < samples; i++) {
        const x = x0 + (x1 - x0) * i / (samples - 1);
        const raw = compiled.run({ ...values, [independent]: x });
        const y = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(y)) throw new Error(`Non-finite value at ${independent}=${x}`);
        points.push([x, y]);
        peak = Math.max(peak, Math.abs(y));
        if (previous) integral += (Math.abs(y) + Math.abs(previous[1])) * (x - previous[0]) / 2;
        previous = [x, y];
      }
      return { points, peak, integral };
    },
    { parentRunId: opts.parentRunId }
  );
}
function tubesFor(deltaExp, nTubes, packing) {
  return makeTubes(fibonacciDirections(nTubes), 2 ** -deltaExp, packing, KAKEYA_SEED);
}
async function measureVoxels(tubes, res) {
  if (isWorkerAvailable()) {
    const r2 = await measureVoxelCover(tubes, res, VIS_RES);
    return {
      occupiedVolume: r2.occupiedVolume,
      sumTubeVolume: r2.sumTubeVolume,
      maxMultiplicity: r2.maxMultiplicity,
      avgMultiplicity: r2.avgMultiplicity
    };
  }
  const r = computeVoxelCoverage(tubes, res, VIS_RES);
  return {
    occupiedVolume: r.occupiedVolume,
    sumTubeVolume: r.sumTubeVolume,
    maxMultiplicity: r.maxMultiplicity,
    avgMultiplicity: r.avgMultiplicity
  };
}
async function runKakeyaGenerate(input, opts) {
  const deltaExp = Number(input.deltaExp);
  const nTubes = Number(input.nTubes);
  const packing = Number(input.packing);
  const tubes = tubesFor(deltaExp, nTubes, packing);
  return executeSpec(
    {
      kind: "kakeya.geometry",
      params: { delta: 2 ** -deltaExp, packing, nTubes },
      seed: KAKEYA_SEED,
      model: { deltaExp, packing, nTubes },
      source: opts.source
    },
    ENGINES.kakeyaWorker,
    () => tubes,
    { parentRunId: opts.parentRunId }
  );
}
async function runKakeyaMeasure(input, opts) {
  const deltaExp = Number(input.deltaExp);
  const nTubes = Number(input.nTubes);
  const packing = Number(input.packing);
  const res = typeof input.res === "number" ? Number(input.res) : 48;
  const tubes = tubesFor(deltaExp, nTubes, packing);
  return executeSpec(
    {
      kind: "kakeya.voxel",
      params: { deltaExp, packing, nTubes },
      seed: KAKEYA_SEED,
      res,
      model: { deltaExp, packing, nTubes, res },
      source: opts.source
    },
    ENGINES.kakeyaWorker,
    () => measureVoxels(tubes, res),
    { parentRunId: opts.parentRunId }
  );
}
async function runKakeyaSweep(input, opts) {
  const param = String(input.param);
  const values = input.values;
  const deltaExp = typeof input.deltaExp === "number" ? Number(input.deltaExp) : 4;
  const packing = typeof input.packing === "number" ? Number(input.packing) : 0;
  const res = typeof input.res === "number" ? Number(input.res) : 40;
  if (param !== "nTubes" && typeof input.nTubes !== "number") {
    throw new Error(`kakeya.sweep over '${param}' requires a baseline nTubes (the fixed tube family being swept)`);
  }
  const nTubes = typeof input.nTubes === "number" ? Number(input.nTubes) : 0;
  return executeSpec(
    {
      kind: "kakeya.sweep",
      params: { deltaExp, packing },
      seed: KAKEYA_SEED,
      res,
      model: { param, values, deltaExp, packing, res, ...nTubes ? { nTubes } : {} },
      source: opts.source
    },
    ENGINES.kakeyaWorker,
    async () => {
      const points = [];
      for (const v of values) {
        const child = await runKakeyaMeasure(
          param === "nTubes" ? { ...input, nTubes: v, res } : param === "packing" ? { nTubes, deltaExp, packing: v, res } : { nTubes, deltaExp: v, packing, res },
          { ...opts, parentRunId: opts.parentRunId }
        );
        points.push({ x: v, y: child.result.occupiedVolume, series: "sweep", runId: child.runId });
      }
      return { points };
    },
    { parentRunId: opts.parentRunId }
  );
}
var PERRON_RASTER = 900;
async function runGeometry2D(input, opts) {
  const construction = String(input.construction);
  const params = input.params ?? {};
  if (construction === "perron-tree") {
    const k = Number(params.k);
    const alpha = Number(params.alpha);
    if (!Number.isInteger(k) || k < 1 || k > 6) throw new Error(`perron-tree: k must be an integer 1..6, got ${k}`);
    if (!(alpha >= 0 && alpha <= 1)) throw new Error(`perron-tree: alpha must be in [0,1], got ${alpha}`);
    return executeSpec(
      {
        kind: "perron.tree",
        params: { k, alpha },
        seed: 0,
        res: PERRON_RASTER,
        model: { construction, k, alpha, raster: PERRON_RASTER }
      },
      ENGINES.kakeyaWorker,
      () => {
        const r = perronTree(k, alpha, PERRON_RASTER);
        return {
          k,
          alpha,
          computedArea: r.computedArea,
          triangleArea: r.triangleArea,
          boundArea: r.boundArea,
          ratio: r.computedArea / r.triangleArea,
          triangles: r.triangles.length
        };
      },
      { parentRunId: opts.parentRunId }
    );
  }
  const grid = Number(params.grid ?? 96);
  if (!Number.isInteger(grid) || grid < 8 || grid > 512) throw new Error(`needle-sweep: grid must be an integer 8..512, got ${grid}`);
  return executeSpec(
    {
      kind: "perron.tree",
      params: { grid },
      seed: 0,
      res: grid,
      model: { construction, grid },
      source: opts.source
    },
    ENGINES.kakeyaWorker,
    () => {
      const cell = 1 / grid;
      const covered = new Uint8Array(grid * grid);
      let touched = 0;
      const steps = Math.max(64, grid * 4);
      for (let s = 0; s <= steps; s++) {
        const theta = Math.PI / 2 * (s / steps);
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);
        for (let t = 0; t <= 1; t += cell / 4) {
          const px = t * dx;
          const py = t * dy;
          const ix = Math.min(grid - 1, Math.max(0, Math.floor(px / cell)));
          const iy = Math.min(grid - 1, Math.max(0, Math.floor(py / cell)));
          const idx = iy * grid + ix;
          if (!covered[idx]) {
            covered[idx] = 1;
            touched++;
          }
        }
      }
      const sweptArea = touched * cell * cell;
      return { grid, sweptArea, analyticArea: Math.PI / 4, ratio: sweptArea / (Math.PI / 4) };
    },
    { parentRunId: opts.parentRunId }
  );
}
var ODE_STEPS = 2400;
async function runOdeSolve(input, opts) {
  const system = input.system ?? {};
  if (system.kind !== "lv2") {
    throw new Error(`ode.solve: only system.kind='lv2' (2-species Lotka\u2013Volterra) is wired in 0.1, got ${JSON.stringify(system.kind ?? null)}`);
  }
  const p = input.system.params ?? {};
  const y0 = input.initialValues ?? {};
  const tSpan = input.tSpan;
  const alpha = Number(p.alpha ?? 1.1), beta = Number(p.beta ?? 0.4);
  const gamma = Number(p.gamma ?? 0.4), delta = Number(p.delta ?? 0.1);
  let prey0 = Number(y0.prey ?? 1), predator0 = Number(y0.predator ?? 0.5);
  for (const [k, v] of Object.entries({ alpha, beta, gamma, delta, prey: prey0, predator: predator0 })) {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`ode.solve: ${k} must be a positive finite number, got ${v}`);
  }
  const [t02, t1] = tSpan;
  if (!(t1 > t02) || !Number.isFinite(t02) || !Number.isFinite(t1)) throw new Error(`ode.solve: tSpan must be [t0,t1] with t1>t0`);
  return executeSpec(
    {
      kind: "lv.ode",
      params: { alpha, beta, gamma, delta, prey0, predator0, t0: t02, t1 },
      seed: 0,
      model: { kind: "lv2", params: { alpha, beta, gamma, delta }, initialValues: { prey: prey0, predator: predator0 }, tSpan, steps: ODE_STEPS },
      source: opts.source
    },
    // RK4 fixed-step in TS (CLI-verifiable without Pyodide); the Pyodide/
    // scipy path remains the browser-second-paper surface (odeGraph).
    { engine: "ts-rk4", version: "ode-rk4@0.1" },
    () => {
      const h = (t1 - t02) / ODE_STEPS;
      const f = (_t, x2, y2) => [
        alpha * x2 - beta * x2 * y2,
        -gamma * y2 + delta * x2 * y2
      ];
      let x = prey0;
      let y = predator0;
      const points = [{ t: t02, prey: x, predator: y }];
      const emitEvery = Math.max(1, Math.round(ODE_STEPS / 240));
      for (let i = 1; i <= ODE_STEPS; i++) {
        const t = t02 + (i - 1) * h;
        const [k1x, k1y] = f(t, x, y);
        const [k2x, k2y] = f(t + h / 2, x + h / 2 * k1x, y + h / 2 * k1y);
        const [k3x, k3y] = f(t + h / 2, x + h / 2 * k2x, y + h / 2 * k2y);
        const [k4x, k4y] = f(t + h, x + h * k3x, y + h * k3y);
        x += h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x);
        y += h / 6 * (k1y + 2 * k2y + 2 * k3y + k4y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`ode.solve: trajectory diverged at t=${(t + h).toFixed(3)} \u2014 check parameters`);
        if (x < 0 || y < 0) throw new Error(`ode.solve: population went negative at t=${(t + h).toFixed(3)} \u2014 step size too large for stiffness`);
        if (i % emitEvery === 0 || i === ODE_STEPS) points.push({ t: t02 + i * h, prey: x, predator: y });
      }
      const V0 = delta * prey0 - gamma * Math.log(prey0) + beta * predator0 - alpha * Math.log(predator0);
      const last = points[points.length - 1];
      const V1 = delta * last.prey - gamma * Math.log(last.prey) + beta * last.predator - alpha * Math.log(last.predator);
      return { t: points.map((p2) => p2.t), y: { prey: points.map((p2) => p2.prey), predator: points.map((p2) => p2.predator) }, conservedDrift: Math.abs(V1 - V0), conserved0: V0 };
    },
    { parentRunId: opts.parentRunId }
  );
}
var ODE_PHASE_STEPS = 2400;
function compileOdeRhs(latex, states) {
  const a = analyzeFormula(latex);
  if (!a.ok) return null;
  const compiled = compileFormula(a.rhs);
  if (!compiled) return null;
  const [s0, s1] = states;
  return (x, y) => {
    const raw = compiled.run({ [s0]: x, [s1]: y });
    return typeof raw === "number" ? raw : Number(raw);
  };
}
async function runOdePhase(input, opts) {
  const system = input.system;
  if (system?.kind !== "generic2" || !Array.isArray(system.states) || system.states.length !== 2) {
    throw new Error(`ode.phase: only system.kind='generic2' with exactly 2 states is supported, got ${JSON.stringify(system?.kind ?? null)}`);
  }
  const [s0name, s1name] = system.states;
  const rhs0 = compileOdeRhs(String(system.rhs?.[s0name] ?? ""), [s0name, s1name]);
  const rhs1 = compileOdeRhs(String(system.rhs?.[s1name] ?? ""), [s0name, s1name]);
  if (!rhs0 || !rhs1) throw new Error(`ode.phase: could not compile the paper's right-hand sides for states ${s0name}, ${s1name}`);
  const initial = input.initialState ?? {};
  const x0 = Number(initial[s0name]);
  const y0 = Number(initial[s1name]);
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) throw new Error(`ode.phase: initialState must provide finite ${s0name} and ${s1name}`);
  const tSpan = input.tSpan;
  const [t02, t1] = tSpan;
  if (!(t1 > t02) || !Number.isFinite(t02) || !Number.isFinite(t1)) throw new Error("ode.phase: tSpan must be [t0,t1] with t1>t0");
  return executeSpec(
    {
      kind: "ode.phase2",
      params: { [s0name]: x0, [s1name]: y0, t0: t02, t1 },
      seed: 0,
      model: { system: { kind: "generic2", states: system.states, rhs: system.rhs, params: system.params ?? {} }, initialState: initial, tSpan, steps: ODE_PHASE_STEPS },
      source: opts.source
    },
    { engine: "ts-rk4", version: "ode-rk4@0.2" },
    () => {
      const h = (t1 - t02) / ODE_PHASE_STEPS;
      const f = (_t, x2, y2) => [rhs0(x2, y2), rhs1(x2, y2)];
      let x = x0;
      let y = y0;
      const points = [{ t: t02, s0: x, s1: y }];
      const emitEvery = Math.max(1, Math.round(ODE_PHASE_STEPS / 240));
      let maxAbs0 = Math.abs(x);
      let maxAbs1 = Math.abs(y);
      for (let i = 1; i <= ODE_PHASE_STEPS; i++) {
        const t = t02 + (i - 1) * h;
        const [k1x, k1y] = f(t, x, y);
        const [k2x, k2y] = f(t + h / 2, x + h / 2 * k1x, y + h / 2 * k1y);
        const [k3x, k3y] = f(t + h / 2, x + h / 2 * k2x, y + h / 2 * k2y);
        const [k4x, k4y] = f(t + h, x + h * k3x, y + h * k3y);
        x += h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x);
        y += h / 6 * (k1y + 2 * k2y + 2 * k3y + k4y);
        maxAbs0 = Math.max(maxAbs0, Math.abs(x));
        maxAbs1 = Math.max(maxAbs1, Math.abs(y));
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e8 || Math.abs(y) > 1e8) {
          throw new Error(`ode.phase: trajectory diverged at t=${(t + h).toFixed(3)} \u2014 check the paper's equations/initial state`);
        }
        if (i % emitEvery === 0 || i === ODE_PHASE_STEPS) points.push({ t: t02 + i * h, s0: x, s1: y });
      }
      let minS0 = Infinity;
      let maxS0 = -Infinity;
      for (const v of points) {
        if (v.s0 < minS0) minS0 = v.s0;
        if (v.s0 > maxS0) maxS0 = v.s0;
      }
      const mid = (minS0 + maxS0) / 2;
      const crossings = [];
      for (let i = 1; i < points.length; i++) {
        if (points[i - 1].s0 < mid && points[i].s0 >= mid) {
          const f0 = (mid - points[i - 1].s0) / (points[i].s0 - points[i - 1].s0 || 1e-12);
          crossings.push(points[i - 1].t + f0 * (points[i].t - points[i - 1].t));
        }
      }
      let period0 = null;
      if (crossings.length >= 2) {
        const gaps = crossings.slice(1).map((c, i) => c - crossings[i]);
        period0 = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      }
      return {
        t: points.map((p) => p.t),
        s0: points.map((p) => p.s0),
        s1: points.map((p) => p.s1),
        period0,
        maxAbs0,
        maxAbs1
      };
    },
    { parentRunId: opts.parentRunId }
  );
}
var COMPUTE_BY_KIND = {
  "formula.curve": "formula.plot",
  "formula.value": "formula.evaluate",
  "kakeya.voxel": "kakeya.measure",
  "kakeya.geometry": "kakeya.generate",
  "kakeya.sweep": "kakeya.sweep",
  "perron.tree": "geometry.2d",
  "lv.ode": "ode.solve",
  "ode.phase2": "ode.phase",
  "mujoco.sim": "mujoco.simulate",
  "challenge.attempt": "challenge.attempt"
};
var extraRunners = /* @__PURE__ */ new Map();
function registerSkillRunner(name, runner) {
  extraRunners.set(name, runner);
}
function inputForRun(runId) {
  const run = getExperimentRun(runId);
  if (!run) return { error: `Unknown run: ${runId}` };
  const skillName = COMPUTE_BY_KIND[run.spec.kind];
  if (!skillName) return { error: `No compute skill mapped for kind ${run.spec.kind}` };
  const input = inputFromSpec(skillName, run);
  if (!input) return { error: `Run ${runId} spec lacks the model fields needed for replay` };
  return { skill: skillName, input };
}
function applyForkChanges(skillName, forkInput, changes) {
  if (Object.keys(changes).length === 0) return;
  switch (skillName) {
    case "formula.plot": {
      const values = forkInput.values ?? {};
      const unknown = Object.keys(changes).filter((k) => !(k in values));
      if (unknown.length) throw new Error(`fork(formula.plot): unknown parameters ${JSON.stringify(unknown)} \u2014 known: ${JSON.stringify(Object.keys(values))}`);
      forkInput.values = { ...values, ...changes };
      return;
    }
    case "formula.evaluate": {
      const bindings = forkInput.bindings ?? {};
      const unknown = Object.keys(changes).filter((k) => !(k in bindings));
      if (unknown.length) throw new Error(`fork(formula.evaluate): unknown bindings ${JSON.stringify(unknown)}`);
      forkInput.bindings = { ...bindings, ...changes };
      return;
    }
    case "ode.solve": {
      const sys = forkInput.system ?? {};
      const params = { ...sys.params ?? {} };
      const init = { ...forkInput.initialValues ?? {} };
      for (const [k, v] of Object.entries(changes)) {
        if (k in params) params[k] = v;
        else if (k in init) init[k] = v;
        else throw new Error(`fork(ode.solve): unknown change '${k}' \u2014 not a system param or initial value`);
      }
      forkInput.system = { ...sys, params };
      forkInput.initialValues = init;
      return;
    }
    case "geometry.2d": {
      const params = { ...forkInput.params ?? {} };
      const unknown = Object.keys(changes).filter((k) => !(k in params));
      if (unknown.length) throw new Error(`fork(geometry.2d): unknown parameters ${JSON.stringify(unknown)}`);
      Object.assign(params, changes);
      forkInput.params = params;
      return;
    }
    case "kakeya.measure":
    case "kakeya.generate":
    case "kakeya.sweep": {
      const known = ["deltaExp", "nTubes", "packing", "res"];
      const unknown = Object.keys(changes).filter((k) => !known.includes(k));
      if (unknown.length) throw new Error(`fork(${skillName}): unknown parameters ${JSON.stringify(unknown)} \u2014 known: ${JSON.stringify(known)}`);
      Object.assign(forkInput, changes);
      return;
    }
    case "mujoco.simulate": {
      const params = { ...forkInput.params ?? {} };
      const known = ["gravityZ", "windX", "timestep"];
      const unknown = Object.keys(changes).filter((k) => !known.includes(k));
      if (unknown.length) throw new Error(`fork(mujoco.simulate): unknown parameters ${JSON.stringify(unknown)} \u2014 known: ${JSON.stringify(known)}`);
      Object.assign(params, changes);
      forkInput.params = params;
      return;
    }
    default:
      throw new Error(`fork: parameter changes not supported for skill ${skillName}`);
  }
}
function inputFromSpec(skillName, run) {
  const model = run.spec.model;
  if (skillName === "challenge.attempt") {
    if (!model?.challenge) return null;
    return {
      challenge: model.challenge,
      changes: { ...model.changes ?? {} },
      level: { ...model.level ?? {} }
    };
  }
  if (skillName === "mujoco.simulate") {
    if (!model?.scene) return null;
    const params = model.params ?? {};
    return {
      scene: model.scene,
      steps: model.steps ?? 100,
      sampleEvery: model.sampleEvery ?? 10,
      // forces are part of the event contract — replay/fork keep them
      params: { ...params, ...Array.isArray(params.forces) ? { forces: params.forces } : {} }
    };
  }
  if (skillName === "formula.plot") {
    if (!model?.expression) return null;
    return {
      expression: model.expression,
      parameters: model.parameters ?? [],
      independent: model.independent ?? "x",
      range: model.range ?? [-5, 5],
      values: Object.fromEntries(Object.entries(run.spec.params).filter(([, v]) => typeof v === "number")),
      samples: model.samples
    };
  }
  if (skillName === "kakeya.measure" || skillName === "kakeya.generate") {
    return {
      deltaExp: model?.deltaExp ?? run.spec.params.deltaExp,
      nTubes: model?.nTubes ?? run.spec.params.nTubes,
      packing: model?.packing ?? run.spec.params.packing,
      res: model?.res ?? run.spec.res
    };
  }
  if (skillName === "kakeya.sweep" && model) {
    return {
      param: model.param,
      values: model.values,
      deltaExp: model.deltaExp,
      packing: model.packing,
      res: model.res
    };
  }
  if (skillName === "formula.evaluate" && model) {
    return { expression: model.expression, bindings: model.bindings };
  }
  if (skillName === "geometry.2d" && model) {
    return { construction: model.construction, params: model };
  }
  if (skillName === "ode.solve" && model) {
    return {
      system: { kind: model.kind, params: model.params },
      initialValues: model.initialValues,
      tSpan: model.tSpan
    };
  }
  return null;
}
var FORMAL_SKILLS = /* @__PURE__ */ new Set(["formula.plot", "formula.evaluate", "kakeya.generate", "kakeya.measure", "kakeya.sweep", "geometry.2d", "ode.solve", "mujoco.simulate", "challenge.attempt"]);
async function executeSkill(name, input, opts = {}) {
  const skill = getSkill(name);
  if (!skill) return { status: "error", code: "unknown_skill", message: `Unknown skill: ${name}` };
  if (!skill.implemented) {
    return {
      status: "unsupported",
      skill: skill.name,
      message: skill.unavailableReason ?? `${skill.name} is registered but not wired to the unified executor yet`
    };
  }
  if (skill.name !== name) name = skill.name;
  const inputError = schemaError(skill.inputSchema, input, name);
  if (inputError) return { status: "error", code: "invalid_input", message: inputError };
  if (FORMAL_SKILLS.has(name) && !opts.replay) {
    const allowUnregistered = (() => {
      try {
        return globalThis.process?.env?.PAPER2LAB_ALLOW_UNREGISTERED_PLANS === "1";
      } catch {
        return false;
      }
    })();
    if (!opts.planId) {
      return { status: "needs_input", missing: ["planId"], message: `${name} refuses to run without a PlayPlan` };
    }
    if (!allowUnregistered) {
      const registered = getPlan(opts.planId);
      if (!registered) {
        return {
          status: "needs_input",
          missing: ["plan"],
          message: `planId '${opts.planId.slice(0, 40)}' is not a registered PlayPlan \u2014 submit the full plan (plan op / inline plan field) before executing ${name}`
        };
      }
      if (!planCoversSkill(registered, name)) {
        return {
          status: "needs_input",
          missing: ["plan.skill"],
          message: `PlayPlan '${registered.planId}' (skill ${registered.skill}) does not cover '${name}' \u2014 a plan governs its own experiment`
        };
      }
    }
  }
  try {
    if (name === "formula.evaluate") return { status: "ok", run: await runFormulaEvaluate(input) };
    if (name === "formula.plot") return { status: "ok", run: await runFormulaPlot(input, opts) };
    if (name === "kakeya.generate") return { status: "ok", run: await runKakeyaGenerate(input, opts) };
    if (name === "kakeya.measure") return { status: "ok", run: await runKakeyaMeasure(input, opts) };
    if (name === "kakeya.sweep") return { status: "ok", run: await runKakeyaSweep(input, opts) };
    if (name === "geometry.2d") return { status: "ok", run: await runGeometry2D(input, opts) };
    if (name === "ode.solve") return { status: "ok", run: await runOdeSolve(input, opts) };
    if (name === "ode.phase") return { status: "ok", run: await runOdePhase(input, opts) };
    if (name === "experiment.fork") {
      const { sourceRunId, parameterChanges = {} } = input;
      const source = getExperimentRun(sourceRunId);
      if (!source) return { status: "error", code: "invalid_input", message: `Unknown run: ${sourceRunId}` };
      const skillName = COMPUTE_BY_KIND[source.spec.kind];
      if (!skillName) return { status: "unsupported", skill: source.spec.kind, message: "Source run kind has no compute skill" };
      const forkInput = inputFromSpec(skillName, source);
      if (!forkInput) return { status: "error", code: "invalid_input", message: "Source run spec cannot be replayed" };
      applyForkChanges(skillName, forkInput, parameterChanges);
      const outcome = await executeSkill(skillName, forkInput, {
        planId: `fork:${sourceRunId}`,
        replay: true,
        parentRunId: sourceRunId,
        // Lane A source inheritance: a fork keeps its parent's provenance
        // anchor (paper/doc reference) — losing it orphaned desk charts
        source: source.spec.source
      });
      if (outcome.status === "ok" && outcome.run) {
        return { status: "ok", run: outcome.run, payload: { forkRunId: outcome.run.runId } };
      }
      return outcome;
    }
    if (name === "experiment.compare") {
      const { runA, runB } = input;
      try {
        const comparison = compareRuns(runA, runB);
        return { status: "ok", run: null, payload: comparison };
      } catch (err) {
        return { status: "error", code: "invalid_input", message: err instanceof Error ? err.message : String(err) };
      }
    }
    if (name === "mujoco.simulate" || name === "challenge.attempt") {
      const runner = extraRunners.get(name);
      if (!runner) {
        return {
          status: "unsupported",
          skill: name,
          message: `${name} runs in the backend engine (Node WASM) \u2014 use server execution mode / the engine API; the page imports the resulting Runs`
        };
      }
      return { status: "ok", run: await runner(input, opts) };
    }
    if (name === "paper.trace-source") {
      const { anchorId } = input;
      const withSource = listExperimentRuns({ limit: 500 }).filter(
        (r) => r.spec.source?.anchorId === anchorId
      );
      if (withSource.length === 0) {
        return { status: "needs_input", missing: ["anchor"], message: `No recorded run carries source anchor ${anchorId}` };
      }
      return { status: "ok", run: null, payload: withSource[0].spec.source };
    }
    return { status: "unsupported", skill: name, message: "No implementation branch" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedRun = err.run;
    return { status: "error", code: "execution_failed", message, run: failedRun };
  }
}

// src/skills/agentSteps.ts
var TERMINAL_BY_DESK = {
  formula: { skill: "formula.plot", op: "formula.plot" },
  kakeya: { skill: "kakeya.measure", op: "kakeya.measure" },
  ode: { skill: "ode.solve", op: "ode.solve" },
  geometry: { skill: "geometry.2d", op: "geometry.plot" },
  mujoco: { skill: "mujoco.simulate", op: "mujoco.simulate" },
  challenge: { skill: "challenge.attempt", op: "challenge.attempt" }
};
function readParam(desk, base, param) {
  if (desk === "formula") {
    const values = base.values ?? {};
    return values[param];
  }
  if (desk === "ode") {
    const sys = base.system;
    const init = base.initialValues;
    return sys?.params?.[param] ?? init?.[param];
  }
  if (desk === "geometry") {
    const params = base.params ?? {};
    return params[param];
  }
  if (desk === "mujoco" || desk === "challenge") {
    const params = base.params ?? {};
    return params[param] ?? base.changes?.[param];
  }
  return base[param];
}
function metricsOf(desk, result) {
  const r = result ?? {};
  const num2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
  if (desk === "formula") {
    const peak = num2(r.peak);
    const integral = num2(r.integral);
    return { ...peak !== void 0 ? { peak } : {}, ...integral !== void 0 ? { integral } : {} };
  }
  if (desk === "kakeya") {
    const occupiedVolume = num2(r.occupiedVolume);
    const maxMultiplicity = num2(r.maxMultiplicity);
    return { ...occupiedVolume !== void 0 ? { occupiedVolume } : {}, ...maxMultiplicity !== void 0 ? { maxMultiplicity } : {} };
  }
  if (desk === "ode") {
    const out = {};
    if (num2(r.conservedDrift) !== void 0) out.conservedDrift = num2(r.conservedDrift);
    const y = r.y;
    const prey = y?.prey;
    const predator = y?.predator;
    if (Array.isArray(prey) && prey.length > 0) {
      out.finalPrey = prey[prey.length - 1];
      out.minPrey = Math.min(...prey);
    }
    if (Array.isArray(predator) && predator.length > 0) {
      out.finalPredator = predator[predator.length - 1];
      out.maxPredator = Math.max(...predator);
    }
    return out;
  }
  if (desk === "geometry") {
    const computedArea = num2(r.computedArea);
    const boundArea = num2(r.boundArea);
    return { ...computedArea !== void 0 ? { computedArea } : {}, ...boundArea !== void 0 ? { boundArea } : {} };
  }
  if (desk === "challenge") {
    const out = {};
    for (const key of ["score", "error", "landingX", "measuredPeriod", "occupiedVolume"]) {
      const v = r[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
    return out;
  }
  if (desk === "mujoco") {
    const m = r.metrics ?? {};
    const finalTime = num2(m.finalTime);
    const qposNormFinal = num2(m.qposNormFinal);
    const comZFinal = num2(m.comZFinal);
    return {
      ...finalTime !== void 0 ? { finalTime } : {},
      ...qposNormFinal !== void 0 ? { qposNormFinal } : {},
      ...comZFinal !== void 0 ? { comZFinal } : {}
    };
  }
  return {};
}
async function runAgentSteps(desk, steps, base, planId) {
  const terminal = TERMINAL_BY_DESK[desk];
  const out = { status: "ok", runs: [], comparison: null, summary: "" };
  try {
    const baseOut = await executeSkill(terminal.skill, base, { planId });
    if (baseOut.status !== "ok" || !baseOut.run) {
      return { ...out, status: "error", message: baseOut.status === "error" ? baseOut.message : `base skill returned ${baseOut.status}` };
    }
    let current = baseOut.run;
    const changes = {};
    let changed = false;
    let forked = false;
    const materialise = async (skillName, input) => {
      if (!changed) return current;
      const forkOut = await executeSkill(
        "experiment.fork",
        { sourceRunId: current.runId, parameterChanges: changes },
        { planId }
      );
      if (forkOut.status !== "ok" || !forkOut.run) {
        throw new Error(forkOut.status === "error" ? forkOut.message : `fork returned ${forkOut.status}`);
      }
      current = forkOut.run;
      forked = true;
      changed = false;
      void skillName;
      void input;
      return current;
    };
    for (const step of steps) {
      const op = step.op;
      if (op === "experiment.fork") {
        await materialise(terminal.skill, base);
        if (!forked) {
          const forkOut = await executeSkill("experiment.fork", { sourceRunId: current.runId, parameterChanges: {} }, { planId });
          if (forkOut.status === "ok" && forkOut.run) current = forkOut.run;
        }
        forked = true;
      } else if (op.endsWith(".set") || op === "kakeya.set") {
        if (!step.param || typeof step.value !== "number") throw new Error(`${op} requires param and value`);
        changes[step.param] = step.value;
        changed = true;
      } else if (op.endsWith(".scale") || op === "formula.scale") {
        if (!step.param || typeof step.value !== "number") throw new Error(`${op} requires param and value`);
        const from = changes[step.param] ?? readParam(desk, base, step.param);
        if (from === void 0) throw new Error(`unknown parameter for ${op}: ${step.param}`);
        changes[step.param] = from * step.value;
        changed = true;
      } else if (op === "kakeya.halve-n") {
        const n = changes.nTubes ?? readParam(desk, base, "nTubes");
        if (n === void 0) throw new Error("base input has no nTubes to halve");
        changes.nTubes = Math.max(8, Math.floor(n / 2));
        changed = true;
      } else if (desk === "challenge" && op === "challenge.attempt") {
        const r = await executeSkill("challenge.attempt", {
          challenge: base.challenge,
          changes: { ...base.changes ?? {}, ...changes },
          ...base.level ? { level: base.level } : {}
        }, { planId });
        if (r.status !== "ok" || !r.run) throw new Error(r.status === "error" ? r.message : `challenge.attempt returned ${r.status}`);
        out.runs.push({ runId: r.run.runId, parentRunId: r.run.parentRunId, metrics: metricsOf(desk, r.run.result) });
        current = r.run;
      } else if (op === terminal.op || op === "kakeya.sweep") {
        const skillName = op === "kakeya.sweep" ? "kakeya.sweep" : terminal.skill;
        const run = await materialise(skillName, base);
        const r = op === "kakeya.sweep" ? await executeSkill("kakeya.sweep", { ...base, ...changes, param: "nTubes", values: [16, 32, 64, 96, 128], res: Math.min(Number(base.res ?? 24), 24) }, { planId }) : { status: "ok", run };
        if (r.status !== "ok" || !("run" in r) || !r.run) throw new Error(`terminal op ${op} failed`);
        out.runs.push({
          runId: r.run.runId,
          parentRunId: r.run.parentRunId,
          metrics: metricsOf(desk, r.run.result)
        });
      } else if (op === "experiment.compare") {
        await materialise(terminal.skill, base);
        const cmp = await executeSkill("experiment.compare", { runA: baseOut.run.runId, runB: current.runId }, { planId });
        if (cmp.status !== "ok") throw new Error(cmp.status === "error" ? cmp.message : `compare returned ${cmp.status}`);
        out.comparison = cmp.payload;
      } else {
        throw new Error(`unknown step op: ${op}`);
      }
    }
    if (changed) {
      const run = await materialise(terminal.skill, base);
      out.runs.push({ runId: run.runId, parentRunId: run.parentRunId, metrics: metricsOf(desk, run.result) });
    }
    out.targetRunId = current.runId;
    out.summary = `\u5B9E\u9A8C\u5B8C\u6210\uFF1Abase ${baseOut.run.runId} \u2192 target ${current.runId}\uFF08\u5168\u90E8\u4E3A\u6CE8\u518C skill \u771F\u5B9E\u6267\u884C\u7684 ExperimentRun\uFF09`;
    return out;
  } catch (err) {
    return { ...out, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

// src/physics/registerMujocoRunner.ts
init_mujocoKernel();
registerSkillRunner("mujoco.simulate", async (input, opts) => {
  const i = input;
  const sampleEvery = typeof i.sampleEvery === "number" ? i.sampleEvery : 10;
  const params = i.params ?? {};
  return executeSpec(
    {
      kind: "mujoco.sim",
      params: {
        ...params.gravityZ !== void 0 ? { gravityZ: params.gravityZ } : {},
        ...params.windX !== void 0 ? { windX: params.windX } : {},
        ...params.timestep !== void 0 ? { timestep: params.timestep } : {},
        ...params.forces !== void 0 ? { forces: params.forces.length } : {}
      },
      seed: 0,
      model: { scene: i.scene, steps: i.steps, sampleEvery, params, scenesChecksum: scenesChecksum() }
    },
    MUJOCO_ENGINE,
    () => mujocoSimulate(i.scene, { steps: i.steps, sampleEvery, params }),
    { parentRunId: opts.parentRunId }
  );
});

// src/challenges/kernel.ts
init_voxels3d();
init_directions();
init_tubes();

// src/challenges/levels.ts
var DEFAULT_LEVELS = {
  projectile: { kind: "projectile", angleDeg: 30, speed: 10, gravity: 9.81, targetX: 22.9, tolerance: 0.5 },
  pendulum: { kind: "pendulum", length: 0.6, angleDeg: 25, gravity: 9.81, targetPeriod: 2, tolerance: 0.05 },
  tubes: { kind: "tubes", offsets: [0, 0, 0, 0], nTubes: 32, deltaExp: 4, res: 24, budget: 0.28 }
};

// src/challenges/kernel.ts
function projectileMjcf(spec) {
  const rad = spec.angleDeg * Math.PI / 180;
  const vx = Math.cos(rad) * spec.speed;
  const vz = Math.sin(rad) * spec.speed;
  return `<mujoco model="p2l-projectile">
  <option gravity="0 0 ${-spec.gravity}" timestep="0.002" integrator="RK4"/>
  <worldbody>
    <geom name="ground" type="plane" size="40 40 0.1" rgba="0.85 0.82 0.76 1"/>
    <body name="ball" pos="0 0 0.1">
      <freejoint name="ball"/>
      <geom name="ball-geom" type="sphere" size="0.1" mass="0.2" rgba="0.58 0.23 0.18 1"/>
    </body>
    <body name="target-marker" pos="${spec.targetX.toFixed(6)} 0 0.02">
      <geom name="target-geom" type="cylinder" size="${spec.tolerance.toFixed(6)} ${spec.tolerance.toFixed(6)} 0.01" mass="0" contype="0" conaffinity="0" rgba="0.18 0.36 0.54 0.35"/>
    </body>
  </worldbody>
  <keyframe>
    <key name="launch" qpos="0 0 0.1 1 0 0 0" qvel="${vx.toFixed(9)} 0 ${vz.toFixed(9)} 0 0 0"/>
  </keyframe>
</mujoco>`;
}
function pendulumMjcf(spec) {
  const rad = spec.angleDeg * Math.PI / 180;
  const l = spec.length;
  return `<mujoco model="p2l-pendulum">
  <option gravity="0 0 ${-spec.gravity}" timestep="0.001" integrator="RK4"/>
  <worldbody>
    <geom name="post" type="capsule" fromto="0 0 2.2 0 0 2" size="0.02" mass="0" rgba="0.42 0.36 0.28 1"/>
    <body name="arm" pos="0 0 2">
      <joint name="hinge" type="hinge" axis="0 1 0" pos="0 0 0" damping="0"/>
      <geom name="rod" type="capsule" fromto="0 0 0 0 0 ${(-l).toFixed(9)}" size="0.012" mass="0.02" rgba="0.55 0.5 0.42 1"/>
      <geom name="bob" type="sphere" size="0.05" mass="1" pos="0 0 ${(-l).toFixed(9)}" rgba="0.58 0.23 0.18 1"/>
    </body>
  </worldbody>
  <keyframe>
    <key name="release" qpos="${rad.toFixed(9)}"/>
  </keyframe>
</mujoco>`;
}
var SCORE_MAX = 1e3;
async function simulateGenerated(name, xml, steps, sampleEvery, keyframe) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("generated MJCF failed the entity guard");
  const { getMujoco: getMujoco2, mujocoSimulate: mujocoSimulate2 } = await Promise.resolve().then(() => (init_mujocoKernel(), mujocoKernel_exports));
  const mujoco = await getMujoco2();
  mujoco.FS.writeFile(`/working/${name}`, new TextEncoder().encode(xml));
  return mujocoSimulate2(name, { steps, sampleEvery, params: keyframe === void 0 ? void 0 : { keyframe } });
}
function clamp2(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function validateSpec(spec) {
  if (spec.kind === "projectile") {
    if (!Number.isFinite(spec.angleDeg) || spec.angleDeg < 0 || spec.angleDeg > 85) return "angleDeg must be in [0, 85]";
    if (!Number.isFinite(spec.speed) || spec.speed < 1 || spec.speed > 30) return "speed must be in [1, 30] m/s";
    if (!Number.isFinite(spec.gravity) || spec.gravity <= 0 || spec.gravity > 30) return "gravity must be in (0, 30]";
    if (!Number.isFinite(spec.targetX) || spec.targetX <= 0 || spec.targetX > 40) return "targetX must be in (0, 40]";
    if (!Number.isFinite(spec.tolerance) || spec.tolerance <= 0) return "tolerance must be positive";
  } else if (spec.kind === "pendulum") {
    if (!Number.isFinite(spec.length) || spec.length < 0.2 || spec.length > 2) return "length must be in [0.2, 2] m";
    if (!Number.isFinite(spec.angleDeg) || spec.angleDeg < 5 || spec.angleDeg > 90) return "angleDeg must be in [5, 90]";
    if (!Number.isFinite(spec.gravity) || spec.gravity <= 0 || spec.gravity > 30) return "gravity must be in (0, 30]";
    if (!Number.isFinite(spec.targetPeriod) || spec.targetPeriod <= 0) return "targetPeriod must be positive";
    if (!Number.isFinite(spec.tolerance) || spec.tolerance <= 0) return "tolerance must be positive";
  } else {
    if (!Array.isArray(spec.offsets) || spec.offsets.length === 0 || spec.offsets.length > 16) return "offsets must be a non-empty array (\u226416 clusters)";
    for (const o of spec.offsets) if (!Number.isFinite(o) || o < 0 || o > 1) return "each offset must be in [0, 1]";
    if (!Number.isInteger(spec.nTubes) || spec.nTubes < 8 || spec.nTubes > 128) return "nTubes must be an integer in [8, 128]";
    if (!Number.isInteger(spec.deltaExp) || spec.deltaExp < 3 || spec.deltaExp > 6) return "deltaExp must be in [3, 6]";
    if (!Number.isInteger(spec.res) || spec.res < 8 || spec.res > 96) return "res must be an integer in [8, 96]";
    if (!Number.isFinite(spec.budget) || spec.budget <= 0 || spec.budget > 1) return "budget must be in (0, 1]";
  }
  return null;
}
async function runProjectile(spec) {
  const sim = await simulateGenerated("p2l-projectile.xml", projectileMjcf(spec), 4e3, 10, 0);
  const t = [];
  const x = [];
  const z = [];
  let landingX = null;
  for (let i = 0; i < sim.t.length; i++) {
    const q = sim.qpos[i];
    if (q.length < 7) break;
    const px = q[0];
    const pz = q[2];
    t.push(sim.t[i]);
    x.push(px);
    z.push(pz);
    if (landingX === null && i > 0 && pz <= 0.1 + 0.02 && z[i - 1] > 0.1 + 0.02) {
      landingX = px;
    }
  }
  if (landingX === null) landingX = x[x.length - 1] ?? 0;
  const error = Math.abs(landingX - spec.targetX);
  const hit = error <= spec.tolerance;
  const result = {
    kind: "projectile",
    t,
    x,
    z,
    landingX,
    targetX: spec.targetX,
    error,
    hit,
    tolerance: spec.tolerance,
    score: Math.round(SCORE_MAX * clamp2(1 - error / (spec.targetX * 0.5), 0, 1)) + (hit ? 500 : 0)
  };
  assertFiniteNumbers({ landingX: result.landingX, error: result.error, score: result.score });
  return result;
}
async function runPendulum(spec) {
  const sim = await simulateGenerated("p2l-pendulum.xml", pendulumMjcf(spec), 6e3, 5, 0);
  const t = sim.t;
  const theta = sim.qpos.map((q) => q[0]);
  const crossings = [];
  for (let i = 1; i < theta.length; i++) {
    if (theta[i - 1] < 0 && theta[i] >= 0) {
      const f = -theta[i - 1] / (theta[i] - theta[i - 1] || 1e-12);
      crossings.push(t[i - 1] + f * (t[i] - t[i - 1]));
    }
  }
  let measuredPeriod = null;
  if (crossings.length >= 2) {
    const gaps = crossings.slice(1).map((c, i) => c - crossings[i]);
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    measuredPeriod = median;
  }
  const error = measuredPeriod === null ? null : Math.abs(measuredPeriod - spec.targetPeriod);
  const matched = error !== null && error <= spec.tolerance;
  const result = {
    kind: "pendulum",
    t,
    theta,
    measuredPeriod,
    targetPeriod: spec.targetPeriod,
    error,
    matched,
    tolerance: spec.tolerance,
    score: error === null ? 0 : Math.round(SCORE_MAX * clamp2(1 - error / (spec.targetPeriod * 0.5), 0, 1)) + (matched ? 500 : 0)
  };
  if (result.measuredPeriod !== null) assertFiniteNumbers({ p: result.measuredPeriod, score: result.score });
  return result;
}
function countCubeViolations(tubes) {
  let violations = 0;
  const eps = 1e-9;
  for (const t of tubes) {
    const { a, b } = segmentOf(t);
    for (const q of [a, b]) {
      if (q.x < -eps || q.x > 1 + eps || q.y < -eps || q.y > 1 + eps || q.z < -eps || q.z > 1 + eps) violations++;
    }
  }
  return violations;
}
function runTubesSync(spec) {
  const delta = 2 ** -spec.deltaExp;
  const dirs = fibonacciDirections(spec.nTubes);
  const base = makeTubes(dirs, delta, 0, 20250224);
  const per = Math.ceil(base.length / spec.offsets.length);
  const nClusters = Math.min(spec.offsets.length, Math.ceil(base.length / per));
  const packing = spec.offsets.slice(0, nClusters).map((o) => clamp2(o, 0, 1));
  const moved = base.map((tube, i) => {
    const cluster = Math.min(nClusters - 1, Math.floor(i / per));
    const p = packing[cluster];
    return {
      ...tube,
      center: {
        x: tube.center.x + p * (0.5 - tube.center.x),
        y: tube.center.y + p * (0.5 - tube.center.y),
        z: tube.center.z + p * (0.5 - tube.center.z)
      }
    };
  });
  const violations = countCubeViolations(moved);
  const measured = computeVoxelCoverage(moved, spec.res, 0);
  const withinBudget = violations === 0 && measured.occupiedVolume <= spec.budget;
  const result = {
    kind: "tubes",
    occupiedVolume: measured.occupiedVolume,
    budget: spec.budget,
    withinBudget,
    score: violations > 0 ? 0 : Math.round(SCORE_MAX * clamp2(1 - measured.occupiedVolume / spec.budget, 0, 1)) + (withinBudget ? 500 : 0),
    packing,
    violations
  };
  assertFiniteNumbers({ v: result.occupiedVolume, score: result.score });
  return result;
}
async function runChallenge(spec) {
  const invalid = validateSpec(spec);
  if (invalid) throw new Error(invalid);
  if (spec.kind === "projectile") return runProjectile(spec);
  if (spec.kind === "pendulum") return runPendulum(spec);
  return runTubesSync(spec);
}

// src/challenges/registerChallengeRunner.ts
registerSkillRunner("challenge.attempt", async (input, opts) => {
  const i = input;
  const base = i.level && i.level.kind ? i.level : DEFAULT_LEVELS[i.challenge];
  const spec = { ...base };
  const c = i.changes ?? {};
  if (spec.kind === "projectile") {
    if (typeof c.angleDeg === "number") spec.angleDeg = c.angleDeg;
    if (typeof c.speed === "number") spec.speed = c.speed;
  } else if (spec.kind === "pendulum") {
    if (typeof c.length === "number") spec.length = c.length;
    if (typeof c.angleDeg === "number") spec.angleDeg = c.angleDeg;
  } else if (spec.kind === "tubes" && Array.isArray(c.offsets)) {
    spec.offsets = c.offsets.map((v) => Math.min(1, Math.max(0, v)));
  }
  const invalid = validateSpec(spec);
  if (invalid) throw new Error(invalid);
  return executeSpec(
    {
      kind: "challenge.attempt",
      params: {},
      seed: 0,
      model: { challenge: spec.kind, level: base, changes: c, spec }
    },
    { engine: "challenge-kernel", version: "0.1" },
    () => runChallenge(spec),
    { parentRunId: opts.parentRunId }
  );
});

// scripts/engine_persist.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
var RUNLOG = "engine-runs.jsonl";
function runlogPath() {
  const dir = process.env.PAPER2LAB_DATA_DIR || join2(process.cwd(), "server", "data");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
  }
  return join2(dir, RUNLOG);
}
function persistRun(run) {
  try {
    if (run.status !== "resolved") return;
    appendFileSync(runlogPath(), JSON.stringify(run) + "\n");
  } catch {
  }
}
function restoreRuns() {
  try {
    const path = runlogPath();
    if (!existsSync(path)) return 0;
    const lines = readFileSync2(path, "utf8").split("\n").filter((l) => l.trim());
    const known = new Set(listExperimentRuns({ limit: 1e5 }).map((r) => r.runId));
    const seen = /* @__PURE__ */ new Set();
    const fresh = [];
    let corrupt = 0;
    for (const line of lines) {
      let run = null;
      try {
        run = JSON.parse(line);
      } catch {
        corrupt++;
        continue;
      }
      if (run && typeof run.runId === "string" && !known.has(run.runId) && !seen.has(run.runId)) {
        seen.add(run.runId);
        fresh.push(run);
      }
    }
    if (corrupt > 0) {
      console.warn(`[engine-persist] skipped ${corrupt} corrupt line(s) in ${RUNLOG} (crashed append tail?) \u2014 intact runs restored`);
    }
    if (fresh.length === 0) return 0;
    importRuns(JSON.stringify(fresh));
    return fresh.length;
  } catch {
    return 0;
  }
}

// scripts/engine_server.ts
var restoredRuns = restoreRuns();
var t0 = Date.now();
var queue = Promise.resolve();
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  const run = obj?.outcome?.run;
  if (run?.runId && run?.status === "resolved") persistRun(run);
}
async function handle(req) {
  const op = String(req.op ?? "");
  if (op === "ping") return { ok: true, node: process.version, uptimeMs: Date.now() - t0 };
  if (op === "skills") {
    return {
      ok: true,
      skills: SKILL_REGISTRY.map((s) => ({
        name: s.name,
        aliases: s.aliases ?? [],
        description: s.description,
        version: s.version,
        deterministic: s.deterministic,
        evidence: s.evidence,
        runKind: s.runKind
      }))
    };
  }
  if (op === "plan") {
    try {
      const plan = registerPlanFromJson(req.plan);
      return { ok: true, planId: plan.planId, known: getPlan(plan.planId) === plan };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (op === "execute") {
    if (req.plan !== void 0) {
      try {
        registerPlanFromJson(req.plan);
      } catch (err) {
        return { ok: false, error: `invalid plan: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    const outcome = await executeSkill(String(req.skill), req.input ?? {}, {
      planId: typeof req.planId === "string" ? req.planId : void 0,
      parentRunId: typeof req.parentRunId === "string" ? req.parentRunId : void 0
    });
    return { ok: true, outcome };
  }
  if (op === "agent_steps") {
    if (req.plan !== void 0) {
      try {
        registerPlanFromJson(req.plan);
      } catch (err) {
        return { ok: false, error: `invalid plan: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    const result = await runAgentSteps(
      String(req.deskKind),
      Array.isArray(req.steps) ? req.steps : [],
      req.base ?? {},
      typeof req.planId === "string" ? req.planId : `plan-engine-${Date.now()}`
    );
    for (const row of result.runs) {
      const full = getExperimentRun(row.runId);
      if (full?.status === "resolved") persistRun(full);
    }
    const target = result.targetRunId ? getExperimentRun(result.targetRunId) : void 0;
    if (target?.status === "resolved") persistRun(target);
    return { ok: true, result };
  }
  if (op === "run_input") {
    const out = inputForRun(String(req.runId));
    return "error" in out ? { ok: false, error: out.error } : { ok: true, skill: out.skill, input: out.input };
  }
  if (op === "runs") {
    restoreRuns();
    const runs = listExperimentRuns({
      kind: typeof req.kind === "string" ? req.kind : void 0,
      limit: typeof req.limit === "number" ? req.limit : 50
    });
    return { ok: true, runs };
  }
  if (op === "export") {
    const ids = Array.isArray(req.runIds) ? req.runIds.map(String) : [];
    return { ok: true, bundle: exportExperimentRuns(ids) };
  }
  if (op === "import") {
    const text = typeof req.bundle === "string" ? req.bundle : "";
    const { imported } = importRuns(text);
    return { ok: true, imported };
  }
  if (op === "shutdown") return { ok: true, exit: true };
  return { ok: false, error: `unknown op: ${op || "(none)"}` };
}
var rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try {
    req = JSON.parse(text);
  } catch {
    send({ id: null, ok: false, error: "malformed JSON line" });
    return;
  }
  queue = queue.then(async () => {
    try {
      const res = await handle(req);
      send({ id: req.id ?? null, ...res });
      if (res.exit) process.exit(0);
    } catch (err) {
      send({ id: req.id ?? null, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }).catch(() => {
  });
});
process.on("SIGTERM", () => process.exit(0));
send({ ok: true, event: "engine-ready", node: process.version, restoredRuns });
