// Minimal ambient types for @observablehq/runtime v6 (ships no .d.ts).
// Only the surface Paper2Lab uses (Runtime/Module/Variable + redefine).
declare module '@observablehq/runtime' {
  export interface ObserverLike {
    pending?: () => void
    fulfilled: (value: unknown) => void
    rejected: (error: Error) => void
  }

  export class Variable {
    define(name: string, value: unknown): Variable
    define(name: string, inputs: string[], definition: unknown): Variable
  }

  export class Module {
    variable(observer?: ObserverLike | null): Variable
    redefine(name: string, value: unknown): unknown
  }

  export class Runtime {
    constructor()
    module(define?: (runtime: Runtime, observer: (name: string) => ObserverLike) => void): Module
    dispose(): void
  }
}
