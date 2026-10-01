// Reactive Research Runtime — a tiny marimo-inspired dependency DAG.
//
// Design guarantees (ported from marimo's reactivity model):
//  - single ownership: every cell name is defined exactly once
//  - the graph is a DAG by construction: a cell can only depend on cells
//    registered earlier (unknown deps are rejected), so cycles cannot form
//  - changing a param re-runs exactly the transitive descendants, in
//    deterministic topological order (no out-of-order execution)
//  - async cells (e.g. Worker compute) keep their last committed value and
//    flip to `stale` while recomputing (stale-while-recompute); commits carry
//    a generation counter so superseded results are discarded
//  - UI writes params only; derived state is never hand-updated in callbacks

export type CellId = string

/** research-node lifecycle (AGENTS.md §2): idle → stale → computing → resolved | error */
export type CellStatus = 'idle' | 'stale' | 'computing' | 'resolved' | 'error'

export interface CellSnapshot<T = unknown> {
  value: T | undefined
  hasValue: boolean
  stale: boolean
  status: CellStatus
  version: number
  error: unknown
}

export interface CellRef<T = unknown> {
  readonly id: CellId
  /** current committed value (throws if never computed) */
  get(): T
}

type SyncFn<T> = (inputs: unknown[]) => T
type AsyncFn<T> = (inputs: unknown[]) => Promise<T>

interface CellDef {
  id: CellId
  kind: 'param' | 'derive' | 'async'
  deps: CellId[]
  fn?: SyncFn<unknown> | AsyncFn<unknown>
  value: unknown
  hasValue: boolean
  stale: boolean
  version: number
  error: unknown
  generation: number
  debounceMs: number
  debounceTimer?: ReturnType<typeof setTimeout>
  launched: boolean
  subscribers: Set<() => void>
  snapshot: CellSnapshot
  order: number
}

const EMPTY: CellSnapshot = { value: undefined, hasValue: false, stale: false, status: 'idle', version: 0, error: undefined }

function statusOf(def: CellDef): CellStatus {
  if (def.error) return 'error'
  if (def.kind === 'param') return 'resolved'
  if (def.stale) {
    // async cells: stale while debouncing, computing once launched
    if (def.kind === 'async' && def.launched) return 'computing'
    return 'stale'
  }
  if (!def.hasValue) return 'idle'
  return 'resolved'
}

export class Runtime {
  private cells = new Map<CellId, CellDef>()
  private dependents = new Map<CellId, Set<CellId>>()
  private nextOrder = 0

  /** Register a source-of-truth parameter cell. */
  param<T>(id: CellId, initial: T): CellRef<T> {
    this.register(id, 'param', [], undefined, 0)
    const def = this.cells.get(id)!
    def.value = initial
    def.hasValue = true
    this.publish(def)
    return this.ref<T>(id)
  }

  /** Register a synchronous pure derivation. */
  derive<T>(id: CellId, deps: CellRef[], fn: (inputs: unknown[]) => T): CellRef<T> {
    this.register(id, 'derive', deps.map((d) => d.id), fn as SyncFn<unknown>, 0)
    const def = this.cells.get(id)!
    def.stale = true
    // deps may be async cells without a committed value yet — in that case
    // this cell simply stays stale and runs when the dep commits
    if (def.deps.every((d) => this.cells.get(d)!.hasValue)) this.run(def)
    else this.publish(def)
    return this.ref<T>(id)
  }

  /** Register an asynchronous derivation (Worker compute). Debounced trailing. */
  asyncDerive<T>(
    id: CellId,
    deps: CellRef[],
    fn: (inputs: unknown[]) => Promise<T>,
    opts: { debounceMs?: number } = {},
  ): CellRef<T> {
    this.register(id, 'async', deps.map((d) => d.id), fn as AsyncFn<unknown>, opts.debounceMs ?? 120)
    // kick the initial computation
    const def = this.cells.get(id)!
    def.stale = true
    this.publish(def)
    this.run(def)
    return this.ref<T>(id)
  }

  /** Change a parameter value; recomputes descendants in topological order. */
  setParam<T>(id: CellId, value: T): void {
    const def = this.cells.get(id)
    if (!def || def.kind !== 'param') throw new Error(`setParam: '${id}' is not a param`)
    if (Object.is(def.value, value)) return
    def.value = value
    def.version++
    def.stale = false
    this.publish(def)
    this.invalidate(id)
  }

  get<T>(id: CellId | CellRef<T>): CellSnapshot<T> {
    const key = typeof id === 'string' ? id : id.id
    const def = this.cells.get(key)
    if (!def) throw new Error(`unknown cell '${key}'`)
    return def.snapshot as CellSnapshot<T>
  }

