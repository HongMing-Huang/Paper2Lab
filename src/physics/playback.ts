// Stage B interface surface for physics experiments: the playback contract
// (set_params / start / pause / reset / export_run) the interactive page and
// the Agent BOTH drive. This module is a PURE state machine — it computes no
// physics and produces no numbers. Evidence ALWAYS comes from
// mujoco.simulate ExperimentRuns (engine-side); playback only controls WHICH
// recorded run a viewer plays back and with what parameter overrides queued.
import type { MjParams } from './mujocoKernel'

export type PlaybackPhase = 'idle' | 'running' | 'paused'

export interface PlaybackState {
  phase: PlaybackPhase
  /** the run being viewed (evidence anchor; '' = none selected yet) */
  runId: string
  /** parameter overrides queued for the NEXT simulate (never mutating a run) */
  params: Required<Pick<MjParams, 'gravityZ'>> & Partial<Omit<MjParams, 'gravityZ'>>
  /** playhead in steps within [0, run sampling length) */
  cursor: number
}

export type PlaybackCommand =
  | { op: 'set_params'; params: Partial<MjParams> }
  | { op: 'start' }
  | { op: 'pause' }
  | { op: 'reset' }
  | { op: 'export_run' }

export interface PlaybackEffect {
  state: PlaybackState
  /** export_run asks for the current run bundle — the caller serves it from
   *  the run repository (immutable history), this machine only requests it */
  request?: 'export_run'
  /** set_params with changes requires a NEW simulate before numbers update */
  needsSimulate?: boolean
}

export const DEFAULT_PARAMS = { gravityZ: -9.81 } as const

export function initialPlayback(runId = ''): PlaybackState {
  return { phase: 'idle', runId, params: { ...DEFAULT_PARAMS }, cursor: 0 }
}

/**
 * Pure transition — no IO, no physics. Rules:
 *   set_params: merges overrides (clamped), pauses playback, flags a new sim
 *   start:      idle/paused → running (a run must be attached first)
 *   pause:      running → paused
 *   reset:      cursor → 0 and phase → idle (the RUN itself is immutable)
 *   export_run: emits the request; state unchanged
 */
export function playbackCommand(state: PlaybackState, cmd: PlaybackCommand): PlaybackEffect {
  switch (cmd.op) {
    case 'set_params': {
      const next = { ...state.params }
      const p = cmd.params
      if (p.gravityZ !== undefined) next.gravityZ = clamp(p.gravityZ, -100, 100)
      if (p.windX !== undefined) next.windX = clamp(p.windX, -50, 50)
      if (p.timestep !== undefined) next.timestep = clamp(p.timestep, 1e-5, 0.1)
      const changed = JSON.stringify(next) !== JSON.stringify(state.params)
      return {
        state: { ...state, params: next, phase: state.phase === 'running' ? 'paused' : state.phase },
        needsSimulate: changed,
      }
    }
    case 'start': {
      if (!state.runId) return { state } // nothing recorded to play — refuse
      return { state: { ...state, phase: 'running' } }
    }
    case 'pause':
      return { state: { ...state, phase: state.phase === 'running' ? 'paused' : state.phase } }
    case 'reset':
      return { state: { ...state, cursor: 0, phase: 'idle' } }
    case 'export_run':
      return { state, request: 'export_run' }
    default:
      return { state }
  }
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) throw new Error(`playback param must be finite: ${v}`)
  return Math.min(max, Math.max(min, v))
}
