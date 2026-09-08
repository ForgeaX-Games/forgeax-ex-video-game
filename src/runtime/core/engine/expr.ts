/**
 * 声明式表达式（数值/公式/条件）—— 自研解析求值，**绝不用 `eval`/`Function`**。
 *
 * 为什么：一切逻辑都要能落进 scenarios.json 并可移植（把 json 给别人就能跑），所以
 * "伤害 = 攻*2 - 防""气力 ≥ 3"这类表达式是**数据（字符串）**，由本模块解释执行，
 * 数据里绝不存函数/代码。
 *
 * 支持语法（递归下降 + 运算符优先级）：
 *   - 字面量：数字（含小数）
 *   - 引用：`var.<id>` / `entity.<id>.attr.<name>` / `formula.<id>` / `score` / `flag.<id>`
 *   - 一元：`-x`  `!x`
 *   - 二元（低→高）：`||`  `&&`  比较(`> >= < <= == !=`)  加减(`+ -`)  乘除模(`* / %`)
 *   - 括号：`( ... )`
 *   - 函数（走 ctx.rng，保证可复现）：`rand()`  `randInt(a,b)`  `chance(p)`
 *   布尔以 1/0 表示，便于与数值统一。
 *
 * 求值上下文 EvalCtx：只读 vars/entities/formulas/flags/score + 一个可复现 rng。
 * 未知符号 / 解析失败 抛 ExprError（validator 会捕获并静态报告）。
 */
import { checkFormulaCall } from './formula-registry'
import type { Rng } from './rng'

export class ExprError extends Error {}

export interface EvalEntity {
  attrs?: Record<string, number>
}
export interface EvalCtx {
  vars?: Record<string, number>
  entities?: Record<string, EvalEntity>
  flags?: Record<string, number>
  /** Runtime-safe formula catalog; editor formula sidecars are kept as plain data. */
  formulas?: Record<string, unknown>
  score?: number
  rng?: Rng
  /**
   * 临时局部量（单段引用，如 `delta` / `prev` / `next`）。
   * 仅在 watch 反应执行期由引擎注入；优先于其它符号。
   */
  locals?: Record<string, number>
  /** Internal recursion guard for formula.<id> references. */
  formulaStack?: ReadonlySet<string>
}

// ── AST ──────────────────────────────────────────────────────────────────────
export type Node =
  | { t: 'num'; v: number }
  | { t: 'ref'; path: string[] } // e.g. ['var','qi'] / ['entity','ent-boss','attr','defense'] / ['score']
  | { t: 'unary'; op: '-' | '!'; x: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }

// ── Tokenizer ─────────────────────────────────────────────────────────────────
type Tok =
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'comma' }

