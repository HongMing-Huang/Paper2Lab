// MathLive static rendering for PAPER/CALCULATED formulas, plus an editable
// math-field sandbox (clearly labelled AI INFERENCE exploration).
import { convertLatexToMarkup, MathfieldElement } from 'mathlive'
import { useEffect, useRef } from 'react'
import type { Provenance } from '../../paper/wangZahl'

export function FormulaView({ tex }: { tex: string }) {
  return (
    <div
      className="formula-static"
      // convertLatexToMarkup produces MathLive's own trusted markup for `tex`
      dangerouslySetInnerHTML={{ __html: convertLatexToMarkup(tex) }}
    />
  )
}

export function FormulaBadge({ provenance }: { provenance: Provenance }) {
  return <span className={`badge badge-${provenance.toLowerCase()}`}>{provenance}</span>
}

/** editable formula sandbox — value changes are presentational only */
export function FormulaSandbox({ initialTex }: { initialTex: string }) {
  const ref = useRef<MathfieldElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.value = initialTex
  }, [initialTex])
  return <math-field ref={ref} read-only={false} class-name="nodrag" />
}
