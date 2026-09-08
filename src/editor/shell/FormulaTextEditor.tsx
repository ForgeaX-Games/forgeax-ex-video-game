import { t as translateUi, tf as formatUi } from '../../i18n'
/**
 * FormulaTextEditor —— Grafana 式公式编辑器（规则 → 公式）。
 *
 * 单一 SSOT 仍是 `Formula.ast`（一棵 FormulaAstNode）。本编辑器用**自由文本**作主输入：
 *  · 文本框直接写 expr 串（`parseFormulaText` 实时校验，支持 `?参数` 留空位语法）；
 *  · 文本框下方一行**结构摘要**：引用了哪些实体/变量、含几个参数、无参数时 `≈ 样例值`
 *    ——不再逐字复述公式串（那与输入框重复）；
 *  · **试算面板**（默认折叠）：含 `?参数` 时给每个参数填样例值，实时算出结果，让用户直观看懂产出；
 *  · 插入工具条：往光标处插入 实体属性 / 变量 / 函数 / ?参数（复用编辑器通用下拉）。
 *
 * 与旧 FormulaAstEditor 的可编辑节点嵌套树不同——文本 ↔ AST 双向经 formula-authoring 的
 * parseFormulaText / previewFormula，runtime expr.ts 不认 hole，故 hole 语法只活在编辑器层。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { isNumericScalar, type Entity, type Variable } from '@/runtime/core/schema/graph-schema'
import { tryEvalExpr, type EvalCtx } from '@/runtime/core/engine/expr'
import { createRng } from '@/runtime/core/engine/rng'
import type { FormulaAstNode, FormulaHoleBinding, FormulaParseFailureSnapshot } from '@/authoring/blueprint/formula-authoring'
import {
  parseFormulaAuthoringText,
  previewFormula,
  serializeFormula,
} from '@/authoring/blueprint/formula-authoring'
import { formulaHoles, type FormulaHole } from '@/authoring/formulas/formula-apply'
import { CascadingPicker, type CascadingPickerOpenChangeDetail, type CascadingPickerOption } from './CascadingPicker'
import { SelectDropdown } from './SelectDropdown'
import formulaToolbarAddIcon from '../ui-assets/formula-toolbar-add.svg'
import ruleChevronRightIcon from '../ui-assets/rule-chevron-right.png'
import { findEntity, listAttrOptions, listEntityOptions, listVarOptions, nextCatalogId, catalogIdOccupied, type EntityAttributeCreateRequest, type EntityCreateRequest, type VariableCreateRequest } from '@/authoring/formulas/meta-catalog'
import { LooseNumberInput } from './TermChainEditor'
import type { EntityAttributeCreateHandler, EntityCreateHandler, VariableCreateHandler } from './component-form-fields'

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }
const FORMULA_EXAMPLE = 'max(?攻击力 * ?技能倍率 - ?防御力, 0)'
// expr.ts eval 支持的函数名（插入用）。
const FUNCTIONS = ['floor', 'round', 'abs', 'min', 'max', 'chance', 'rand', 'randInt']
const FUNCTION_OPTIONS = FUNCTIONS.map((fn) => ({ value: fn, label: `${fn}()` }))
// 函数名按长度降序，避免 `rand` 截断 `randInt`；后跟 `(` 才算函数调用 tag。
const FN_NAMES = [...FUNCTIONS].sort((a, b) => b.length - a.length).join('|')
const refTokenStyle: CSSProperties = {
  color: '#78b9d6',
  background: 'rgba(91,153,181,.12)',
  borderRadius: 6,
  boxShadow: 'inset 0 0 0 1px rgba(91,153,181,.28)',
}

/** 样例求值上下文：实体 attrs 原样、变量取 initial；每次试算另建 seed 0 RNG。 */
function sampleCtx(entities?: Record<string, Entity>, variables?: Record<string, Variable>): EvalCtx {
  const ents: EvalCtx['entities'] = {}
  for (const [id, e] of Object.entries(entities ?? {})) {
    ents[id] = { attrs: Object.fromEntries(
      Object.entries(e.attrs ?? {}).filter(([, value]) => isNumericScalar(value)),
    ) as Record<string, number> }
  }
  const vars: Record<string, number> = {}
  for (const [id, v] of Object.entries(variables ?? {})) {
    if (isNumericScalar(v.initial)) vars[id] = v.initial
  }
  return { entities: ents, vars, flags: {}, score: 0 }
}

