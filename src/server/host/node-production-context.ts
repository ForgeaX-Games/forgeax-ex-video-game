import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createHostAssetRegistry } from '../asset-registry'
import { resolveNodeVideoPreset, validateNodeVideoGenerationPreset } from '@/runtime/core/schema/node-video-preset'
import { inspectProject } from './project-inspection'
import { isCurrentCharacterPreview } from '../generation/character-previews'
import { isCurrentScenePreview } from '../generation/scene-previews'

export async function getNodeProductionContext(
  context: ExtensionContext,
  input: { blueprintId: string; nodeId: string },
): Promise<Record<string, unknown>> {
  const inspected = await inspectProject(context)
  const project = inspected.project
  if (!project) throw new Error('blueprint.json is missing or invalid')
  const { characters, scenes: sceneEntities } = inspected.assetEntities
  const blueprint = project.manifest.packs[input.blueprintId]
  if (!blueprint) throw new Error(`Unknown blueprint: ${input.blueprintId}`)
  const node = blueprint.graph.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node) throw new Error(`Unknown node: ${input.nodeId}`)
  const media = node.data.media
  const resolved = resolveNodeVideoPreset(media)
  const cast = (node.data.cast ?? []).map((binding) => {
    const character = characters[binding.characterId]
    return {
      ...binding,
      character: character ?? null,
      entity: character?.entityId ? project.entities?.[character.entityId] ?? null : null,
    }
  })
  // 场景与角色对称：节点声明引用哪些场景，场景图和角色图一样要作为
  // 视频生成的参考图被消费——否则场景线只是产出了没人用的图。
  const scenes = (node.data.scenes ?? []).map((binding) => ({
    ...binding,
    scene: sceneEntities[binding.sceneId] ?? null,
  }))
  const referencedAssetIds = new Set<string>()
  cast.forEach((item) => {
    if (item.character?.currentAssetId) referencedAssetIds.add(item.character.currentAssetId)
  })
  scenes.forEach((item) => {
    if (item.useAsVideoReference === false) return
    if (item.scene?.currentAssetId) referencedAssetIds.add(item.scene.currentAssetId)
  })
  const refs = resolved?.preset.references
  refs?.sceneAssetIds?.forEach((id) => referencedAssetIds.add(id))
  refs?.extraImageAssetIds?.forEach((id) => referencedAssetIds.add(id))
  if (refs?.firstFrameAssetId) referencedAssetIds.add(refs.firstFrameAssetId)
  if (refs?.lastFrameAssetId) referencedAssetIds.add(refs.lastFrameAssetId)
  const assets = await createHostAssetRegistry(context).list().catch(() => [])
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const isSupersededSemanticReference = (assetId: string): boolean => {
    const asset = assetsById.get(assetId)
    const characterPreview = asset?.meta?.characterPreview as Record<string, unknown> | undefined
    const characterId = typeof characterPreview?.characterId === 'string' ? characterPreview.characterId : undefined
    if (characterId) {
      const currentAssetId = characters[characterId]?.currentAssetId
      return Boolean(currentAssetId && currentAssetId !== assetId)
    }
    const scenePreview = asset?.meta?.scenePreview as Record<string, unknown> | undefined
    const sceneId = typeof scenePreview?.sceneId === 'string' ? scenePreview.sceneId : undefined
    if (sceneId) {
      const currentAssetId = sceneEntities[sceneId]?.currentAssetId
      return Boolean(currentAssetId && currentAssetId !== assetId)
    }
    return false
  }
  const currentRef = media?.kind === 'video' ? media.ref?.trim() : undefined
  const currentAsset = currentRef ? assetsById.get(currentRef) : undefined
  const bindingState = !currentRef
    ? 'unconfigured'
    : !currentAsset
      ? 'missing'
      : currentAsset.kind !== 'video' || currentAsset.productionType !== 'video_clip'
        ? 'invalid'
        : currentAsset.status === 'ready'
          ? 'ready'
          : currentAsset.status === 'failed'
            ? 'failed'
            : 'processing'
  const assetRefs = [...referencedAssetIds]
    .filter((id) => !isSupersededSemanticReference(id))
    .map((id) => ({ id, asset: assetsById.get(id) ?? null }))
  const resourceIdFor = (assetId: string | undefined): string | undefined => {
    if (!assetId) return undefined
    const asset = assetsById.get(assetId)
    const mapped = asset?.meta?.kinoResourceId
    const resourceId = asset?.provider?.kind === 'kino'
      ? asset.provider.upstreamResourceId?.trim()
      : typeof mapped === 'string' ? mapped.trim() : undefined
    return asset?.status === 'ready' && resourceId ? resourceId : undefined
  }
  const prompt = media?.kind === 'video' && media.prompt?.trim()
    ? media.prompt.trim()
    : (node.data.chapterSummary?.trim() || node.data.name || '')
  const readinessIssues: string[] = []
  if (!prompt) readinessIssues.push('media.prompt is missing')
  // Submission readiness only covers fields consumed by Kino. Blueprint authoring
  // completeness (chapterSummary/storyText and an explicitly authored generation
  // block) remains enforced by project inspection. Legacy video nodes already
  // resolve to a labelled default draft, so validate that resolved submission
  // preset instead of rejecting it again for lacking the original block.
  if (resolved) {
    readinessIssues.push(...validateNodeVideoGenerationPreset(
      resolved.source === 'authored' ? media?.generation : resolved.preset,
    ))
  }
  assetRefs.filter((item) => item.asset === null).forEach((item) => readinessIssues.push(`asset ${item.id} is missing`))
  cast.forEach((item) => {
    if (item.onScreen === false || !item.character) return
    const previewId = item.character.currentAssetId
    const preview = previewId ? assetsById.get(previewId) : undefined
    if (!isCurrentCharacterPreview(
      preview,
      item.character.appearance.previewPrompt,
      item.character.appearance.description,
    )) {
      readinessIssues.push(`character ${item.character.id} preview is missing or stale`)
    }
  })
  scenes.forEach((item) => {
    if (item.useAsVideoReference === false) return
    if (!item.scene) {
      readinessIssues.push(`scene ${item.sceneId} is declared on the node but missing from the catalog`)
      return
    }
    const previewId = item.scene.currentAssetId
    const preview = previewId ? assetsById.get(previewId) : undefined
    if (!isCurrentScenePreview(preview, item.scene.visual.previewPrompt, item.scene.visual.description)) {
      readinessIssues.push(`scene ${item.scene.id} preview is missing or stale`)
    }
  })
  assetRefs.forEach((item) => {
    if (item.asset && !resourceIdFor(item.id)) {
      readinessIssues.push(`asset ${item.id} has no ready Kino resource id`)
    }
  })
  const referenceAssetIds = [
    ...cast.flatMap((item) => item.onScreen === false ? [] : [item.character?.currentAssetId]),
    ...scenes.flatMap((item) => (
      item.useAsVideoReference === false ? [] : [item.scene?.currentAssetId]
    )),
    ...(refs?.sceneAssetIds ?? []),
    ...(refs?.extraImageAssetIds ?? []),
  ].filter((id): id is string => Boolean(id))
    .filter((id) => !isSupersededSemanticReference(id))
  const referenceImageResourceIds = [...new Set(referenceAssetIds.flatMap((id) => {
    const resourceId = resourceIdFor(id)
    return resourceId ? [resourceId] : []
  }))]
  const firstFrameResourceId = resourceIdFor(refs?.firstFrameAssetId)
  const lastFrameResourceId = resourceIdFor(refs?.lastFrameAssetId)
  const submission = (resolved || prompt) ? {
    prompt,
    ...(resolved?.preset ?? {
      schemaVersion: 1 as const,
      durationSeconds: 8,
      generateAudio: false,
      mode: (referenceImageResourceIds.length > 0 ? 'ref' : 't2v') as 'ref' | 't2v',
      size: '2560x1440' as const,
      resolution: '720p' as const,
    }),
    mode: referenceImageResourceIds.length > 0 ? 'ref' : (resolved?.preset.mode ?? 't2v'),
    ...(referenceImageResourceIds.length > 0 ? { referenceImageResourceIds } : {}),
    ...(firstFrameResourceId ? { firstFrameResourceId } : {}),
    ...(lastFrameResourceId ? { lastFrameResourceId } : {}),
  } : null
  if (submission?.mode === 'ref' && !submission.referenceImageResourceIds?.length) {
    readinessIssues.push('reference-video mode requires at least one ready reference image')
  }
  if (submission?.mode === 'firstref' && !submission.firstFrameResourceId) {
    readinessIssues.push('first-reference mode requires a ready first frame')
  }
  if (submission?.mode === 'strict' && (!submission.firstFrameResourceId || !submission.lastFrameResourceId)) {
    readinessIssues.push('strict mode requires ready first and last frames')
  }
  return {
    schemaVersion: 1,
    nodeRef: { blueprintId: input.blueprintId, nodeId: input.nodeId },
    projectRevision: inspected.projectRevision,
    blueprint: { id: input.blueprintId, title: blueprint.title, entry: blueprint.entry },
    node: {
      id: node.id,
      name: node.data.name,
      chapterSummary: node.data.chapterSummary ?? '',
      storyText: node.data.storyText ?? '',
      // 玩法契约：整装照它挂元件、接结算、连出口，所以必须在节点上下文里可见。
      interaction: node.data.interaction ?? null,
      cast,
      scenes,
    },
    rulesSnapshot: {
      entities: project.entities ?? {},
      variables: project.variables ?? {},
      formulas: project.formulas ?? {},
    },
    video: {
      prompt: prompt || undefined,
      currentRef,
      binding: {
        state: bindingState,
        bound: Boolean(currentRef),
        ready: bindingState === 'ready',
        ...(currentRef ? { assetId: currentRef } : {}),
        ...(currentAsset ? {
          assetStatus: currentAsset.status,
          source: currentAsset.provenance?.origin ?? 'unknown',
        } : {}),
      },
      generationPreset: resolved?.preset ?? null,
      presetSource: resolved?.source ?? (prompt ? 'inferred' : null),
      assetRefs,
      submission,
    },
    readiness: { readyToSubmit: readinessIssues.length === 0, issues: readinessIssues },
  }
}