const OPS2 = new Set(['>=', '<=', '==', '!=', '&&', '||'])

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const isIdChar = (c: string) => /[A-Za-z0-9_.\-]/.test(c)
  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c === '(') {
      toks.push({ k: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      toks.push({ k: 'rp' })
      i++
      continue
    }
    if (c === ',') {
      toks.push({ k: 'comma' })
      i++
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS2.has(two)) {
      toks.push({ k: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/%><!'.includes(c)) {
      toks.push({ k: 'op', v: c })
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++
      const num = Number(src.slice(i, j))
      if (Number.isNaN(num)) throw new ExprError(`bad number at ${i}: ${src.slice(i, j)}`)
      toks.push({ k: 'num', v: num })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < src.length && isIdChar(src[j]!)) j++
      toks.push({ k: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    throw new ExprError(`unexpected char '${c}' at ${i}`)
  }
  return toks
}

// ── Parser (recursive descent) ────────────────────────────────────────────────
class Parser {
  private p = 0
  constructor(private readonly toks: Tok[]) {}
  private peek(): Tok | undefined {
    return this.toks[this.p]
  }
  private eat(): Tok {
    const t = this.toks[this.p++]
    if (!t) throw new ExprError('unexpected end of expression')
    return t
  }
  private eatOp(v: string): void {
    const t = this.eat()
    if (t.k !== 'op' || t.v !== v) throw new ExprError(`expected '${v}'`)
  }

  parse(): Node {
    const n = this.parseOr()
    if (this.p !== this.toks.length) throw new ExprError('trailing tokens')
    return n
  }
  private parseBinLevel(next: () => Node, ops: string[]): Node {
    let a = next()
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && ops.includes(t.v)) {
        this.p++
        a = { t: 'bin', op: t.v, a, b: next() }
      } else return a
    }
  }
  private parseOr(): Node {
    return this.parseBinLevel(() => this.parseAnd(), ['||'])
  }
  private parseAnd(): Node {
    return this.parseBinLevel(() => this.parseCmp(), ['&&'])
  }
  private parseCmp(): Node {
    return this.parseBinLevel(() => this.parseAdd(), ['>', '>=', '<', '<=', '==', '!='])
  }
  private parseAdd(): Node {
    return this.parseBinLevel(() => this.parseMul(), ['+', '-'])
  }
  private parseMul(): Node {
    return this.parseBinLevel(() => this.parseUnary(), ['*', '/', '%'])
  }
  private parseUnary(): Node {
    const t = this.peek()
    if (t && t.k === 'op' && (t.v === '-' || t.v === '!')) {
      this.p++
      return { t: 'unary', op: t.v as '-' | '!', x: this.parseUnary() }
    }
    return this.parsePrimary()
  }
  private parsePrimary(): Node {
    const t = this.eat()
    if (t.k === 'num') return { t: 'num', v: t.v }
    if (t.k === 'lp') {
      const n = this.parseOr()
      const r = this.eat()
      if (r.k !== 'rp') throw new ExprError("expected ')'")
      return n
    }
    if (t.k === 'id') {
      // 函数调用？
      if (this.peek()?.k === 'lp') {
        this.p++
        const args: Node[] = []
        if (this.peek()?.k !== 'rp') {
          args.push(this.parseOr())
          while (this.peek()?.k === 'comma') {
            this.p++
            args.push(this.parseOr())
          }
        }
        const r = this.eat()
        if (r.k !== 'rp') throw new ExprError("expected ')' after args")
        return { t: 'call', name: t.v, args }
      }
      return { t: 'ref', path: t.v.split('.') }
    }
    throw new ExprError('unexpected token')
  }
}

export function parseExpr(src: string): Node {
  return new Parser(tokenize(src)).parse()
}

// ── Serializer (AST → 源码，parseExpr 的逆) ─────────────────────────────────────
/**
 * 把 AST 序列化回 expr 源码字符串，**最小括号化**——只在优先级/结合性要求时加括号。
 * 与 parseExpr 构成 round-trip：`parse(serialize(n))` 结构等价于 `n`（对 parser 能产出的树），
 * `serialize(parse(s))` 是 s 的规范形（幂等：再 parse+serialize 不变）。
 */
const BIN_PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '>': 3,
  '>=': 3,
  '<': 3,
  '<=': 3,
  '==': 3,
  '!=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
}
const UNARY_PREC = 6
const PRIMARY_PREC = 100

function nodePrec(n: Node): number {
  if (n.t === 'bin') return BIN_PREC[n.op] ?? 0
  if (n.t === 'unary') return UNARY_PREC
  return PRIMARY_PREC // num / ref / call —— 原子，永不加括号
}

function serNode(n: Node): string {
  switch (n.t) {
    case 'num':
      return String(n.v)
    case 'ref':
      return n.path.join('.')
    case 'call':
      return `${n.name}(${n.args.map((a) => serNode(a)).join(', ')})`
    case 'unary': {
      const inner = serNode(n.x)
      // 一元优先级高于所有二元；操作数是二元时必须括起（如 -(a + b)）。
      return `${n.op}${nodePrec(n.x) < UNARY_PREC ? `(${inner})` : inner}`
    }
    case 'bin': {
      const p = BIN_PREC[n.op] ?? 0
      const a = serNode(n.a)
      const b = serNode(n.b)
      // 左结合：左子优先级更低才括；右子优先级 ≤ 本级就括（a - (b - c) ≠ a - b - c）。
      const left = nodePrec(n.a) < p ? `(${a})` : a
      const right = nodePrec(n.b) <= p ? `(${b})` : b
      return `${left} ${n.op} ${right}`
    }
  }
}

export function serializeExpr(node: Node): string {
  return serNode(node)
}

// ── Evaluator ─────────────────────────────────────────────────────────────────
function resolveRef(path: string[], ctx: EvalCtx): number {
  const [head, ...rest] = path
  // 单段局部量（watch 注入的 prev/next/delta 等）优先。
  if (path.length === 1 && ctx.locals && head! in ctx.locals) return ctx.locals[head!]!
  if (head === 'score') return ctx.score ?? 0
  if (head === 'var') {
    const id = rest.join('.')
    const v = ctx.vars?.[id]
    if (v === undefined) throw new ExprError(`unknown var '${id}'`)
    return v
  }
  if (head === 'flag') {
    const id = rest.join('.')
    const v = ctx.flags?.[id]
    if (v === undefined) throw new ExprError(`unknown flag '${id}'`)
    return v
  }
  if (head === 'formula') {
    return evalFormulaReference(rest.join('.'), ctx)
  }
  if (head === 'entity') {
    const id = rest[0] ?? ''
    const ent = ctx.entities?.[id]
    if (!ent) throw new ExprError(`unknown entity '${id}'`)
    // 统一走 attrs（hp 只是一个约定名的 attr，无特权）：entity.<id>.attr.<name>
    if (rest[1] === 'attr') {
      const attr = rest[2] ?? ''
      const v = ent.attrs?.[attr]
      if (v === undefined) throw new ExprError(`unknown attr '${id}.${attr}'`)
      return v
    }
    throw new ExprError(`bad entity ref '${path.join('.')}'`)
  }
  throw new ExprError(`unknown symbol '${path.join('.')}'`)
}

type RuntimeFormulaRef =
  | { kind: 'entityAttr'; entityId: string; attr: string }
  | { kind: 'var'; varId: string }
  | { kind: 'score' }
  | { kind: 'formula'; formulaId: string }

type RuntimeFormulaNode =
  | { t: 'num'; v: number }
  | { t: 'ref'; ref: RuntimeFormulaRef }
  | { t: 'unary'; op: '-' | '!'; x: unknown }
  | { t: 'bin'; op: string; a: unknown; b: unknown }
  | { t: 'call'; name: string; args: unknown[] }
  | { t: 'hole' }

function formulaNode(value: unknown): RuntimeFormulaNode {
  if (!value || typeof value !== 'object') throw new ExprError('invalid formula AST node')
  const node = value as Record<string, unknown>
  switch (node.t) {
    case 'num':
      if (typeof node.v !== 'number' || !Number.isFinite(node.v)) throw new ExprError('invalid formula number')
      return { t: 'num', v: node.v }
    case 'ref': {
      const ref = node.ref
      if (!ref || typeof ref !== 'object') throw new ExprError('invalid formula reference')
      const rawRef = ref as Record<string, unknown>
      if (rawRef.kind === 'entityAttr' && typeof rawRef.entityId === 'string' && typeof rawRef.attr === 'string') {
        return { t: 'ref', ref: { kind: 'entityAttr', entityId: rawRef.entityId, attr: rawRef.attr } }
      }
      if (rawRef.kind === 'var' && typeof rawRef.varId === 'string') {
        return { t: 'ref', ref: { kind: 'var', varId: rawRef.varId } }
      }
      if (rawRef.kind === 'score') return { t: 'ref', ref: { kind: 'score' } }
      if (rawRef.kind === 'formula' && typeof rawRef.formulaId === 'string') {
        return { t: 'ref', ref: { kind: 'formula', formulaId: rawRef.formulaId } }
      }
      throw new ExprError('invalid formula reference')
    }
    case 'unary':
      if (node.op !== '-' && node.op !== '!') throw new ExprError(`invalid formula unary op '${String(node.op)}'`)
      return { t: 'unary', op: node.op, x: node.x }
    case 'bin':
      if (typeof node.op !== 'string') throw new ExprError('invalid formula binary op')
      return { t: 'bin', op: node.op, a: node.a, b: node.b }
    case 'call':
      if (typeof node.name !== 'string' || !Array.isArray(node.args)) throw new ExprError('invalid formula call')
      return { t: 'call', name: node.name, args: node.args }
    case 'hole':
      return { t: 'hole' }
    default:
      throw new ExprError(`unknown formula AST node '${String(node.t)}'`)
  }
}

function evalFormulaReference(id: string, ctx: EvalCtx): number {
  if (!id) throw new ExprError('formula reference is empty')
  const formula = ctx.formulas?.[id]
  if (!formula || typeof formula !== 'object') throw new ExprError(`unknown formula '${id}'`)
  const ast = (formula as { ast?: unknown }).ast
  if (ast === undefined) throw new ExprError(`formula '${id}' has no AST`)
  const stack = new Set(ctx.formulaStack ?? [])
  if (stack.has(id)) throw new ExprError(`recursive formula '${id}'`)
  stack.add(id)
  return evalFormulaNode(ast, { ...ctx, formulaStack: stack })
}

function resolveFormulaRef(ref: RuntimeFormulaRef, ctx: EvalCtx): number {
  switch (ref.kind) {
    case 'entityAttr':
      return resolveRef(['entity', ref.entityId, 'attr', ref.attr], ctx)
    case 'var':
      return resolveRef(['var', ref.varId], ctx)
    case 'score':
      return resolveRef(['score'], ctx)
    case 'formula':
      return evalFormulaReference(ref.formulaId, ctx)
  }
}

function evalFormulaNode(value: unknown, ctx: EvalCtx): number {
  const node = formulaNode(value)
  switch (node.t) {
    case 'num':
      return node.v
    case 'hole':
      throw new ExprError('formula contains an unbound hole')
    case 'ref':
      return resolveFormulaRef(node.ref, ctx)
    case 'unary':
      return node.op === '-' ? -evalFormulaNode(node.x, ctx) : evalFormulaNode(node.x, ctx) === 0 ? 1 : 0
    case 'bin':
      return evalBinary(node.op, evalFormulaNode(node.a, ctx), evalFormulaNode(node.b, ctx))
    case 'call':
      return evalCall(node.name, node.args.map((arg) => evalFormulaNode(arg, ctx)), ctx)
  }
}

function evalCall(name: string, args: number[], ctx: EvalCtx): number {
  const callIssue = checkFormulaCall(name, args.length)
  if (callIssue) throw new ExprError(callIssue.message)
  if (name === 'abs') return Math.abs(args[0] ?? 0)
  if (name === 'floor') return Math.floor(args[0] ?? 0)
  if (name === 'round') return Math.round(args[0] ?? 0)
  if (name === 'min') return Math.min(...(args.length ? args : [0]))
  if (name === 'max') return Math.max(...(args.length ? args : [0]))
  const rng = ctx.rng
  if (!rng) throw new ExprError(`rng required for '${name}()'`)
  if (name === 'rand') return rng.next()
  if (name === 'randInt') return rng.randInt(args[0] ?? 0, args[1] ?? 0)
  if (name === 'chance') return rng.chance(args[0] ?? 0) ? 1 : 0
  throw new ExprError(`unknown function '${name}'`)
}

function evalBinary(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return a / b
    case '%': return a % b
    case '>': return a > b ? 1 : 0
    case '>=': return a >= b ? 1 : 0
    case '<': return a < b ? 1 : 0
    case '<=': return a <= b ? 1 : 0
    case '==': return a === b ? 1 : 0
    case '!=': return a !== b ? 1 : 0
    case '&&': return a !== 0 && b !== 0 ? 1 : 0
    case '||': return a !== 0 || b !== 0 ? 1 : 0
    default: throw new ExprError(`unknown op '${op}'`)
  }
}

