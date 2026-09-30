/// <reference types="vite/client" />
import type { MathfieldElement } from 'mathlive'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<
        React.HTMLAttributes<MathfieldElement> & {
          value?: string
          'read-only'?: boolean
        },
        MathfieldElement
      >
    }
  }
}
