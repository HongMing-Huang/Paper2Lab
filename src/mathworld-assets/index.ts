// mathworld-assets — display-only asset kit for the math game world.
// Boundary contract: these components receive explicit presentation props and
// game-state enums; they never touch model parameters, ExperimentRun, Goal,
// collision rules, agent state, or any store. Decorative animation here is
// presentation only and never substitutes for computed results.
export { PAPER, PAPER_DEEP, INK, INK_SOFT, RULE, DOT, VERMILION, INK_BLUE, BRASS, PAPER_BLUE } from './palette'
export type { MathworldStatus } from './palette'
export { labMaterial, type LabMaterialProps } from './materials'
export { LabLights } from './env/LabLights'
export { LabGround, GROUND_TEXTURE_URL } from './env/LabGround'
export { LabEnvironment, HDRI_URL } from './env/LabEnvironment'
export { CubeFrame, type CubeFrameProps } from './env/CubeFrame'
export { TargetZone, type TargetState } from './markers/TargetZone'
export { SelectionRing, type SelectionState } from './markers/SelectionRing'
export { InkPath, type InkPathPoint } from './markers/InkPath'
export { StatusGlow } from './status/StatusGlow'
export { StatusChip, injectMathworldAssetStyles } from './status/StatusChip'
