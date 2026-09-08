import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { upsertAuthoredComponent } from './component-authoring'
import { createGameVideoRouter } from './router'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function createContext() {
  const files = new Map<string, Uint8Array>()
  const context = {
    gameId: 'game-1',
    files: {
      async list(directory: string) {
        const prefix = `${directory.replace(/\/+$/u, '')}/`
        return [...new Set([...files.keys()]
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split('/', 1)[0]!)
          .filter(Boolean))].sort()
      },
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async delete(path: string) { files.delete(path) },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
  } as unknown as ExtensionContext
  return { context, files }
}

function deleteRequest(id: string) {
  return {
    gameId: 'game-1',
    runtimeId: 'runtime-1',
    method: 'DELETE',
    path: `components/${id}`,
    headers: {},
    query: {},
    body: new Uint8Array(),
  } as const
}

describe('project component deletion route', () => {
  it('deletes an authored component through the host-bound file capability', async () => {
    const { context, files } = createContext()
    await upsertAuthoredComponent(context, {
      id: 'CountdownTimer',
      events: [],
      implementation: "function CountdownTimer() { return React.createElement('span') }",
    })

    const response = await createGameVideoRouter(context).handle(deleteRequest('CountdownTimer'))

    expect(response.status).toBe(200)
    expect(JSON.parse(decoder.decode(response.body))).toMatchObject({
      ok: true,
      componentId: 'CountdownTimer',
      deleted: true,
    })
    expect(files.has('components/definitions/CountdownTimer.json')).toBe(false)
  })

  it('returns a repairable conflict when persisted references remain', async () => {
    const { context, files } = createContext()
    await upsertAuthoredComponent(context, {
      id: 'CountdownTimer',
      events: [],
      implementation: "function CountdownTimer() { return React.createElement('span') }",
    })
    files.set('blueprint.json', encoder.encode(JSON.stringify({
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      ui: { overlays: { timer: { id: 'timer', children: [{ id: 'timer', component: 'CountdownTimer' }] } } },
      manifest: {
        version: 'game-video.blueprint-manifest.v1',
        mainPackId: 'main',
        packs: { main: { id: 'main', title: 'Main', entry: 'entry', graph: { nodes: [], edges: [] } } },
      },
    })))

    const response = await createGameVideoRouter(context).handle(deleteRequest('CountdownTimer'))

    expect(response.status).toBe(409)
    expect(JSON.parse(decoder.decode(response.body))).toMatchObject({
      error: { code: 'component_in_use', target: 'CountdownTimer' },
    })
    expect(files.has('components/definitions/CountdownTimer.json')).toBe(true)
  })
})
