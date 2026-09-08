/**
 * 公式定义是编辑器作者态；运行时执行已编译的表达式字符串，也支持显式的
 * `formula.<id>` 引用读取保留下来的 AST。
 *
 * 公式定义 SSOT = 一棵**表达式 AST**（`Formula.ast`），与运行时 `runtime/engine/expr.ts` 的
 * `Node` 文法对齐（num/ref/unary/bin/call）+ 编辑器专属的 `hole`（留空位）节点。正向经
 * `serializeExpr` 出串、反向经 `parseExpr`（→ `liftExprToFormulaAst`）从任意 expr 串还原可编辑树。
 *
 * 公式引用仍以内嵌 `pick` 形式贴在数值字段旁，便于在任意图结构里跟随复制/删除；
 * 该结构是编辑器私有的扩展形状，runtime 不声明也不读取它。
 */
import type { Entity, GameScenario, UiTree, ValueTerm, Variable } from '@/runtime/core/schema/graph-schema'
import { parseExpr, serializeExpr, type Node as RuntimeExprNode } from '@/runtime/core/engine/expr'
import { checkFormulaCall, type FormulaCallIssue } from '@/runtime/core/engine/formula-registry'

export type EditorValueTerm = ValueTerm & { id?: string }

// ── 公式 AST（编辑器态；expr.ts Node 的超集：加稳定 id + hole）──────────────────
export type FormulaHoleKind = 'entityAttr' | 'number' | 'var'

/** 具体引用：实体属性 / 变量 / 局面分。 */
export type FormulaRef =
  | { kind: 'entityAttr'; entityId: string; attr: string }
  | { kind: 'var'; varId: string }
  | { kind: 'score' }

export type FormulaAstNode =
  | { t: 'num'; id: string; v: number }
  | { t: 'ref'; id: string; ref: FormulaRef }
  | { t: 'unary'; id: string; op: '-' | '!'; x: FormulaAstNode }
  | { t: 'bin'; id: string; op: string; a: FormulaAstNode; b: FormulaAstNode }
  | { t: 'call'; id: string; name: string; args: FormulaAstNode[] }
  /** 留空位：应用公式时按 holeId 绑定具体值（实体属性 / 数值 / 变量）。 */
  | { t: 'hole'; id: string; holeId: string; kind: FormulaHoleKind; label?: string; suggestAttr?: string }

export interface FormulaParseFailureSnapshot {
  readonly kind: 'game-video.formula-parse-failure.v1'
  readonly invalidDraft: string
  readonly parserDiagnostic: string
}

export interface Formula {
  id: string
  name?: string
  description?: string
  ast: FormulaAstNode
  /** 新建但尚未填写表达式；底层保留占位 AST，编辑器显示为空。 */
  draftEmpty?: boolean
}

/** 按 kind 区分的留空位绑定；应用公式时每个 holeId 填一份。 */
export type FormulaHoleBinding =
  | { kind: 'entityAttr'; entityId: string; attr?: string }
  | { kind: 'number'; value: number }
  | { kind: 'var'; varId: string }

export interface FormulaPick {
  mode: 'formula'
  formulaId: string
  holeBindings: Record<string, FormulaHoleBinding>
}

/** 存储/草稿文档：公式与 entities / variables 同级；运行时 `GameScenario` 不声明它。 */
export interface EditorScenarioDocument extends Omit<GameScenario, 'formulas'> {
  formulas?: Record<string, Formula>
  uiTree?: UiTree
}

// ── id 分配（React key + 空位寻址；同一棵树内唯一即可）────────────────────────────
export function makeIdAlloc(prefix = 'n'): () => string {
  let i = 0
  return () => `${prefix}${i++}`
}

// ── 反向：expr 串 / 运行时 Node → 编辑器 AST（全具体、无 hole）──────────────────────
function liftRef(path: string[]): FormulaRef {
  const [head, ...rest] = path
  if (head === 'score') return { kind: 'score' }
  if (head === 'var') return { kind: 'var', varId: rest.join('.') }
  if (head === 'entity' && rest[1] === 'attr') {
    return { kind: 'entityAttr', entityId: rest[0] ?? '', attr: rest[2] ?? '' }
  }
  // 兜底：未知形状按变量名塞入（保留原文，serialize 时原样吐回）。
  return { kind: 'var', varId: path.join('.') }
}

