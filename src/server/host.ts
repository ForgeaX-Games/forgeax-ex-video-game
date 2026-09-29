import { defineExtension } from '@forgeax/extension-host/node'
import {
  createEmptyLibrarySeed,
  validateEmptyLibrarySeed,
  validateVideoGameSeed,
} from './host/empty-library-seed'
import { createVideoGameTemplateSeed } from './host/video-game-template-seed'
import { createGameVideoRouter } from './host/router'
import { ensureAuthoredComponentModule } from './host/component-authoring'
import { tools } from './tool-handlers'

export const host = defineExtension({
  tools,
  gamePackage: {
    platform: 'game-video',
    async createSeed(context) {
      const seed = await createVideoGameTemplateSeed(context)
      await ensureAuthoredComponentModule(context)
      return seed
    },
    async validateSeed(seed) {
      validateVideoGameSeed(seed)
    },
  },
  createRouter: createGameVideoRouter,
})

export {
  tools,
  createEmptyLibrarySeed,
  createVideoGameTemplateSeed,
  validateEmptyLibrarySeed,
  validateVideoGameSeed,
}
export default host
