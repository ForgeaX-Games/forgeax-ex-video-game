/**
 * Manifest-facing tool adapters.
 *
 * Each handler receives a capability-bounded host context from the Extension
 * runtime and forwards its published schema input to the shared service.
 */
import type { ExtensionToolHandler } from '@forgeax/extension-host/node'
import { ExtensionError, type ExtensionErrorEnvelope } from '@forgeax/extension-host/contracts'
import {
  createGameVideoService,
  getAssetIdFromArgs,
} from './host/extension-service'
import {
  ComponentAuthoringConflictError,
  ComponentAuthoringInputError,
} from './host/component-authoring'
import { readWorkflowState, WorkflowStateError } from './host/workflow-state'
import { recordRejection } from './host/retry-ledger'

/**
 * 输入类错误也必须结构化回传。
 *
 * 只包 `WorkflowStateError` 时，schema 校验失败、参数非法、控件契约冲突都会落到
 * Host 的兜底分支，变成 `internal_error / Unexpected extension host error`。
 * 实测里这正是重试风暴的第一大来源：模型拿不到任何可据以修正的信息，
 * 只能原样再试一次（一次会话里 `begin_activity` 被调 93 次、25 次拿到这个泛化错误）。
 */
function inputErrorEnvelope(error: unknown): ExtensionErrorEnvelope | null {
  if (error instanceof ComponentAuthoringInputError) {
    return {
      ok: false,
      error: {
        code: error.code,
        target: 'component',
        message: error.message,
        retryable: true,
        details: { retry: 'fix-then-retry' },
      },
    }
  }
  if (error instanceof ComponentAuthoringConflictError) {
    return {
      ok: false,
      error: {
        code: error.code,
        target: 'component',
        message: error.message,
        // 冲突是重读后重试就能过的，不该报成不可重试。
        retryable: true,
        details: { retry: 'retry-now' },
      },
    }
  }
  // schema / 参数校验：`ExtensionServiceInputError` 与 ajv 的 TypeError 都走这里。
  if (error instanceof TypeError && error.message) {
    const code = (error as { code?: unknown }).code
    return {
      ok: false,
      error: {
        code: typeof code === 'string' ? code : 'invalid_input',
        target: 'input',
        message: error.message.slice(0, 2_000),
        retryable: true,
        details: { retry: 'fix-then-retry' },
      },
    }
  }
  return null
}

function exposeWorkflowErrors(handler: ExtensionToolHandler): ExtensionToolHandler {
  return async (context, args) => {
    try {
      return await handler(context, args)
    } catch (error) {
      const inputEnvelope = inputErrorEnvelope(error)
      if (inputEnvelope) throw inputEnvelope
      if (error instanceof WorkflowStateError) {
        // Agent 走的是这条 MCP 出口，不是 HTTP router：三态语义与结构化指引必须
        // 在这里一起带出去，否则 `stop` 类错误会被当成可重试而空转（设计 §9.7.5）。
        // 这里也是唯一能统计「同码失败几次」的收口点，重试预算因此在此执行。
        const activity = error.guidance?.currentActivity ?? 'unknown'
        const rejection = await recordRejection(context, {
          activity,
          activityRevision: error.currentRevision ?? 0,
          code: error.code,
          retry: error.retry,
        }).catch(() => ({ attempts: 0, retry: error.retry, budgetExhausted: false }))
        const envelope: ExtensionErrorEnvelope = {
          ok: false,
          error: {
            code: error.code,
            target: 'workflow',
            message: rejection.budgetExhausted
              ? `${error.message}（同一错误已连续失败 ${rejection.attempts} 次，请 report_blocker 交回编排者，不要继续重试）`
              : error.message,
            retryable: rejection.retry !== 'stop',
            details: {
              retry: rejection.retry,
              ...(rejection.attempts > 0 ? { attempts: rejection.attempts } : {}),
              ...(rejection.budgetExhausted ? { budgetExhausted: true } : {}),
              ...(error.currentRevision === undefined
                ? {}
                : { currentRevision: error.currentRevision }),
              ...(error.guidance ? { guidance: error.guidance } : {}),
            },
          },
        }
        // Directory-loaded extensions can resolve a separate copy of the Host
        // package, so an instanceof-based ExtensionError loses its identity at
        // the Host boundary. The public envelope is deliberately structural.
        throw envelope
      }
      throw error
    }
  }
}

async function assertPaidMediaGenerationReady(
  context: Parameters<ExtensionToolHandler>[0],
): Promise<void> {
  const workflow = await readWorkflowState(context)
  const handedOff = workflow?.activity === 'playtest.validating'
    && workflow.activityStatus === 'complete'
    && workflow.phaseStatus === 'complete'
  if (!workflow || handedOff) return
  throw new ExtensionError({
    code: 'workflow.media-generation-not-ready',
    target: 'workflow',
    retryable: false,
    message: `Paid keyframe/video generation is blocked during ${workflow.activity}. Do not retry this tool or switch media-generation tools. Character references require patch_characters, node cast, and automatic generate_character_previews with a stable idempotencyKey; no user confirmation is required for character previews. Node media generation starts only after playtest.validating completes and the author explicitly requests it.`,
    details: {
      activity: workflow.activity,
      characterAssetTool: 'game-video:generate-character-previews',
      requiredVideoActivity: 'playtest.validating:complete',
    },
  })
}