/** 一条公式引用了哪些实体 / 变量（去重、按出现顺序）——供结构摘要展示。 */
function collectRefs(ast: FormulaAstNode): { entities: Set<string>; vars: Set<string>; usesScore: boolean } {
  const entities = new Set<string>()
  const vars = new Set<string>()
  let usesScore = false
  const walk = (n: FormulaAstNode): void => {
    switch (n.t) {
      case 'ref':
        if (n.ref.kind === 'entityAttr' && n.ref.entityId) entities.add(n.ref.entityId)
        else if (n.ref.kind === 'var' && n.ref.varId) vars.add(n.ref.varId)
        else if (n.ref.kind === 'score') usesScore = true
        break
      case 'unary':
        walk(n.x)
        break
      case 'bin':
        walk(n.a)
        walk(n.b)
        break
      case 'call':
        n.args.forEach(walk)
        break
      default:
        break
    }
  }
  walk(ast)
  return { entities, vars, usesScore }
}

/** 实体/变量 id → 显示名（有 name 用 name，否则回退 id）。 */
function entName(id: string, entities?: Record<string, Entity>): string {
  return entities?.[id]?.name || id
}
function varName(id: string, variables?: Record<string, Variable>): string {
  return variables?.[id]?.name || id
}

/** 把参数和状态引用渲染成不同 token，短横线因此明确属于整段引用。 */
export function FormulaSyntax({ text, tagged = false }: { text: string; tagged?: boolean }): JSX.Element {
  return <>{parseFormulaSyntax(text, 0, tagged)}</>
}

// 非 token 字符（用于切分）：函数名后跟 ( 才算函数调用；?参数 / entity.x.attr.y / var.x 是独立 token。
const FN_CALL_RE = new RegExp(`(?:${FN_NAMES})(?=\\()`, 'u')
const NON_FN_TOKEN_RE = /\?[\p{L}_][\p{L}\p{N}_]*|entity\.[\p{L}\p{N}_-]+\.attr\.[\p{L}\p{N}_-]+|var\.[\p{L}\p{N}_.-]+/u

/**
 * 递归解析公式文本为带 tag 的 JSX：
 *  - 函数调用 `fn(...)` 整段（含括号及内部内容）包一个函数 tag，背景按嵌套深度递减
 *    （外层 rgba(255,255,255,.18)，每往内一层透明度减半）；
 *  - 括号内的 ?参数 / entity.x.attr.y / var.x 仍单独成 tag，叠在函数 tag 背景上；
 *  - 平衡括号匹配，支持嵌套 max(floor(?x), 1)。
 *
 * `tagged=false`（默认）只输出纯文本（无彩色 tag），用于「简化公式」展示；
 * `tagged=true` 恢复彩色 tag（函数/引用/空位三种 badge），需要高亮时再打开。
 */
