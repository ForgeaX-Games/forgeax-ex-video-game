declare module 'eslint-scope' {
  import type { Identifier, Program } from 'estree'

  export interface ScopeReference {
    identifier: Identifier
  }

  export interface ScopeVariable {
    name: string
    identifiers: Identifier[]
  }

  export interface Scope {
    variables: ScopeVariable[]
    childScopes: Scope[]
    through: ScopeReference[]
  }

  export interface ScopeManager {
    globalScope: Scope | null
  }

  export function analyze(
    tree: Program,
    options: {
      ecmaVersion: number
      sourceType: 'module' | 'script'
    },
  ): ScopeManager
}
