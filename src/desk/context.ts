// Shared desk context: the ingested doc, the PDF blob URL, and the adapter
// decision. All shapes read the paper through this context — never a second
// copy of state (AGENTS.md §0.4).
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AdapterDecision } from '../skills/adapterRouter'
import type { IngestedDoc } from '../ingest/doclingSchema'
import { explorerStore } from './explorerStore'

export interface DeskPayload {
  doc: IngestedDoc
  pdfUrl: string
  fileName: string
  decision: AdapterDecision
}

export const DeskContext = createContext<DeskPayload | null>(null)

export function useDesk(): DeskPayload {
  const ctx = useContext(DeskContext)
  if (!ctx) throw new Error('useDesk outside DeskContext')
  return ctx
}

/** subscribe one explorer's current params/run */
export function useExplorer(id: string | null) {
  useSyncExternalStore(explorerStore.subscribe, explorerStore.getVersion, explorerStore.getVersion)
  return id ? explorerStore.get(id) : undefined
}

/** subscribe the whole store (ids list) */
export function useExplorerIds(): string[] {
  useSyncExternalStore(explorerStore.subscribe, explorerStore.getVersion, explorerStore.getVersion)
  return explorerStore.ids()
}
