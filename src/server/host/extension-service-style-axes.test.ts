import { describe, expect, it, vi } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'

const { generateShotScript } = vi.hoisted(() => ({
  generateShotScript: vi.fn(async () => []),
}))

vi.mock('../generation/orchestrate', () => ({
  createHostGenerationOrchestrator: () => ({
    generateShotScript,
    generateKeyframe: vi.fn(),
    generateVideo: vi.fn(),
    generateNodeVideo: vi.fn(),
  }),
}))

import { createGameVideoService } from './extension-service'

describe('extension-service style axes', () => {
  it('passes only supplied style-axis override keys to the orchestrator', async () => {
    const context = {
      gameId: 'demo',
      files: {},
    } as unknown as ExtensionContext
    const service = createGameVideoService(context)

    await service.generateShotScript({
      nodeName: 'Opening',
      storyText: 'Hero enters',
      durationSeconds: 4,
      styleAxes: { director: 'precision-noir' },
    })

    expect(generateShotScript).toHaveBeenCalledWith(expect.objectContaining({
      styleAxes: { director: 'precision-noir' },
    }))
  })
})
