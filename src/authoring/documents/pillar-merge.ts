import type { PillarInteractionContract } from './pillar-interaction-contract'

function pick<T>(patch: T | undefined, base: T | undefined): T | undefined {
  if (patch === undefined) return base
  if (Array.isArray(patch) && patch.length === 0) return base
  if (typeof patch === 'string' && !patch.trim()) return base
  return patch
}

function beatOrderKey(id: string): number {
  const match = /^B(\d+)$/u.exec(id)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

/**
 * 按 beat.id 合并。后写入的节拍覆盖同 id；标题、角色、数值表以「有则替换」为准。
 * 节拍顺序跟骨架走（B01…B10），不能用写入先后：过场一批先落盘的话，
 * 分叉会排到数组末尾，编译按「下一拍」接线时永远到不了 B07，prune 会把战斗丢掉。
 */
export function mergePillarContracts(
  base: PillarInteractionContract | null,
  patch: PillarInteractionContract,
): PillarInteractionContract {
  if (!base) {
    return {
      ...patch,
      beats: [...patch.beats].sort((left, right) => beatOrderKey(left.id) - beatOrderKey(right.id)),
    }
  }
  const beatsById = new Map(base.beats.map((entry) => [entry.id, entry]))
  for (const beat of patch.beats) {
    beatsById.set(beat.id, beat)
  }
  return {
    schemaVersion: patch.schemaVersion ?? base.schemaVersion,
    title: pick(patch.title, base.title),
    cast: pick(patch.cast, base.cast),
    settings: pick(patch.settings, base.settings),
    mainLoop: pick(patch.mainLoop, base.mainLoop),
    variables: pick(patch.variables, base.variables),
    entities: pick(patch.entities, base.entities),
    formulas: pick(patch.formulas, base.formulas),
    endings: pick(patch.endings, base.endings),
    beats: [...beatsById.values()].sort((left, right) => beatOrderKey(left.id) - beatOrderKey(right.id)),
  }
}

export function missingBeatIds(
  contract: Pick<PillarInteractionContract, 'beats'>,
  requiredIds: readonly string[],
): string[] {
  const have = new Set(contract.beats.map((beat) => beat.id))
  return requiredIds.filter((id) => !have.has(id))
}
