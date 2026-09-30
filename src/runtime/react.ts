// React bindings for the Reactive Research Runtime (no JSX so it stays .ts).
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { Runtime, type CellRef, type CellSnapshot } from './cell'

export const RuntimeContext = createContext<Runtime | null>(null)

export function RuntimeProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  return createElement(RuntimeContext.Provider, { value: runtime }, children)
}

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext)
  if (!rt) throw new Error('useRuntime must be used inside <RuntimeProvider>')
  return rt
}

/**
 * Subscribe a component to a cell. Re-renders on value commit or stale flag
 * change; snapshot identity is stable between publishes.
 */
export function useCell<T>(ref: CellRef<T> | string): CellSnapshot<T> {
  const rt = useRuntime()
  const id = typeof ref === 'string' ? ref : ref.id
  const subscribe = (cb: () => void) => rt.subscribe(id, cb)
  const getSnapshot = () => rt.get<T>(id)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