export async function bindNodeKinoReferences(
  context: ExtensionContext,
  input: {
    blueprintId: string
    nodeId: string
    assetMappings: readonly { assetId: string; resourceId: string }[]
  },
): Promise<{ mapped: string[] }> {
  const registry = createHostAssetRegistry(context)
  const productionContext = await getNodeProductionContext(context, {
    blueprintId: input.blueprintId,
    nodeId: input.nodeId,
  }) as {
    video: { assetRefs: Array<{ id: string }> }
  }
  const allowedAssetIds = new Set(productionContext.video.assetRefs.map((item) => item.id))
  const mapped: string[] = []
  for (const item of input.assetMappings) {
    const assetId = item.assetId.trim()
    const resourceId = item.resourceId.trim()
    if (!assetId || !resourceId) throw new TypeError('assetId and resourceId are required')
    if (!allowedAssetIds.has(assetId)) {
      throw new TypeError(`Asset is not referenced by the selected node: ${assetId}`)
    }
    const asset = await registry.get(assetId)
    if (!asset || asset.kind !== 'image' || asset.status !== 'ready') {
      throw new TypeError(`Asset is not a ready image: ${assetId}`)
    }
    const existing = asset.meta?.kinoResourceId
    if (typeof existing === 'string' && existing !== resourceId) {
      throw new TypeError(`Asset already maps to a different Kino resource: ${assetId}`)
    }
    await registry.update(assetId, {
      meta: { ...(asset.meta ?? {}), kinoResourceId: resourceId },
    })
    mapped.push(assetId)
  }
  return { mapped }
}
