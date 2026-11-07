// Optional image-based environment lighting from the local CC0 HDRI
// (studio_small_03). Purely presentational reflections/ambient for glassy
// tube volumes; mount inside a Suspense boundary because useLoader suspends.
// Keep envMapIntensity low so the warm paper look survives.
import { Environment } from '@react-three/drei'

export const HDRI_URL = '/assets/mathworld-library/hdri/studio_small_03_1k.hdr'

export function LabEnvironment({ envMapIntensity = 0.35 }: { envMapIntensity?: number }) {
  return (
    <Environment
      files={HDRI_URL}
      environmentIntensity={envMapIntensity}
      background={false}
    />
  )
}