export function liftExprToFormulaAst(
  node: RuntimeExprNode,
  nextId: () => string = makeIdAlloc(),
  holeNames?: Map<string, string>,
): FormulaAstNode {
  switch (node.t) {
    case 'num':
      return { t: 'num', id: nextId(), v: node.v }
    case 'ref': {
      // 文本编辑回解：`__hole__.<序号>` ref（parseFormulaText 预扫描产物）→ hole 节点，按映射还原原名。
      if (holeNames && node.path[0] === HOLE_REF_HEAD && node.path.length >= 2) {
        const name = holeNames.get(node.path.slice(1).join('.')) ?? node.path.slice(1).join('.')
        return { t: 'hole', id: nextId(), holeId: name, kind: 'number', label: name }
      }
      return { t: 'ref', id: nextId(), ref: liftRef(node.path) }
    }
    case 'unary':
      return { t: 'unary', id: nextId(), op: node.op, x: liftExprToFormulaAst(node.x, nextId, holeNames) }
    case 'bin':
      return { t: 'bin', id: nextId(), op: node.op, a: liftExprToFormulaAst(node.a, nextId, holeNames), b: liftExprToFormulaAst(node.b, nextId, holeNames) }
    case 'call':
      return { t: 'call', id: nextId(), name: node.name, args: node.args.map((a) => liftExprToFormulaAst(a, nextId, holeNames)) }
  }
}

/** 反向解析入口：任意 expr 串 → 可编辑 AST。解析失败抛 ExprError（调用方捕获提示）。 */
export function parseExprToFormulaAst(src: string): FormulaAstNode {
  return liftExprToFormulaAst(parseExpr(src))
}

/**
 * 遍历 AST 校验全部函数调用。
 *
 * 语法归 parser，函数合法性归这里：这样错误码稳定，parser 仍能被编辑器草稿复用，
 * 而未知函数不会一路落盘到运行时才炸。
 */
export function validateFormulaCalls(node: FormulaAstNode): FormulaCallIssue[] {
  const issues: FormulaCallIssue[] = []
  const walk = (current: FormulaAstNode): void => {
    switch (current.t) {
      case 'call': {
        const issue = checkFormulaCall(current.name, current.args.length)
        if (issue) issues.push(issue)
        current.args.forEach(walk)
        break
      }
      case 'unary':
        walk(current.x)
        break
      case 'bin':
        walk(current.a)
        walk(current.b)
        break
      default:
        break
    }
  }
  walk(node)
  return issues
}

// ── 含 hole 的文本 ↔ AST（编辑器专属；runtime expr.ts 不认 hole，故 hole 语法只活在这一层）──
/**
 * hole 文本语法 = `?名字`（名字可含中文/字母/数字/下划线）。同名多次出现 = 同一个 holeId
 * （应用时只填一次）。`?` 不是 runtime expr.ts 的 token，且其 tokenizer 只认 ASCII 标识符——
 * 故预扫描时把每个唯一 `?名字` 编码成纯 ASCII 占位 ref（`__hole__.<序号>`）交 parseExpr，
 * 同时记 序号→原名 映射，parse 后在 lift 里据映射还原成带原名的 hole 节点。
 */
const HOLE_TEXT_RE = /\?([\p{L}_][\p{L}\p{N}_]*)/gu
const HOLE_REF_HEAD = '__hole__'

export interface FormulaTextCatalog {
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
}

const FULL_WIDTH_FORMULA_CHARS: Record<string, string> = {
  '（': '(',
  '）': ')',
  '，': ',',
  '＋': '+',
  '－': '-',
  '−': '-',
  '＊': '*',
  '×': '*',
  '／': '/',
  '÷': '/',
  '．': '.',
}

function catalogReferenceTokens(catalog: FormulaTextCatalog | undefined): string[] {
  const refs = new Set<string>(['score'])
  for (const [key, entity] of Object.entries(catalog?.entities ?? {})) {
    const ids = new Set([key, entity.id].filter(Boolean))
    const attrs = new Set([
      ...Object.keys(entity.attrs ?? {}),
      ...Object.keys(entity.attrMeta ?? {}),
    ])
    for (const entityId of ids) {
      for (const attr of attrs) refs.add(`entity.${entityId}.attr.${attr}`)
    }
  }
  for (const [key, variable] of Object.entries(catalog?.variables ?? {})) {
    refs.add(`var.${variable.id || key}`)
    refs.add(`var.${key}`)
  }
  return [...refs].sort((a, b) => b.length - a.length)
}

