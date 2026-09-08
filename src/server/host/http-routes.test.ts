import { describe, expect, it } from 'vitest'
import {
  GAME_VIDEO_HTTP_ROUTES,
  GAME_VIDEO_POST_SERVICE_ROUTES,
} from './http-routes'

describe('GAME_VIDEO_HTTP_ROUTES', () => {
  it('lists every extension HTTP surface once', () => {
    const keys = GAME_VIDEO_HTTP_ROUTES.map((route) => `${route.method} ${route.path}`)
    expect(keys).toEqual([
      'GET asset-catalog',
      'GET asset-catalog/history',
      'POST asset-catalog',
      'POST generation/image/lifecycle',
      'GET assets',
      'GET assets/:id',
      'GET documents',
      'GET documents/:id',
      'GET workflow-state',
      'GET node-production-context',
      'POST node-production-context/kino-references',
      'GET author-gates/pillar/proposal',
      'POST author-gates/pillar/confirm',
      'POST workflow/reconcile-production',
      'POST workflow/reconcile-peer-abandoned',
      'POST documents/upsert',
      'POST stage-artifacts/import',
      'DELETE components/:id',
      'POST documents/design-options/apply',
      'GET media/bundled/:name',
      'GET style-axes',
      'POST style-axes',
      'POST references/characters/import',
      'POST references/scenes/import',
      'POST references/kino/register',
      'POST generation/prompt-polish',
      'POST generation/overlay-prompt-polish',
      'POST generation/shot-script',
      'POST generation/keyframe',
      'POST generation/video',
      'POST generation/node-video',
      'GET media/capabilities',
      'GET media/audio-waveform',
      'GET media/assets/:id',
      'POST media/image-assets/upload',
      'GET media/resources',
      'POST media/resources',
      'POST media/resources/batch',
      'GET media/resources/:id',
      'PUT media/resources/:id',
      'DELETE media/resources/:id',
      'GET media/resources/:id/content',
      'PUT media/uploads/:id',
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps POST service dispatch map aligned with the declaration table', () => {
    expect([...GAME_VIDEO_POST_SERVICE_ROUTES.entries()]).toEqual([
      ['author-gates/pillar/confirm', 'confirmPillarAuthorGate'],
      ['workflow/reconcile-production', 'reconcileProductionFailure'],
      ['workflow/reconcile-peer-abandoned', 'markPeerAbandonedActivity'],
      ['documents/upsert', 'upsertDocument'],
      ['stage-artifacts/import', 'importStageArtifacts'],
      ['documents/design-options/apply', 'applyDesignOptions'],
      ['references/characters/import', 'importCharacterRefs'],
      ['references/scenes/import', 'importSceneRefs'],
      ['references/kino/register', 'registerKinoReference'],
      ['generation/prompt-polish', 'polishVideoPrompt'],
      ['generation/overlay-prompt-polish', 'polishOverlayPrompt'],
      ['generation/shot-script', 'generateShotScript'],
      ['generation/keyframe', 'generateKeyframe'],
      ['generation/video', 'generateVideo'],
      ['generation/node-video', 'generateNodeVideo'],
    ])
  })
})
