import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(import.meta.dirname, '..')
const I18N_FILE = resolve(ROOT, 'src/i18n/index.ts')
const UI_ATTRIBUTE_NAMES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'emptyHint',
  'label',
  'placeholder',
  'title',
])
const UI_OBJECT_PROPERTY_NAMES = new Set(['description', 'emptyHint', 'label', 'placeholder', 'title'])
const HUMAN_TEXT = /[\p{Script=Han}\p{L}]/u
const I18N_CALLS = new Set(['t', 'tf'])

function parseCatalogKeys(source, catalogName) {
  const sourceFile = ts.createSourceFile(I18N_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const keys = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== catalogName) continue
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue
      for (const property of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const name = property.name
        const key = ts.isStringLiteral(name) || ts.isIdentifier(name) ? name.text : null
        if (!key) continue
        const value = property.initializer
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) keys.set(key, value.text)
      }
    }
  }
  return keys
}

function placeholders(message) {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()
}

function isInsideI18nCall(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && I18N_CALLS.has(current.expression.text)) {
      return true
    }
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) break
  }
  return false
}

function literalText(node) {
  if (
    ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
    || ts.isJsxText(node)
  ) return node.text
  return null
}

function collectHumanLiterals(node, output) {
  const text = literalText(node)
  if (text !== null && HUMAN_TEXT.test(text) && !isInsideI18nCall(node)) output.push(node)
  ts.forEachChild(node, (child) => collectHumanLiterals(child, output))
}

function isUserFacingLiteral(node) {
  if (ts.isJsxText(node)) return true
  let previous = node
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return UI_ATTRIBUTE_NAMES.has(current.name.text)
    if (ts.isPropertyAssignment(current) && current.initializer === previous) {
      const name = ts.isIdentifier(current.name) || ts.isStringLiteral(current.name) ? current.name.text : ''
      if (!UI_OBJECT_PROPERTY_NAMES.has(name)) return false
      return Boolean(current.parent.parent && findFunctionAncestor(current.parent.parent))
    }
    if (ts.isConditionalExpression(current) && current.condition === previous) return false
    if (ts.isBinaryExpression(current)) {
      if (current.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false
    }
    if (ts.isCallExpression(current) || ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current)) {
      return false
    }
    if (ts.isJsxExpression(current)) {
      if (ts.isJsxAttribute(current.parent)) {
        previous = current
        continue
      }
      if (ts.isJsxElement(current.parent)
        && ['style', 'script'].includes(current.parent.openingElement.tagName.getText())) return false
      return true
    }
    if (ts.isJsxElement(current)) return false
    if (ts.isJsxSelfClosingElement(current)) return false
    if (ts.isSourceFile(current) || ts.isFunctionLike(current)) return false
    previous = current
  }
  return false
}

function findFunctionAncestor(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current
    if (ts.isSourceFile(current)) return null
  }
  return null
}

const errors = []
const catalogSource = readFileSync(I18N_FILE, 'utf8')
const en = parseCatalogKeys(catalogSource, 'EN')
const zh = parseCatalogKeys(catalogSource, 'ZH')

for (const key of new Set([...en.keys(), ...zh.keys()])) {
  if (!en.has(key)) errors.push(`src/i18n/index.ts: missing EN key ${key}`)
  if (!zh.has(key)) errors.push(`src/i18n/index.ts: missing ZH key ${key}`)
  if (en.has(key) && zh.has(key)) {
    const enVars = placeholders(en.get(key))
    const zhVars = placeholders(zh.get(key))
    if (enVars.join('\0') !== zhVars.join('\0')) {
      errors.push(`src/i18n/index.ts: placeholder mismatch for ${key}: EN={${enVars}} ZH={${zhVars}}`)
    }
  }
}

const sourcePaths = readdirSync(resolve(ROOT, 'src'), { recursive: true })
  .filter((path) => typeof path === 'string' && /\.[jt]sx?$/.test(path))
  // readdirSync yields `\`-separated segments on Windows while every exclusion
  // below matches POSIX separators; normalise or the src/server/ exclusion
  // silently stops matching and server prompt copy gets flagged as UI text.
  .map((path) => `src/${path.split('\\').join('/')}`)

for (const relativePath of sourcePaths) {
  // The server now lives under the shared source root, but its prompt strings,
  // seed metadata and progress labels are not browser UI copy. Preserve this
  // gate's production-UI scope while continuing to scan every frontend domain.
  if (
    relativePath.startsWith('src/server/')
    || relativePath.includes('/__tests__/')
    || /\.test\.[jt]sx?$/.test(relativePath)
  ) continue
  const absolutePath = resolve(ROOT, relativePath)
  if (absolutePath === I18N_FILE) continue
  const source = readFileSync(absolutePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const candidates = []
  collectHumanLiterals(sourceFile, candidates)
  for (const node of candidates.filter(isUserFacingLiteral)) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const text = literalText(node).trim().replace(/\s+/g, ' ')
    errors.push(`${relativePath}:${line + 1}:${character + 1}: user-facing text must use t()/tf(): ${JSON.stringify(text)}`)
  }
  const checkTranslationCalls = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && ['t', 'tf', 'translateUi'].includes(node.expression.text)) {
      const keyNode = node.arguments[0]
      if (keyNode && ts.isStringLiteral(keyNode) && !en.has(keyNode.text)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(keyNode.getStart(sourceFile))
        errors.push(`${relativePath}:${line + 1}:${character + 1}: missing catalog key ${keyNode.text}`)
      }
    }
    ts.forEachChild(node, checkTranslationCalls)
  }
  checkTranslationCalls(sourceFile)
}

if (errors.length > 0) {
  console.error(`[i18n] ${errors.length} violation(s)\n${errors.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`[i18n] ${en.size} EN/ZH keys; no untranslated user-facing literals`)
}