/**
 * 作者输入归一：
 * - 常见全角数学标点转成运行时 ASCII 语法；
 * - 有实体/变量目录时按最长合法引用匹配，引用后的紧邻 `-` 明确解释为减法。
 * 这样 `entity.ent-player.attr.attack-power` 保持完整，而
 * `entity.ent-player.attr.attack-entity.ent-boss.attr.defense` 可无空格解析。
 */
export function normalizeFormulaTextInput(
  src: string,
  catalog?: FormulaTextCatalog,
): string {
  const punctuationNormalized = src.normalize('NFKC').replace(
    /[（），＋－−＊×／÷．]/g,
    (char) => FULL_WIDTH_FORMULA_CHARS[char] ?? char,
  )
  const whitespaceNormalized = punctuationNormalized.replace(/\s+/gu, ' ')
  const refs = catalogReferenceTokens(catalog)
  if (refs.length === 0) return whitespaceNormalized

  let out = ''
  let index = 0
  while (index < whitespaceNormalized.length) {
    const previous = index > 0 ? whitespaceNormalized[index - 1]! : ''
    const boundary = !previous || !/[A-Za-z0-9_.-]/.test(previous)
    const ref = boundary
      ? refs.find((candidate) => whitespaceNormalized.startsWith(candidate, index))
      : undefined
    if (!ref) {
      out += whitespaceNormalized[index]!
      index += 1
      continue
    }
    out += ref
    index += ref.length
    if (whitespaceNormalized[index] === '-' && index + 1 < whitespaceNormalized.length) {
      out += ' - '
      index += 1
    }
  }
  return out
}

/** 含 hole 的文本 → AST（供公式文本编辑器）。解析失败抛 ExprError。 */
export function parseFormulaText(src: string, nextId: () => string = makeIdAlloc()): FormulaAstNode {
  const normalized = normalizeFormulaTextInput(src)
  // 唯一 hole 名 → ASCII 序号占位（避免中文名进 runtime tokenizer 被拒）。
  const nameToIdx = new Map<string, number>()
  const idxToName = new Map<string, string>()
  const substituted = normalized.replace(HOLE_TEXT_RE, (_m, name: string) => {
    let idx = nameToIdx.get(name)
    if (idx == null) {
      idx = nameToIdx.size
      nameToIdx.set(name, idx)
      idxToName.set(String(idx), name)
    }
    return `${HOLE_REF_HEAD}.${idx}`
  })
  return liftExprToFormulaAst(parseExpr(substituted), nextId, idxToName)
}

/** 规则页与交互创建区共用的作者输入入口：按当前目录消除宽度、空白与短横线歧义后解析。 */
export function parseFormulaAuthoringText(
  src: string,
  catalog?: FormulaTextCatalog,
  nextId: () => string = makeIdAlloc(),
): FormulaAstNode {
  return parseFormulaText(normalizeFormulaTextInput(src, catalog), nextId)
}

// ── 正向：编辑器 AST → 运行时 Node（代入 holeBindings）→ serializeExpr ─────────────
function refToPath(ref: FormulaRef): string[] {
  if (ref.kind === 'score') return ['score']
  if (ref.kind === 'var') return ['var', ref.varId]
  return ['entity', ref.entityId, 'attr', ref.attr]
}

/** 空位占位串：`?名字`——既是只读预览展示，也是文本编辑时的可回解语法（parseFormulaText 认它）。 */
function holePlaceholder(node: Extract<FormulaAstNode, { t: 'hole' }>): string {
  return `?${node.label ?? node.holeId}`
}

