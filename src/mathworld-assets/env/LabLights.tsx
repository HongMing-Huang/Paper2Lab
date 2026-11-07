// Warm lab light rig — a tuned stand-in for the plain ambient+2×directional
// in Tubes3DView. Presentation-only; takes an intensity scale, never drives
// gameplay. Compose once per Canvas: <LabLights />.
export function LabLights({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      {/* soft ambient so paper objects never go black in shadowed corners */}
      <ambientLight intensity={0.62 * intensity} />
      {/* warm key from the upper right — matches the warm-white paper feel */}
      <directionalLight position={[3, 5, 4]} intensity={1.05 * intensity} color="#fff3e2" />
      {/* cool fill from below-left keeps tube glass readable on paper */}
      <directionalLight position={[-4, -2, -3]} intensity={0.32 * intensity} color="#e9f1fb" />
      {/* faint rim from behind for object silhouettes against the page */}
      <directionalLight position={[0, 2, -5]} intensity={0.22 * intensity} color="#fdf9f0" />
    </>
  )
}
