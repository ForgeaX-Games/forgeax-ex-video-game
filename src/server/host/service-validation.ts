import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import generateKeyframeSchema from '../../../schemas/generate-keyframe.args.json'
import generateNodeVideoSchema from '../../../schemas/generate-node-video.args.json'
import generateShotScriptSchema from '../../../schemas/generate-shot-script.args.json'
import generateVideoSchema from '../../../schemas/generate-video.args.json'
import generateVideoClipSchema from '../../../schemas/generate-video-clip.args.json'
import getAssetSchema from '../../../schemas/get-asset.args.json'
import getGraphSchema from '../../../schemas/get-graph.args.json'
import importCharacterRefsSchema from '../../../schemas/import-character-refs.args.json'
import importSceneRefsSchema from '../../../schemas/import-scene-refs.args.json'
import listAssetsSchema from '../../../schemas/list-assets.args.json'
import upsertDocumentSchema from '../../../schemas/upsert-document.args.json'
import listVideosSchema from '../../../schemas/list-videos.args.json'
import patchGraphSchema from '../../../schemas/patch-graph.args.json'
import patchNodeMediaSchema from '../../../schemas/patch-node-media.args.json'
import patchRulesSchema from '../../../schemas/patch-rules.args.json'
import saveGraphSchema from '../../../schemas/save-graph.args.json'
import applyDesignOptionsSchema from '../../../schemas/apply-design-options.args.json'
import getWorkflowStateSchema from '../../../schemas/get-workflow-state.args.json'
import beginActivitySchema from '../../../schemas/begin-activity.args.json'
import awaitUserSchema from '../../../schemas/await-user.args.json'
import completeActivitySchema from '../../../schemas/complete-activity.args.json'
import reportBlockerSchema from '../../../schemas/report-blocker.args.json'
import focusPageSchema from '../../../schemas/focus-page.args.json'
import inspectProjectSchema from '../../../schemas/inspect-project.args.json'
import preflightActivitySchema from '../../../schemas/preflight-activity.args.json'
import listUiComponentsSchema from '../../../schemas/list-ui-components.args.json'
import validateProjectSchema from '../../../schemas/validate-project.args.json'
import simulatePassASchema from '../../../schemas/simulate-pass-a.args.json'
import getNodeProductionContextSchema from '../../../schemas/get-node-production-context.args.json'
import patchCharactersSchema from '../../../schemas/patch-characters.args.json'
import patchScenesSchema from '../../../schemas/patch-scenes.args.json'
import generateScenePreviewsSchema from '../../../schemas/generate-scene-previews.args.json'
import generateCharacterPreviewsSchema from '../../../schemas/generate-character-previews.args.json'
import registerKinoReferenceSchema from '../../../schemas/register-kino-reference.args.json'

export type ServiceSchemaName =
  | 'getGraph'
  | 'saveGraph'
  | 'patchGraph'
  | 'patchNodeMedia'
  | 'patchRules'
  | 'listAssets'
  | 'listVideos'
  | 'getAsset'
  | 'importCharacterRefs'
  | 'importSceneRefs'
  | 'generateShotScript'
  | 'generateKeyframe'
  | 'generateVideo'
  | 'generateVideoClip'
  | 'generateNodeVideo'
  | 'upsertDocument'
  | 'applyDesignOptions'
  | 'getWorkflowState'
  | 'beginActivity'
  | 'awaitUser'
  | 'completeActivity'
  | 'reportBlocker'
  | 'focusPage'
  | 'inspectProject'
  | 'preflightActivity'
  | 'listUiComponents'
  | 'validateProject'
  | 'simulatePassA'
  | 'getNodeProductionContext'
  | 'patchCharacters'
  | 'generateCharacterPreviews'
  | 'patchScenes'
  | 'generateScenePreviews'
  | 'registerKinoReference'

const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { 'date-time': true } })
const validators: Record<ServiceSchemaName, ValidateFunction> = {
  getGraph: ajv.compile(getGraphSchema),
  saveGraph: ajv.compile(saveGraphSchema),
  patchGraph: ajv.compile(patchGraphSchema),
  patchNodeMedia: ajv.compile(patchNodeMediaSchema),
  patchRules: ajv.compile(patchRulesSchema),
  listAssets: ajv.compile(listAssetsSchema),
  listVideos: ajv.compile(listVideosSchema),
  getAsset: ajv.compile(getAssetSchema),
  importCharacterRefs: ajv.compile(importCharacterRefsSchema),
  importSceneRefs: ajv.compile(importSceneRefsSchema),
  generateShotScript: ajv.compile(generateShotScriptSchema),
  generateKeyframe: ajv.compile(generateKeyframeSchema),
  generateVideo: ajv.compile(generateVideoSchema),
  generateVideoClip: ajv.compile(generateVideoClipSchema),
  generateNodeVideo: ajv.compile(generateNodeVideoSchema),
  upsertDocument: ajv.compile(upsertDocumentSchema),
  applyDesignOptions: ajv.compile(applyDesignOptionsSchema),
  getWorkflowState: ajv.compile(getWorkflowStateSchema),
  beginActivity: ajv.compile(beginActivitySchema),
  awaitUser: ajv.compile(awaitUserSchema),
  completeActivity: ajv.compile(completeActivitySchema),
  reportBlocker: ajv.compile(reportBlockerSchema),
  focusPage: ajv.compile(focusPageSchema),
  inspectProject: ajv.compile(inspectProjectSchema),
  preflightActivity: ajv.compile(preflightActivitySchema),
  listUiComponents: ajv.compile(listUiComponentsSchema),
  validateProject: ajv.compile(validateProjectSchema),
  simulatePassA: ajv.compile(simulatePassASchema),
  getNodeProductionContext: ajv.compile(getNodeProductionContextSchema),
  patchCharacters: ajv.compile(patchCharactersSchema),
  generateCharacterPreviews: ajv.compile(generateCharacterPreviewsSchema),
  patchScenes: ajv.compile(patchScenesSchema),
  generateScenePreviews: ajv.compile(generateScenePreviewsSchema),
  registerKinoReference: ajv.compile(registerKinoReferenceSchema),
}

function message(error: ErrorObject): string {
  const target = error.instancePath || 'input'
  return `${target} ${error.message ?? 'is invalid'}`
}

export function validateServiceInput(
  schema: ServiceSchemaName,
  value: unknown,
): string[] {
  const validate = validators[schema]
  return validate(value) ? [] : (validate.errors ?? []).map(message)
}