function holeToNode(
  node: Extract<FormulaAstNode, { t: 'hole' }>,
  binding: FormulaHoleBinding | undefined,
  placeholder: boolean,
): RuntimeExprNode | null {
  if (!binding) {
    // 未填：预览模式吐 `?名字` 占位 ref（serializeExpr 原样打印 token）；编译模式返回 null。
    return placeholder ? { t: 'ref', path: [holePlaceholder(node)] } : null
  }
  if (binding.kind === 'number') return { t: 'num', v: binding.value }
  if (binding.kind === 'var') {
    if (!binding.varId) return placeholder ? { t: 'ref', path: [holePlaceholder(node)] } : null
    return { t: 'ref', path: ['var', binding.varId] }
  }
  // entityAttr
  if (!binding.entityId) return placeholder ? { t: 'ref', path: [holePlaceholder(node)] } : null
  const attr = binding.attr || node.suggestAttr
  if (!attr) return placeholder ? { t: 'ref', path: [`entity.${binding.entityId}.attr.?`] } : null
  return { t: 'ref', path: ['entity', binding.entityId, 'attr', attr] }
}

/**
 * 编辑器 AST → 运行时 Node。`placeholder=false`（编译）：遇未填空位返回 null（整体不完整）；
 * `placeholder=true`（预览）：未填空位渲染成占位 token，永不返回 null。
 */
export function lowerFormulaAst(
  node: FormulaAstNode,
  bindings: Record<string, FormulaHoleBinding>,
  placeholder = false,
): RuntimeExprNode | null {
  switch (node.t) {
    case 'num':
      return { t: 'num', v: node.v }
    case 'ref':
      return { t: 'ref', path: refToPath(node.ref) }
    case 'unary': {
      const x = lowerFormulaAst(node.x, bindings, placeholder)
      return x ? { t: 'unary', op: node.op, x } : null
    }
    case 'bin': {
      const a = lowerFormulaAst(node.a, bindings, placeholder)
      const b = lowerFormulaAst(node.b, bindings, placeholder)
      return a && b ? { t: 'bin', op: node.op, a, b } : null
    }
    case 'call': {
      const args = node.args.map((a) => lowerFormulaAst(a, bindings, placeholder))
      return args.every((a): a is RuntimeExprNode => a != null) ? { t: 'call', name: node.name, args } : null
    }
    case 'hole':
      return holeToNode(node, bindings[node.holeId], placeholder)
  }
}

/** 编译：AST + 绑定 → expr 串；有未填空位返回 null（走 serializeExpr，与运行时同一序列化）。 */
export function serializeFormula(node: FormulaAstNode, bindings: Record<string, FormulaHoleBinding>): string | null {
  const lowered = lowerFormulaAst(node, bindings, false)
  return lowered ? serializeExpr(lowered) : null
}

/** 预览：AST → 带 ❓占位的展示串（未填空位不阻断，仅供只读展示）。 */
export function previewFormula(node: FormulaAstNode, bindings: Record<string, FormulaHoleBinding> = {}): string {
  const lowered = lowerFormulaAst(node, bindings, true)
  return lowered ? serializeExpr(lowered) : '0'
}

// ── 旧模型读时适配：线性 ±×÷ 条款链（EditorValueTerm[]）→ AST ────────────────────
function legacyAtom(t: EditorValueTerm, index: number, nextId: () => string): FormulaAstNode {
  if (t.source === 'const') return { t: 'num', id: nextId(), v: t.constValue ?? 0 }
  if (t.source === 'var') return { t: 'ref', id: nextId(), ref: { kind: 'var', varId: t.refId } }
  // entity：refId 空 = 旧「未填实体」留空位 → hole。
  if (!t.refId) {
    return { t: 'hole', id: nextId(), holeId: t.id ?? `t${index}`, kind: 'entityAttr', suggestAttr: t.attr }
  }
  return { t: 'ref', id: nextId(), ref: { kind: 'entityAttr', entityId: t.refId, attr: t.attr || 'hp' } }
}

/** 首项无左操作数：+/× → 原值；− → 取反；÷ → 取倒数（与旧 compileValuePick 的 leadTerm 同语义）。 */
function legacyLead(t: EditorValueTerm, index: number, nextId: () => string): FormulaAstNode {
  const atom = legacyAtom(t, index, nextId)
  const op = t.op
  if (op === '-') return { t: 'unary', id: nextId(), op: '-', x: atom }
  if (op === '/') return { t: 'bin', id: nextId(), op: '/', a: { t: 'num', id: nextId(), v: 1 }, b: atom }
  return atom
}

