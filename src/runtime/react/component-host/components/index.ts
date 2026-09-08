import { BattleEnemyHpBar, BattleEnemyHpBarManifest } from './BattleEnemyHpBar'
import { BattlePlayerHpBar, BattlePlayerHpBarManifest } from './BattlePlayerHpBar'
import { BattleSkill, BattleSkillManifest } from './BattleSkill'
import { BattleParry, BattleParryManifest } from './BattleParry'
import { Dialogue, DialogueManifest } from './Dialogue'
import { DamageFloatText, DamageFloatTextManifest } from './DamageFloatText'
import { GainFloatText, GainFloatTextManifest } from './GainFloatText'
import { InkYingMo, InkYingMoManifest } from './InkYingMo'
import { InkKou, InkKouManifest } from './InkKou'
import { StatusNotice, StatusNoticeManifest } from './StatusNotice'
import { TextOption, TextOptionManifest } from './TextOption'

export default [
  { component: BattleEnemyHpBar, manifest: BattleEnemyHpBarManifest },
  { component: BattlePlayerHpBar, manifest: BattlePlayerHpBarManifest },
  { component: BattleSkill, manifest: BattleSkillManifest },
  { component: BattleParry, manifest: BattleParryManifest },
  { component: Dialogue, manifest: DialogueManifest },
  { component: DamageFloatText, manifest: DamageFloatTextManifest },
  { component: GainFloatText, manifest: GainFloatTextManifest },
  { component: InkYingMo, manifest: InkYingMoManifest },
  { component: InkKou, manifest: InkKouManifest },
  { component: StatusNotice, manifest: StatusNoticeManifest },
  { component: TextOption, manifest: TextOptionManifest },
]
