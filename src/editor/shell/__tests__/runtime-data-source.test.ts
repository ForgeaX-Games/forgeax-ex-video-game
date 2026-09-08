import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', '..', relativePath), 'utf8')
}

describe('extension runtime data sources', () => {
  it('does not use the bundled NODIA demo as the editor or play surface source', () => {
    expect(source('GraphApp.tsx')).not.toMatch(/NODIA_DEMO/)
    expect(source('shell/GraphStudio.tsx')).not.toMatch(/NODIA_DEMO/)
  })
})