export function legacyTermsToAst(terms: EditorValueTerm[], nextId: () => string = makeIdAlloc()): FormulaAstNode {
  // 保留 hole 项（未填实体）；丢弃彻底空的非 hole 项（无 refId 的 var 等）。
  const usable = terms.filter((t) => t.source === 'const' || (t.source === 'entity') || (t.source === 'var' && !!t.refId))
  if (usable.length === 0) return { t: 'num', id: nextId(), v: 0 }
  let acc = legacyLead(usable[0]!, 0, nextId)
  for (let i = 1; i < usable.length; i++) {
    const t = usable[i]!
    const op = t.op === '+' || t.op === '-' || t.op === '*' || t.op === '/' ? t.op : '+'
    acc = { t: 'bin', id: nextId(), op, a: acc, b: legacyAtom(t, i, nextId) }
  }
  return acc
}

export function isFormulaPick(value: unknown): value is FormulaPick {
  if (!value || typeof value !== 'object') return false
  const pick = value as Record<string, unknown>
  return pick.mode === 'formula'
    && typeof pick.formulaId === 'string'
    && !!pick.holeBindings
    && typeof pick.holeBindings === 'object'
}

// ── 存储归一（含旧 terms → ast 迁移 + 旧 holeBindings 归一）──────────────────────
type LegacyFormula = Formula & { terms?: EditorValueTerm[] }

/** 旧 holeBindings 值 `{entityId, attr?}` → typed `{kind:'entityAttr', ...}`。 */
export function normalizeHoleBinding(raw: unknown): FormulaHoleBinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (o.kind === 'number' && typeof o.value === 'number') return { kind: 'number', value: o.value }
  if (o.kind === 'var' && typeof o.varId === 'string') return { kind: 'var', varId: o.varId }
  if (o.kind === 'entityAttr' && typeof o.entityId === 'string') {
    return { kind: 'entityAttr', entityId: o.entityId, attr: typeof o.attr === 'string' ? o.attr : undefined }
  }
  // 旧形状（无 kind，仅 entityId/attr）
  if (typeof o.entityId === 'string') {
    return { kind: 'entityAttr', entityId: o.entityId, attr: typeof o.attr === 'string' ? o.attr : undefined }
  }
  return undefined
}

function migrateFormula(f: LegacyFormula): Formula {
  if (f.ast) {
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      ast: f.ast,
      ...(f.draftEmpty ? { draftEmpty: true } : {}),
    }
  }
  const ast = Array.isArray(f.terms) ? legacyTermsToAst(f.terms) : { t: 'num' as const, id: 'n0', v: 0 }
  return { id: f.id, name: f.name, description: f.description, ast }
}

/** 兼容短暂使用过的 `editor.formulas` 格式 + 旧线性 terms，统一还原为顶层 ast 公式。 */
export function toEditorScenarioDocument(raw: GameScenario | null | undefined): EditorScenarioDocument | null {
  if (!raw) return null
  const legacy = raw as GameScenario & { formulas?: Record<string, LegacyFormula>; editor?: { formulas?: Record<string, LegacyFormula> } }
  const rawFormulas = legacy.formulas ?? legacy.editor?.formulas
  const { formulas: _legacyFormulas, editor, ...scenario } = legacy
  const formulas = rawFormulas
    ? Object.fromEntries(Object.entries(rawFormulas).map(([k, f]) => [k, migrateFormula({ ...f, id: f.id ?? k })]))
    : undefined
  return {
    ...scenario,
    ...(formulas ? { formulas } : {}),
  }
}

/** 执行前递归移除编辑器 UI sidecar，保留 runtime 可解析的公式目录与表达式源码。 */
export function toRuntimeScenario<T extends GameScenario>(scenario: T): GameScenario {
  function strip(value: unknown, root = false): unknown {
    if (Array.isArray(value)) return value.map((item) => strip(item))
    if (!value || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) {
      if (root && key === 'uiTree') continue
      // `pick` 是数值表达式作者态；不按字段名全局删除，避免误伤组件的同名 input。
      if (key === 'pick' && typeof source.expr === 'string') continue
      out[key] = strip(child)
    }
    return out
  }
  return strip(scenario, true) as GameScenario
}