function parseFormulaSyntax(text: string, depth: number, tagged = false): JSX.Element[] {
  const parts: JSX.Element[] = []
  let cursor = 0
  let key = 0
  while (cursor < text.length) {
    const rest = text.slice(cursor)
    // 优先匹配函数调用 fn( ... )
    const fnMatch = rest.match(FN_CALL_RE)
    const fnIndex = fnMatch?.index ?? -1
    const tokMatch = rest.match(NON_FN_TOKEN_RE)
    const tokIndex = tokMatch?.index ?? -1
    // 取更靠前的匹配；同位置时函数优先（函数名不会与 ?/entity./var. 重叠）。
    const useFn = fnIndex !== -1 && (tokIndex === -1 || fnIndex <= tokIndex)
    if (useFn && fnIndex !== -1) {
      const fnName = fnMatch![0]
      const nameStart = cursor + fnIndex
      // fnIndex 处是函数名，其后紧跟 '('
      const openParen = nameStart + fnName.length
      if (text[openParen] !== '(') {
        // 不该发生（前瞻已保证），兜底当普通文本
        parts.push(<Fragment key={`t-${key++}`}>{text.slice(cursor, cursor + 1)}</Fragment>)
        cursor += 1
        continue
      }
      // 普通文本前缀
      if (fnIndex > 0) parts.push(<Fragment key={`t-${key++}`}>{text.slice(cursor, nameStart)}</Fragment>)
      // 找平衡闭括号
      const close = findMatchingParen(text, openParen)
      if (close === -1) {
        // 括号不平衡：函数名 + 之后全部当一个 tag（容错）
        parts.push(
          tagged ? (
            <span className="gc-fx-fn-tag" style={fnTagStyle(depth)} key={`fn-${key++}`}>
              {fnName + text.slice(openParen)}
            </span>
          ) : (
            <Fragment key={`t-${key++}`}>{fnName + text.slice(openParen)}</Fragment>
          ),
        )
        break
      }
      const inner = text.slice(openParen + 1, close)
      parts.push(
        tagged ? (
          <span className="gc-fx-fn-tag" style={fnTagStyle(depth)} key={`fn-${key++}`}>
            {fnName}
            <span style={{ color: 'inherit' }}>(</span>
            {inner.length > 0 ? parseFormulaSyntax(inner, depth + 1, true) : null}
            <span style={{ color: 'inherit' }}>)</span>
          </span>
        ) : (
          <Fragment key={`t-${key++}`}>
            {fnName}({inner.length > 0 ? parseFormulaSyntax(inner, depth + 1, false) : null})
          </Fragment>
        ),
      )
      cursor = close + 1
      continue
    }
    if (tokIndex !== -1) {
      const token = tokMatch![0]
      const tokStart = cursor + tokIndex
      if (tokIndex > 0) parts.push(<Fragment key={`t-${key++}`}>{text.slice(cursor, tokStart)}</Fragment>)
      parts.push(
        tagged ? (
          <span
            className={token.startsWith('?') ? 'gc-fx-hole-tag' : 'gc-fx-ref-tag'}
            style={token.startsWith('?') ? undefined : refTokenStyle}
            key={`tok-${key++}`}
          >
            {token}
          </span>
        ) : (
          <Fragment key={`t-${key++}`}>{token}</Fragment>
        ),
      )
      cursor = tokStart + token.length
      continue
    }
    // 无匹配：剩余全部当普通文本
    parts.push(<Fragment key={`t-${key++}`}>{rest}</Fragment>)
    break
  }
  return parts
}

