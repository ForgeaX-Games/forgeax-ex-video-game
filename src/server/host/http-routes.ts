/**
 * HTTP route declarations for the game-video extension router.
 *
 * This module is the SSOT for method/path → service method mapping.
 * Handlers live in `router.ts` / `extension-service.ts`; hosts must not re-declare
 * these paths.
 */

export type GameVideoServiceMethod =
  | 'importCharacterRefs'
  | 'importSceneRefs'
  | 'polishVideoPrompt'
  | 'polishOverlayPrompt'
  | 'generateShotScript'
  | 'generateKeyframe'
  | 'generateVideo'
  | 'generateNodeVideo'
  | 'upsertDocument'
  | 'importStageArtifacts'
  | 'applyDesignOptions'
  | 'confirmPillarAuthorGate'
  | 'reconcileProductionFailure'
  | 'markPeerAbandonedActivity'
  | 'registerKinoReference'

export type GameVideoHttpRoute = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly path: string
  /** Service method for POST routes that share the JSON body → service pattern. */
  readonly service?: GameVideoServiceMethod
  /** Free-form GET/POST handlers implemented in router.ts. */
  readonly kind?: 'asset-catalog' | 'image-generation-lifecycle' | 'list-assets' | 'get-asset' | 'list-documents' | 'get-document' | 'upsert-document' | 'delete-component' | 'bundled-media' | 'get-style-axes' | 'set-style-axes' | 'host-media' | 'audio-waveform' | 'get-workflow-state' | 'get-node-production-context' | 'bind-node-kino-references' | 'get-pillar-author-gate-proposal'
}

/** Ordered for documentation; router may use maps for O(1) lookup. */
export const GAME_VIDEO_HTTP_ROUTES: readonly GameVideoHttpRoute[] = [
  { method: 'GET', path: 'asset-catalog', kind: 'asset-catalog' },
  { method: 'GET', path: 'asset-catalog/history', kind: 'asset-catalog' },
  { method: 'POST', path: 'asset-catalog', kind: 'asset-catalog' },
  { method: 'POST', path: 'generation/image/lifecycle', kind: 'image-generation-lifecycle' },
  { method: 'GET', path: 'assets', kind: 'list-assets' },
  { method: 'GET', path: 'assets/:id', kind: 'get-asset' },
  { method: 'GET', path: 'documents', kind: 'list-documents' },
  { method: 'GET', path: 'documents/:id', kind: 'get-document' },
  { method: 'GET', path: 'workflow-state', kind: 'get-workflow-state' },
  { method: 'GET', path: 'node-production-context', kind: 'get-node-production-context' },
  { method: 'POST', path: 'node-production-context/kino-references', kind: 'bind-node-kino-references' },
  { method: 'GET', path: 'author-gates/pillar/proposal', kind: 'get-pillar-author-gate-proposal' },
  { method: 'POST', path: 'author-gates/pillar/confirm', service: 'confirmPillarAuthorGate' },
  { method: 'POST', path: 'workflow/reconcile-production', service: 'reconcileProductionFailure' },
  { method: 'POST', path: 'workflow/reconcile-peer-abandoned', service: 'markPeerAbandonedActivity' },
  { method: 'POST', path: 'documents/upsert', service: 'upsertDocument' },
  { method: 'POST', path: 'stage-artifacts/import', service: 'importStageArtifacts' },
  { method: 'DELETE', path: 'components/:id', kind: 'delete-component' },
  { method: 'POST', path: 'documents/design-options/apply', service: 'applyDesignOptions' },
  { method: 'GET', path: 'media/bundled/:name', kind: 'bundled-media' },
  { method: 'GET', path: 'style-axes', kind: 'get-style-axes' },
  { method: 'POST', path: 'style-axes', kind: 'set-style-axes' },
  { method: 'POST', path: 'references/characters/import', service: 'importCharacterRefs' },
  { method: 'POST', path: 'references/scenes/import', service: 'importSceneRefs' },
  { method: 'POST', path: 'references/kino/register', service: 'registerKinoReference' },
  { method: 'POST', path: 'generation/prompt-polish', service: 'polishVideoPrompt' },
  { method: 'POST', path: 'generation/overlay-prompt-polish', service: 'polishOverlayPrompt' },
  { method: 'POST', path: 'generation/shot-script', service: 'generateShotScript' },
  { method: 'POST', path: 'generation/keyframe', service: 'generateKeyframe' },
  { method: 'POST', path: 'generation/video', service: 'generateVideo' },
  { method: 'POST', path: 'generation/node-video', service: 'generateNodeVideo' },
  { method: 'GET', path: 'media/capabilities', kind: 'host-media' },
  { method: 'GET', path: 'media/audio-waveform', kind: 'audio-waveform' },
  { method: 'GET', path: 'media/assets/:id', kind: 'host-media' },
  { method: 'POST', path: 'media/image-assets/upload', kind: 'host-media' },
  { method: 'GET', path: 'media/resources', kind: 'host-media' },
  { method: 'POST', path: 'media/resources', kind: 'host-media' },
  { method: 'POST', path: 'media/resources/batch', kind: 'host-media' },
  { method: 'GET', path: 'media/resources/:id', kind: 'host-media' },
  { method: 'PUT', path: 'media/resources/:id', kind: 'host-media' },
  { method: 'DELETE', path: 'media/resources/:id', kind: 'host-media' },
  { method: 'GET', path: 'media/resources/:id/content', kind: 'host-media' },
  { method: 'PUT', path: 'media/uploads/:id', kind: 'host-media' },
] as const

/** POST paths that dispatch to `createGameVideoService` methods. */
export const GAME_VIDEO_POST_SERVICE_ROUTES: ReadonlyMap<string, GameVideoServiceMethod> =
  new Map(
    GAME_VIDEO_HTTP_ROUTES
      .filter((route): route is GameVideoHttpRoute & { service: GameVideoServiceMethod } =>
        route.method === 'POST' && route.service !== undefined)
      .map((route) => [route.path, route.service]),
  )
