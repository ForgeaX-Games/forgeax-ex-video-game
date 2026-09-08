import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const playerRoot = resolve(import.meta.dirname, '..')
const forbidden = ['/api/game-host', '/__gva__']

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'game' ? [] : productionSources(path)
    }
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('standalone SDK route ownership', () => {
  it('contains no ForgeaX product or __gva__ runtime routes', () => {
    const violations = productionSources(playerRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return forbidden
        .filter((route) => source.includes(route))
        .map((route) => `${relative(playerRoot, path)}: ${route}`)
    })

    expect(violations).toEqual([])
  })
})
