// Material presets for math game objects — plain prop objects meant to be
// spread onto <meshStandardMaterial {...labMaterial.paperWhite} />, so the
// game window composes them on its own meshes without adopting a store.
// Values tuned for the warm-paper lab: low metalness, matte paper look.
import { INK_BLUE, PAPER, PAPER_BLUE, RULE, VERMILION, BRASS } from './palette'

export interface LabMaterialProps {
  color: string
  roughness: number
  metalness: number
  transparent?: boolean
  opacity?: number
  emissive?: string
  emissiveIntensity?: number
}

export const labMaterial = {
  /** math-object paper white — the visual centre, reads on any ground */
  paperWhite: { color: PAPER, roughness: 0.82, metalness: 0.02 } as LabMaterialProps,
  /** computed / charted objects (blue ink) */
  inkBlue: { color: INK_BLUE, roughness: 0.45, metalness: 0.05 } as LabMaterialProps,
  /** annotated / flagged objects (vermilion) */
  vermilion: { color: VERMILION, roughness: 0.5, metalness: 0.05 } as LabMaterialProps,
  /** player-graspable furniture accents */
  brass: { color: BRASS, roughness: 0.38, metalness: 0.55 } as LabMaterialProps,
  /** glassy tube volumes (matches Tubes3DView opacity) */
  glass: { color: PAPER_BLUE, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.6 } as LabMaterialProps,
  /** muted reference/annotation surfaces */
  rule: { color: RULE, roughness: 0.9, metalness: 0 } as LabMaterialProps,
} as const
