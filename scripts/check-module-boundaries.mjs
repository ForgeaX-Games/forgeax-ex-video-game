#!/usr/bin/env node
/** Enforce the production dependency graph between root src domains. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = process.env.BOUNDARY_ROOT
  ? resolve(process.env.BOUNDARY_ROOT)
  : DEFAULT_ROOT
const SRC = join(ROOT, 'src')

const ALLOWED_DEPENDENCIES = new Map([
  ['authoring', new Set(['runtime/core'])],
  ['editor', new Set(['authoring', 'i18n', 'lib', 'platform', 'runtime/core', 'runtime/react', 'workflow'])],
  ['i18n', new Set()],
  ['lib', new Set()],
  ['platform', new Set()],
  ['player', new Set(['i18n', 'runtime/core', 'runtime/react'])],
  ['runtime/core', new Set()],
  ['runtime/react', new Set(['i18n', 'lib', 'runtime/core'])],
  ['server', new Set(['authoring', 'runtime/core', 'workflow'])],
  ['test', new Set(['i18n'])],
  ['workflow', new Set()],
])

function walk(directory, out = []) {
  let entries
  try {
    entries = readdirSync(directory)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name)) out.push(path)
  }
  return out
}

function isTest(file) {
  const path = relative(SRC, file).replace(/\\/g, '/')
  return domainOfPath(file) === 'test'
    || /(^|\/)__tests__(\/|$)/.test(path)
    || /\.(test|spec)(\.[^/]+)?$/.test(path)
}

function importSpecifiers(file, source) {
  const extension = file.slice(file.lastIndexOf('.'))
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : ['.js', '.mjs', '.cjs'].includes(extension)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  const specifiers = []
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference
      if (ts.isExternalModuleReference(reference)) addLiteral(reference.expression)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) addLiteral(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function domainOfPath(path) {
  const sourcePath = relative(SRC, path).replace(/\\/g, '/')
  if (sourcePath.startsWith('../') || isAbsolute(sourcePath)) return null
  const [top, second] = sourcePath.split('/')
  if (top === 'runtime' && (second === 'core' || second === 'react')) {
    return `runtime/${second}`
  }
  return top || null
}

function importedDomain(file, rawSpecifier) {
  const specifier = rawSpecifier.split('?')[0]
  if (specifier.startsWith('@/')) {
    return domainOfPath(join(SRC, specifier.slice(2)))
  }
  if (!specifier.startsWith('.')) return null
  return domainOfPath(resolve(dirname(file), specifier))
}

const violations = []
for (const file of walk(SRC)) {
  if (isTest(file)) continue
  const sourceDomain = domainOfPath(file)
  if (!sourceDomain) continue
  const allowed = ALLOWED_DEPENDENCIES.get(sourceDomain) ?? new Set()
  const source = readFileSync(file, 'utf8')
  for (const specifier of importSpecifiers(file, source)) {
    const targetDomain = importedDomain(file, specifier)
    if (!targetDomain) continue
    const targetPath = specifier.startsWith('@/')
      ? join(SRC, specifier.slice(2).split('?')[0])
      : resolve(dirname(file), specifier.split('?')[0])
    const productionImportsTest = !isTest(file) && isTest(targetPath)
    if (!productionImportsTest && (targetDomain === sourceDomain || allowed.has(targetDomain))) continue
    violations.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      sourceDomain,
      specifier,
      targetDomain: productionImportsTest ? 'test' : targetDomain,
    })
  }
}

if (violations.length > 0) {
  console.error('Module boundary violations:')
  for (const violation of violations) {
    console.error(
      `  [${violation.sourceDomain} ↛ ${violation.targetDomain}] ${violation.file}\n`
      + `    import '${violation.specifier}'`,
    )
  }
  process.exit(1)
}

console.log('Module boundaries OK.')