function evalNode(n: Node, ctx: EvalCtx): number {
  switch (n.t) {
    case 'num':
      return n.v
    case 'ref':
      return resolveRef(n.path, ctx)
    case 'unary':
      return n.op === '-' ? -evalNode(n.x, ctx) : evalNode(n.x, ctx) === 0 ? 1 : 0
    case 'call': {
      return evalCall(n.name, n.args.map((x) => evalNode(x, ctx)), ctx)
    }
    case 'bin': {
      const a = evalNode(n.a, ctx)
      const b = evalNode(n.b, ctx)
      return evalBinary(n.op, a, b)
    }
  }
}

export function evalExpr(src: string, ctx: EvalCtx): number {
  return evalNode(parseExpr(src), ctx)
}

/** 预览/摘要用：求值失败或非有限数返回 null，不抛错。 */
export function tryEvalExpr(src: string, ctx: EvalCtx): number | null {
  try {
    const v = evalExpr(src, ctx)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

// ── 静态引用采集（validator 用）────────────────────────────────────────────────
export interface ExprRefs {
  vars: string[]
  entities: string[]
  flags: string[]
  formulas: string[]
  usesScore: boolean
  /**
   * 单段标识 —— 只能由 `EvalCtx.locals` 满足（`delta` / `prev` / `next`）。
   * 带点的引用（`entity.x.attr.hp`）是一个整体 id token，永不落进这里。
   */
  locals: string[]
}

export function collectRefs(src: string): ExprRefs {
  const refs: ExprRefs = { vars: [], entities: [], flags: [], formulas: [], usesScore: false, locals: [] }
  const walk = (n: Node): void => {
    switch (n.t) {
      case 'ref': {
        const [head, ...rest] = n.path
        if (head === 'score') refs.usesScore = true
        else if (head === 'var') refs.vars.push(rest.join('.'))
        else if (head === 'flag') refs.flags.push(rest.join('.'))
        else if (head === 'entity') refs.entities.push(rest[0] ?? '')
        else if (head === 'formula') refs.formulas.push(rest.join('.'))
        else if (head && !rest.length) refs.locals.push(head)
        break
      }
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
      case 'num':
        break
    }
  }
  walk(parseExpr(src))
  return refs
}
