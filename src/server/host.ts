import { defineExtension } from '@forgeax/extension-host/node'
import { createEmptyLibrarySeed, validateEmptyLibrarySeed } from './host/empty-library-seed'
import { createNodiaSeed, validateNodiaSeed } from './host/nodia-seed'
import { createGameVideoRouter } from './host/router'
import { ensureAuthoredComponentModule } from './host/component-authoring'
import { tools } from './tool-handlers'

export const host = defineExtension({
  tools,
  gamePackage: {
    platform: 'game-video',
    async createSeed(context) {
      const seed = await createEmptyLibrarySeed(context)
      await ensureAuthoredComponentModule(context)
      return seed
    },
    async validateSeed(seed) {
      validateEmptyLibrarySeed(seed)
    },
  },
  createRouter: createGameVideoRouter,
})

export { tools, createNodiaSeed, validateNodiaSeed, createEmptyLibrarySeed, validateEmptyLibrarySeed }
export default host