/** 找 openParen 处 '(' 的平衡闭括号索引；不平衡返回 -1。 */
function findMatchingParen(text: string, openParen: number): number {
  let depth = 0
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 函数 tag 背景：外层 rgba(255,255,255,.18)，每往内一层透明度减半递减。 */
function fnTagStyle(depth: number): CSSProperties {
  const alpha = Math.max(0.02, Number((0.18 * Math.pow(0.5, depth)).toFixed(3)))
  return {
    background: `rgba(255,255,255,${alpha})`,
    borderRadius: 6,
  }
}

export function FormulaHelpContent(): JSX.Element {
  return (
    <ul className="sir-formula-help-list">
      <li>
        <strong>{translateUi('ui.copy.83577741d0b6')}</strong>
        <p>{translateUi('ui.copy.66f34e149c9f')}<code>{translateUi('ui.copy.8e9d5daf1c1e')}</code> {translateUi('ui.copy.d204fd7daf20')}</p>
      </li>
      <li>
        <strong>{translateUi('ui.copy.8f1bb68de00c')}</strong>
        <p>{translateUi('ui.copy.a343691b3394')}</p>
      </li>
      <li>
        <strong>{translateUi('ui.copy.eb1e5adecfe6')}</strong>
        <p>{translateUi('ui.copy.022bf3283dd6')}<code>{translateUi('ui.copy.c2f763726cb7')}</code> {translateUi('ui.copy.fcf45e0c6851')}<code>{translateUi('ui.copy.d97baf359248')}</code> {translateUi('ui.copy.def11d6df6c4')}</p>
      </li>
      <li>
        <strong>{translateUi('ui.copy.c8affc50bae1')}</strong>
        <code className="sir-formula-help-example"><FormulaSyntax text={FORMULA_EXAMPLE} /></code>
        <p><strong>{translateUi('ui.copy.5548c547d3ea')}</strong>{translateUi('ui.copy.232a84f05266')}</p>
        <p><strong>{translateUi('ui.copy.69c451651f85')}</strong>{translateUi('ui.copy.3b9b5ee1cc6b')}<code>{translateUi('ui.copy.537df46dc9b0')}</code> {translateUi('ui.copy.9008516abedb')}</p>
      </li>
    </ul>
  )
}

export function FormulaTextEditor({
  ast,
  empty = false,
  entities,
  variables,
  onEmpty,
  onParseFailureChange,
  onChange,
  onCreateEntity,
  onCreateVariable,
  onCreateEntityAttribute,
}: {
  ast: FormulaAstNode
  empty?: boolean
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onEmpty?: () => void
  onParseFailureChange?: (failure: FormulaParseFailureSnapshot | null) => void
  onChange: (ast: FormulaAstNode) => void
  /** 工具条「实体属性」为空时的快捷新建入口（含新建属性）。 */
  onCreateEntity?: EntityCreateHandler
  /** 工具条「变量」为空时的快捷新建入口。 */
  onCreateVariable?: VariableCreateHandler
  /** 新建实体时附带的属性创建。 */
  onCreateEntityAttribute?: EntityAttributeCreateHandler
}): JSX.Element {
  const canonical = empty ? '' : previewFormula(ast)
  const [draft, setDraft] = useState<string | null>(null)
  const [failure, setFailure] = useState<FormulaParseFailureSnapshot | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = useRef<HTMLPreElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const pickerOpenRef = useRef(false)
  const latestTextRef = useRef(canonical)
  const committedTextRef = useRef<string | null>(null)
  const lastSelectionRef = useRef({ start: canonical.length, end: canonical.length })

  const text = draft ?? canonical
  latestTextRef.current = text
  useEffect(() => {
    onParseFailureChange?.(failure)
  }, [failure, onParseFailureChange])
  useEffect(() => () => onParseFailureChange?.(null), [onParseFailureChange])
  const ctx = useMemo(() => sampleCtx(entities, variables), [entities, variables])
  const authoringCatalog = { entities, variables }

  function rememberSelection(input: HTMLTextAreaElement): void {
    lastSelectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    }
  }

  // 结构摘要 / 试算面板都基于「当前文本能否解析成 AST」——解析成功用新 AST，失败沿用旧 AST。
  const liveAst = useMemo<FormulaAstNode | null>(() => {
    const src = text.trim()
    if (!src) return null
    try {
      return parseFormulaAuthoringText(src, authoringCatalog)
    } catch {
      return null
    }
  }, [text, entities, variables])

  const holes = useMemo<FormulaHole[]>(() => (liveAst ? formulaHoles({ id: '', ast: liveAst }) : []), [liveAst])
  const refs = useMemo(() => (liveAst ? collectRefs(liveAst) : null), [liveAst])
  const hasHole = holes.length > 0
  const sampleExpr = liveAst && !hasHole ? serializeFormula(liveAst, {}) : null
  const sampleValue = sampleExpr && !failure
    ? tryEvalExpr(sampleExpr, { ...ctx, rng: createRng(0) })
    : null
  const showSummary = !failure && refs != null && (
    refs.entities.size > 0
    || refs.vars.size > 0
    || (refs.entities.size === 0 && refs.vars.size === 0 && !refs.usesScore && !hasHole)
    || sampleValue != null
  )

  function parseFailure(invalidDraft: string, error: unknown): FormulaParseFailureSnapshot {
    return {
      kind: 'game-video.formula-parse-failure.v1',
      invalidDraft,
      parserDiagnostic: error instanceof Error ? error.message : String(error),
    }
  }

  /** 校验并（成功时）回写 AST。 */
  function commit(next: string): void {
    if (committedTextRef.current === next) return
    committedTextRef.current = next
    const src = next.trim()
    if (!src) {
      if (onEmpty) onEmpty()
      else onChange({ t: 'num', id: 'n0', v: 0 })
      setDraft(null)
      setFailure(null)
      return
    }
    try {
      const nextAst = parseFormulaAuthoringText(src, authoringCatalog)
      setFailure(null)
      onChange(nextAst)
      setDraft(null)
    } catch (error) {
      setFailure(parseFailure(next, error))
    }
  }

  /** 实时校验当前文本（输入 / 插入后调用）。 */
  function revalidate(next: string): void {
    try {
      parseFormulaAuthoringText(next.trim() || '0', authoringCatalog)
      setFailure(null)
    } catch (error) {
      setFailure(parseFailure(next, error))
    }
  }

  /** 往光标处插入片段（无选区时追加到末尾）；插入后聚焦并把光标移到片段末。 */
  function insert(frag: string): void {
    committedTextRef.current = null
    const ta = taRef.current
    const base = draft ?? canonical
    if (!ta) {
      const next = base + frag
      setDraft(next)
      revalidate(next)
      return
    }
    const start = Math.min(lastSelectionRef.current.start, base.length)
    const end = Math.min(Math.max(start, lastSelectionRef.current.end), base.length)
    const next = base.slice(0, start) + frag + base.slice(end)
    const pos = start + frag.length
    lastSelectionRef.current = { start: pos, end: pos }
    setDraft(next)
    revalidate(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  const entityOptions = useMemo<CascadingPickerOption[]>(() => listEntityOptions(entities)
    .map((entity) => {
      const attrs = listAttrOptions(findEntity(entities, entity.id), { numbersOnly: true })
      return {
        key: `entity:${entity.id}`,
        label: entity.label,
        children: attrs.map((attr) => ({
          key: `attr:${entity.id}:${attr.id}`,
          label: attr.label,
          value: `entity.${entity.id}.attr.${attr.id}`,
        })),
      }
    })
    .filter((entity) => entity.children.length > 0), [entities])

  // ── 快捷新建入口（实体/变量为空时也能在 picker 里新建）──────────────────────
  const [entityDraft, setEntityDraft] = useState(() => ({
    name: translateUi('cascade.default.entity'),
    attrLabel: translateUi('cascade.default.attribute'),
    initial: '0',
  }))
  const [variableDraft, setVariableDraft] = useState({ id: '', name: '', initial: '' })

  const defaultEntityId = useMemo(() => nextCatalogId('entity', entities), [entities])
  const defaultVariableId = useMemo(() => nextCatalogId('var', variables), [variables])
  const entityIdTaken = catalogIdOccupied(entities, defaultEntityId)
  const variableIdTaken = catalogIdOccupied(variables, defaultVariableId)
  const entityInitialNum = Number.parseFloat(entityDraft.initial)
  const variableInitialNum = Number.parseFloat(variableDraft.initial)
  const entityValid = !!onCreateEntity && !!onCreateEntityAttribute && !entityIdTaken && entityDraft.name.trim() !== '' && Number.isFinite(entityInitialNum)
  const variableValid = !!onCreateVariable && !variableIdTaken && variableDraft.name.trim() !== '' && Number.isFinite(variableInitialNum)

  function commitCreateEntity(): void {
    if (!entityValid || !onCreateEntity || !onCreateEntityAttribute) return
    const attrId = 'attr0'
    const entityRequest: EntityCreateRequest = { entityId: defaultEntityId, name: entityDraft.name.trim() }
    const attrRequest: EntityAttributeCreateRequest = {
      entityId: defaultEntityId,
      attrId,
      initialValue: entityInitialNum,
      meta: { label: entityDraft.attrLabel.trim() || undefined, initial: entityInitialNum },
    }
    onCreateEntity(entityRequest)
    onCreateEntityAttribute(attrRequest)
    insert(`entity.${defaultEntityId}.attr.${attrId}`)
    setEntityDraft({
      name: translateUi('cascade.default.entity'),
      attrLabel: translateUi('cascade.default.attribute'),
      initial: '0',
    })
  }
  function commitCreateVariable(): void {
    if (!variableValid || !onCreateVariable) return
    const request: VariableCreateRequest = {
      variableId: defaultVariableId,
      name: variableDraft.name.trim(),
      initialValue: variableInitialNum,
    }
    onCreateVariable(request)
    insert(`var.${defaultVariableId}`)
    setVariableDraft({ id: '', name: '', initial: '' })
  }

  const CREATE_ENTITY_KEY = 'create-entity:confirm'
  const CREATE_VARIABLE_KEY = 'create-variable:confirm'
  const createEntityOption: CascadingPickerOption | null = onCreateEntity && onCreateEntityAttribute ? {
    key: 'configure:create-entity',
    presentation: 'create',
    label: formatUi('cascade.create.entity', { name: entityDraft.name.trim() || translateUi('cascade.default.entity') }),
    children: [
      {
        key: 'detail:create-entity:name', label: translateUi('cascade.field.entityName'),
        editor: { value: entityDraft.name, ariaLabel: translateUi('cascade.aria.entityName'), onChange: (v) => setEntityDraft((d) => ({ ...d, name: v })) },
      },
      {
        key: 'detail:create-entity:attr', label: translateUi('cascade.field.attributeName'),
        editor: { value: entityDraft.attrLabel, ariaLabel: translateUi('cascade.aria.attributeName'), onChange: (v) => setEntityDraft((d) => ({ ...d, attrLabel: v })) },
      },
      {
        key: 'detail:create-entity:initial', label: translateUi('cascade.field.initialValue'),
        editor: { value: entityDraft.initial, ariaLabel: translateUi('cascade.aria.attributeInitialValue'), inputMode: 'decimal', invalid: !Number.isFinite(entityInitialNum), onChange: (v) => setEntityDraft((d) => ({ ...d, initial: v })) },
      },
      { key: CREATE_ENTITY_KEY, label: translateUi('ui.object.f4ed02d48c46'), value: CREATE_ENTITY_KEY, presentation: 'confirm', disabled: !entityValid },
    ],
  } : null
  const createVariableOption: CascadingPickerOption | null = onCreateVariable ? {
    key: 'configure:create-variable',
    presentation: 'create',
    label: formatUi('cascade.create.variable', { name: variableDraft.name.trim() || defaultVariableId }),
    children: [
      {
        key: 'detail:create-variable:name', label: translateUi('cascade.field.variableName'),
        editor: { value: variableDraft.name, ariaLabel: translateUi('cascade.aria.variableName'), onChange: (v) => setVariableDraft((d) => ({ ...d, name: v })) },
      },
      {
        key: 'detail:create-variable:initial', label: translateUi('cascade.field.initialValue'),
        editor: { value: variableDraft.initial, ariaLabel: translateUi('cascade.aria.variableInitialValue'), inputMode: 'decimal', invalid: !Number.isFinite(variableInitialNum), onChange: (v) => setVariableDraft((d) => ({ ...d, initial: v })) },
      },
      { key: CREATE_VARIABLE_KEY, label: translateUi('ui.object.f4ed02d48c46'), value: CREATE_VARIABLE_KEY, presentation: 'confirm', disabled: !variableValid },
    ],
  } : null

  const entityOptionsWithCreate = useMemo<CascadingPickerOption[]>(() => [
    ...entityOptions,
    ...(createEntityOption ? [createEntityOption] : []),
  ], [entityOptions, createEntityOption])
  const variableOptionsWithCreate = useMemo<CascadingPickerOption[]>(() => [
    ...listVarOptions(variables, { numbersOnly: true }).map((variable) => ({
      key: `var:${variable.id}`, label: variable.label, value: `var.${variable.id}`,
    })),
    ...(createVariableOption ? [createVariableOption] : []),
  ], [variables, createVariableOption])

  function handlePickerSelect(value: string): void {
    if (value === CREATE_ENTITY_KEY) { commitCreateEntity(); return }
    if (value === CREATE_VARIABLE_KEY) { commitCreateVariable(); return }
    insert(value)
  }

  function handlePickerOpenChange(open: boolean, detail: CascadingPickerOpenChangeDetail): void {
    pickerOpenRef.current = open
    if (
      !open
      && detail.reason === 'outside-pointer'
      && detail.target instanceof Node
      && !editorRef.current?.contains(detail.target)
    ) {
      commit(latestTextRef.current)
    }
  }

  return (
    <div ref={editorRef} className="gc-fx" style={box}>
      <div className="gc-fx-editor">
        <pre ref={highlightRef} className="gc-fx-highlight" aria-hidden="true"><FormulaSyntax text={text} />{text.endsWith('\n') ? '\n' : null}</pre>
        <textarea
          ref={taRef}
          className={failure ? 'gc-fx-input is-err' : 'gc-fx-input'}
          aria-label={translateUi('ui.copy.1a5578c5ed2a')}
          aria-invalid={Boolean(failure)}
          spellCheck={false}
          rows={1}
          value={text}
          placeholder={translateUi('ui.copy.959bd037035b')}
          onFocus={(e) => {
            if (draft == null && canonical === '0') {
              e.currentTarget.select()
              lastSelectionRef.current = { start: 0, end: 1 }
              return
            }
            rememberSelection(e.currentTarget)
          }}
          onChange={(e) => {
            const next = e.target.value
            committedTextRef.current = null
            setDraft(next)
            revalidate(next)
            rememberSelection(e.currentTarget)
          }}
          onSelect={(e) => rememberSelection(e.currentTarget)}
          onClick={(e) => rememberSelection(e.currentTarget)}
          onKeyUp={(e) => rememberSelection(e.currentTarget)}
          onScroll={(e) => {
            if (!highlightRef.current) return
            highlightRef.current.scrollTop = e.currentTarget.scrollTop
            highlightRef.current.scrollLeft = e.currentTarget.scrollLeft
          }}
          onBlur={(e) => {
            rememberSelection(e.currentTarget)
            const nextFocus = e.relatedTarget as HTMLElement | null
            if (nextFocus?.closest('.gc-fx-tools') || pickerOpenRef.current) return
            commit(latestTextRef.current)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(latestTextRef.current) }
          }}
        />
      </div>

      {/* 结构摘要行（不复述公式串；给引用和样例值的概览） */}
      {showSummary ? (
        <div className="gc-fx-summary" aria-label={translateUi('ui.copy.440c7e727050')}>
          {refs.entities.size > 0 && (
            <span className="gc-fx-summary-item">
              {translateUi('ui.copy.b296a773b6df')}{[...refs.entities].map((id) => entName(id, entities)).join('、')}
            </span>
          )}
          {refs.vars.size > 0 && (
            <span className="gc-fx-summary-item">
              {translateUi('ui.copy.b418ca60d417')}{[...refs.vars].map((id) => varName(id, variables)).join('、')}
            </span>
          )}
          {refs.entities.size === 0 && refs.vars.size === 0 && !refs.usesScore && !hasHole && (
            <span className="gc-fx-summary-item gc-fx-summary-item--muted">{translateUi('ui.copy.353fcfc64816')}</span>
          )}
          {sampleValue != null && <span className="gc-fx-eq">≈ {sampleValue}</span>}
        </div>
      ) : null}

      {/* 试算面板（默认折叠）：给每个 ?参数 填样例值、实时算出结果 */}
      {hasHole && liveAst && !failure && (
        <TrialPanel ast={liveAst} holes={holes} ctx={ctx} entities={entities} />
      )}

      {/* 插入工具条 */}
      <div
        className="gc-fx-tools"
        onBlur={(e) => {
          const nextFocus = e.relatedTarget as Node | null
          if (
            pickerOpenRef.current
            || (nextFocus && (e.currentTarget.contains(nextFocus) || nextFocus === taRef.current))
          ) return
          commit(latestTextRef.current)
        }}
      >
        <CascadingPicker
          ariaLabel="插入实体属性"
          value=""
          displayValue="实体"
          options={entityOptionsWithCreate}
          onSelect={handlePickerSelect}
          narrowSafe
          variant="toolbar"
          disabled={entityOptionsWithCreate.length === 0}
          onOpenChange={handlePickerOpenChange}
        />
        <CascadingPicker
          ariaLabel="插入变量"
          value=""
          displayValue="变量"
          placeholder={translateUi('ui.copy.b418ca60d417')}
          options={variableOptionsWithCreate}
          onSelect={handlePickerSelect}
          narrowSafe
          fitContent
          variant="toolbar"
          disabled={variableOptionsWithCreate.length === 0}
          onOpenChange={handlePickerOpenChange}
        />
        <SelectDropdown
          ariaLabel="插入函数"
          value=""
          placeholder={translateUi('ui.copy.7209958c07e5')}
          options={FUNCTION_OPTIONS}
          onChange={(fn) => insert(`${fn}()`)}
          variant="toolbar"
          onOpenChange={handlePickerOpenChange}
        />
        <button
          type="button"
          className="gc-fx-tool-button"
          aria-label={translateUi('ui.copy.3c9531fef95e')}
          onClick={() => insert('?参数')}
          title={translateUi('ui.copy.60729adbf334')}
        >
          <span className="gc-fx-tool-add" aria-hidden="true">
            <img src={formulaToolbarAddIcon} alt="" />
          </span>
          <span className="gc-fx-tool-label">{translateUi('ui.copy.eb1e5adecfe6')}</span>
        </button>
      </div>
    </div>
  )
}

/**
 * 试算面板：把每个 ?参数 当纯数值代入，实时算出「≈ 结果」。默认折叠。
 * 样例值只在本地 state，不写回公式定义——纯粹帮用户看懂公式产出。
 */
function TrialPanel({
  ast,
  holes,
  ctx,
  entities,
}: {
  ast: FormulaAstNode
  holes: FormulaHole[]
  ctx: EvalCtx
  entities?: Record<string, Entity>
}): JSX.Element {
  // 每个 hole 一个样例数值（默认 1；entityAttr 空位默认取约定属性在样例实体上的值，取不到回退 1）。
  const [values, setValues] = useState<Record<string, number>>({})
  const sample = (hole: FormulaHole): number => {
    if (values[hole.holeId] != null) return values[hole.holeId]!
    if (hole.kind === 'entityAttr' && hole.suggestAttr) {
      for (const e of Object.values(entities ?? {})) {
        const v = e.attrs?.[hole.suggestAttr]
        if (typeof v === 'number') return v
      }
    }
    return 1
  }

  // hole → number 绑定，走同一套 serializeFormula → tryEvalExpr。
  const bindings: Record<string, FormulaHoleBinding> = {}
  for (const h of holes) bindings[h.holeId] = { kind: 'number', value: sample(h) }
  const expr = serializeFormula(ast, bindings)
  const result = expr != null ? tryEvalExpr(expr, { ...ctx, rng: createRng(0) }) : null

  const [expanded, setExpanded] = useState(false)

  return (
    <div className="gc-fx-trial">
      <div className="gc-fx-trial-head">
        <span
          className="gc-fx-trial-title"
          onClick={() => setExpanded((value) => !value)}
        >
          {translateUi('ui.copy.959ab3bcabb3')}</span>
        <button
          type="button"
          className={`sir-formula-toggle gc-rule-expand-toggle${expanded ? ' is-open' : ''}`}
          aria-label={`${expanded ? translateUi('ui.copy.e9132e604824') : translateUi('ui.copy.b0e24833f752')}${translateUi('ui.template.8a7ca2b9e646')}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <img src={ruleChevronRightIcon} alt="" />
        </button>
      </div>
      {expanded ? (
        <div className="gc-fx-trial-body">
          <div className="gc-fx-trial-rows">
            {holes.map((h) => (
              <label key={h.holeId} className="gc-fx-trial-row">
                <span className="gc-fx-trial-label">{h.label ?? h.holeId}</span>
                <LooseNumberInput
                  className="gc-fx-trial-input"
                  value={sample(h)}
                  emptyValue={0}
                  aria-label={`${translateUi('ui.template.328051dcd8a4')}${h.label ?? h.holeId}`}
                  onChange={(value) => setValues((prev) => ({ ...prev, [h.holeId]: value }))}
                />
              </label>
            ))}
          </div>
          <div className="gc-fx-trial-result">
            <span>{translateUi('ui.copy.8959d1bc2604')}</span>
            {result != null && <span className="gc-fx-trial-eq">≈ {result}</span>}
          </div>
        </div>
      ) : null}
    </div>
  )
}
