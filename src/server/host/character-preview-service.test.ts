import { describe, expect, it } from 'vitest'
import type { CharacterDefinition } from '@/authoring/assets/registry-types'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { requiredCharacterPreviewTargets } from '../generation/character-previews'

function character(id: string): CharacterDefinition {
  return {
    id,
    name: id,
    appearance: {
      description: `${id} 的外观`,
      previewPrompt: `${id} 的参考图`,
    },
  }
}

function project(cast: Array<{ characterId: string, onScreen?: boolean }>): GraphLibraryDocument {
  const graph = {
    nodes: [{
      id: 'entry',
      type: 'scene' as const,
      position: { x: 0, y: 0 },
      data: { name: 'entry', cast },
    }],
    edges: [],
  }
  return {
    manifest: { mainPackId: 'main', packs: { main: { id: 'main', title: 'main', entry: 'entry', graph } } },
    graph,
  } as unknown as GraphLibraryDocument
}

describe('角色预览目标只来自节点实际出场声明', () => {
  it('忽略目录里未被任何节点使用的角色', () => {
    const characters = {
      hero: character('hero'),
      unused: character('unused'),
    }

    expect(requiredCharacterPreviewTargets(
      project([{ characterId: 'hero' }]),
      characters,
    ).map((target) => target.characterId)).toEqual(['hero'])
  })

  it('忽略仅叙事提及的 onScreen=false 角色', () => {
    const characters = {
      hero: character('hero'),
      narrator: character('narrator'),
    }

    expect(requiredCharacterPreviewTargets(
      project([
        { characterId: 'hero' },
        { characterId: 'narrator', onScreen: false },
      ]),
      characters,
    ).map((target) => target.characterId)).toEqual(['hero'])
  })
})