  subscribe(id: CellId, cb: () => void): () => void {
    const def = this.cells.get(id)
    if (!def) throw new Error(`unknown cell '${id}'`)
    def.subscribers.add(cb)
    return () => def.subscribers.delete(cb)
  }

  /** Cell inventory for dependency-graph visualisation / debugging. */
  describe(): Array<{ id: CellId; kind: CellDef['kind']; deps: CellId[]; stale: boolean; version: number }> {
    return [...this.cells.values()].map((d) => ({ id: d.id, kind: d.kind, deps: d.deps, stale: d.stale, version: d.version }))
  }

  // ---- internals ----------------------------------------------------------

  /** typed handle for a registered cell — used to wire deps and read values */
  ref<T>(id: CellId): CellRef<T> {
    const rt = this
    return {
      id,
      get(): T {
        const def = rt.cells.get(id)!
        if (!def.hasValue) throw new Error(`cell '${id}' has no committed value yet`)
        return def.value as T
      },
    }
  }

  private register(id: CellId, kind: CellDef['kind'], deps: CellId[], fn: CellDef['fn'], debounceMs: number) {
    if (this.cells.has(id)) throw new Error(`cell '${id}' already defined (single-owner rule)`)
    for (const dep of deps) if (!this.cells.has(dep)) throw new Error(`cell '${id}' depends on unknown cell '${dep}'`)
    this.cells.set(id, {
      id, kind, deps, fn, debounceMs,
      value: undefined, hasValue: false, stale: false, version: 0, error: undefined,
      generation: 0, launched: false, subscribers: new Set(), snapshot: EMPTY, order: this.nextOrder++,
    })
    for (const dep of deps) {
      let set = this.dependents.get(dep)
      if (!set) this.dependents.set(dep, (set = new Set()))
      set.add(id)
    }
  }

  /** Mark all transitive dependents stale, then recompute sync cells / schedule async ones. */
  private invalidate(root: CellId) {
    const affected: CellDef[] = []
    const collect = (id: CellId) => {
      for (const depId of this.dependents.get(id) ?? []) {
        const def = this.cells.get(depId)!
        affected.push(def)
        collect(depId)
      }
    }
    collect(root)
    if (affected.length === 0) return
    // topological order: dependency-first; deterministic tiebreak = registration order
    affected.sort((a, b) => a.order - b.order)
    for (const def of affected) {
      def.stale = true
      def.error = undefined
      def.launched = false
      this.publish(def)
    }
    // pass repeatedly: each cell runs at most once per invalidation, after all
    // its deps are fresh (async cells only get *scheduled*, stay stale until commit)
    const attempted = new Set<CellId>()
    let progress = true
    while (progress) {
      progress = false
      for (const def of affected) {
        if (!def.stale || attempted.has(def.id)) continue
        const depsStale = def.deps.some((d) => this.cells.get(d)!.stale)
        if (depsStale) continue
        attempted.add(def.id)
        this.run(def)
        progress = true
      }
    }
  }

  private run(def: CellDef) {
    if (def.kind === 'derive') {
      try {
        const inputs = def.deps.map((d) => this.cells.get(d)!.value)
        def.value = (def.fn as SyncFn<unknown>)(inputs)
        def.hasValue = true
        def.stale = false
        def.launched = false
        def.version++
        def.error = undefined
      } catch (err) {
        def.error = err
        def.stale = false
        def.launched = false
        def.hasValue = false // do not silently keep stale value on hard error
      }
      this.publish(def)
      return
    }
    // async: trailing debounce, generation-guarded commit
    if (def.debounceTimer !== undefined) clearTimeout(def.debounceTimer)
    const launch = () => {
      def.debounceTimer = undefined
      def.launched = true
      this.publish(def) // status → computing
      const generation = ++def.generation
      const inputs = def.deps.map((d) => this.cells.get(d)!.value)
      void Promise.resolve((def.fn as AsyncFn<unknown>)(inputs))
        .then((value) => {
          if (def.generation !== generation) return // superseded — discard
          if (!def.stale) return // was re-invalidated meanwhile
          def.value = value
          def.hasValue = true
          def.stale = false
          def.launched = false
          def.version++
          def.error = undefined
          this.publish(def)
          this.invalidate(def.id) // cascade into dependents
        })
        .catch((err) => {
          if (def.generation !== generation) return
          def.error = err
          def.stale = false
          def.launched = false
          this.publish(def)
        })
    }
    if (def.debounceMs > 0 && typeof setTimeout === 'function') {
      def.debounceTimer = setTimeout(launch, def.debounceMs)
    } else {
      launch()
    }
  }

  private publish(def: CellDef) {
    def.snapshot = {
      value: def.value,
      hasValue: def.hasValue,
      stale: def.stale,
      status: statusOf(def),
      version: def.version,
      error: def.error,
    }
    for (const cb of def.subscribers) cb()
  }
}