const getGraph: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).getGraph(args)
)

const saveGraph: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).saveGraph(args)
)

const patchGraph: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).patchGraph(args)
)

const patchNodeMedia: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).patchNodeMedia(args)
)

const patchRules: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).patchRules(args)
)

const patchCharacters: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).patchCharacters(args)
)

const generateCharacterPreviews: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).generateCharacterPreviews(args)
)

const patchScenes: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).patchScenes(args)
)

const generateScenePreviews: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).generateScenePreviews(args)
)

const getWorkflowState: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).getWorkflowState(args)
)

const beginActivity: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).beginActivity(args)
)

const awaitUser: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).awaitUser(args)
)

const completeActivity: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).completeActivity(args)
)

const reportBlocker: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).reportBlocker(args)
)

const focusPage: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).focusPage(args)
)

const inspectProject: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).inspectProject(args)
)

const preflightActivity: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).preflightActivity(args)
)

const listUiComponents: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).listUiComponents(args)
)

const validateProject: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).validateProject(args)
)

const simulatePassA: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).simulatePassA(args)
)

const getNodeProductionContext: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).getNodeProductionContext(args)
)

const listVideos: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).listVideos(args)
)

const generateShotScript: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).generateShotScript(args)
)

const generateKeyframe: ExtensionToolHandler = async (context, args) => {
  await assertPaidMediaGenerationReady(context)
  return createGameVideoService(context).generateKeyframe(args)
}

const generateVideo: ExtensionToolHandler = async (context, args) => {
  await assertPaidMediaGenerationReady(context)
  return createGameVideoService(context).generateVideo(args)
}

const generateVideoClip: ExtensionToolHandler = async (context, args) => {
  await assertPaidMediaGenerationReady(context)
  return createGameVideoService(context).generateVideoClip(args)
}

const listVideoVisualStyles: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).listVideoVisualStyles(args)
)

const generateNodeVideo: ExtensionToolHandler = async (context, args) => {
  await assertPaidMediaGenerationReady(context)
  return createGameVideoService(context).generateNodeVideo(args)
}

const listAssets: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).listAssets(args)
)

const getAsset: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).getAsset(
    getAssetIdFromArgs(args),
  )
)

const importCharacterRefs: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).importCharacterRefs(args)
)

const importSceneRefs: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).importSceneRefs(args)
)

const upsertDocument: ExtensionToolHandler = async (context, args) => (
  createGameVideoService(context).upsertDocument(args)
)

const upsertComponent: ExtensionToolHandler = async (context, args) => {
  try {
    return await createGameVideoService(context).upsertComponent(args)
  } catch (error) {
    if (error instanceof ComponentAuthoringInputError) {
      throw {
        ok: false,
        error: {
          code: error.code,
          target: 'implementation',
          message: error.message,
          retryable: false,
        },
      } satisfies ExtensionErrorEnvelope
    }
    throw error
  }
}

/** Ordered to exactly match `forgeax-extension.json`'s public tool contract. */
const rawTools: Record<string, ExtensionToolHandler> = {
  'game-video:get-graph': getGraph,
  'game-video:save-graph': saveGraph,
  'game-video:patch-graph': patchGraph,
  'game-video:patch-node-media': patchNodeMedia,
  'game-video:patch-rules': patchRules,
  'game-video:patch-characters': patchCharacters,
  'game-video:generate-character-previews': generateCharacterPreviews,
  'game-video:patch-scenes': patchScenes,
  'game-video:generate-scene-previews': generateScenePreviews,
  'game-video:get-workflow-state': getWorkflowState,
  'game-video:begin-activity': beginActivity,
  'game-video:await-user': awaitUser,
  'game-video:complete-activity': completeActivity,
  'game-video:report-blocker': reportBlocker,
  'game-video:focus-page': focusPage,
  'game-video:inspect-project': inspectProject,
  'game-video:preflight-activity': preflightActivity,
  'game-video:list-ui-components': listUiComponents,
  'game-video:validate-project': validateProject,
  'game-video:simulate-pass-a': simulatePassA,
  'game-video:get-node-production-context': getNodeProductionContext,
  'game-video:list-videos': listVideos,
  'game-video:generate-shot-script': generateShotScript,
  'game-video:generate-keyframe': generateKeyframe,
  'game-video:generate-video': generateVideo,
  'game-video:generate-video-clip': generateVideoClip,
  'game-video:list-video-visual-styles': listVideoVisualStyles,
  'game-video:generate-node-video': generateNodeVideo,
  'game-video:list-assets': listAssets,
  'game-video:get-asset': getAsset,
  'game-video:import-character-refs': importCharacterRefs,
  'game-video:import-scene-refs': importSceneRefs,
  'game-video:upsert-document': upsertDocument,
  'game-video:upsert-component': upsertComponent,
}

export const tools: Record<string, ExtensionToolHandler> = Object.fromEntries(
  Object.entries(rawTools).map(([id, handler]) => [id, exposeWorkflowErrors(handler)]),
)

export default tools
