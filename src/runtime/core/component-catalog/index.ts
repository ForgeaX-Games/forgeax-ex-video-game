import { BattleEnemyHpBarManifest } from './BattleEnemyHpBar.manifest'
import { BattlePlayerHpBarManifest } from './BattlePlayerHpBar.manifest'
import { BattleSkillManifest } from './BattleSkill.manifest'
import { BattleParryManifest } from './BattleParry.manifest'
import { DialogueManifest } from './Dialogue.manifest'
import { DamageFloatTextManifest } from './DamageFloatText.manifest'
import { GainFloatTextManifest } from './GainFloatText.manifest'
import { InkYingMoManifest } from './InkYingMo.manifest'
import { InkKouManifest } from './InkKou.manifest'
import { StatusNoticeManifest } from './StatusNotice.manifest'
import { TextOptionManifest } from './TextOption.manifest'
import {
  defaultComponentRegistry,
  type ComponentDef,
  type ComponentRegistry,
} from '../registry/component-registry'

export const localComponentManifests = [
  BattleEnemyHpBarManifest,
  BattlePlayerHpBarManifest,
  BattleSkillManifest,
  BattleParryManifest,
  DialogueManifest,
  DamageFloatTextManifest,
  GainFloatTextManifest,
  InkYingMoManifest,
  InkKouManifest,
  StatusNoticeManifest,
  TextOptionManifest,
] as const

export default localComponentManifests

/** Install manifest-only built-ins without loading React renderers. */
export function installLocalComponentManifests(
  registry: ComponentRegistry = defaultComponentRegistry,
): ComponentRegistry {
  for (const manifest of localComponentManifests) {
    registry.registerComponent(manifest.id, manifest as ComponentDef)
  }
  return registry
}
