import { readFile, writeFile } from 'node:fs/promises'
import postcss from 'postcss'

const outputPath = new URL('../dist/index.css', import.meta.url)
const reactFlowStylePath = new URL(
  '../node_modules/@xyflow/react/dist/style.css',
  import.meta.url,
)
const importStatement = '@import "@xyflow/react/dist/style.css";'

const output = await readFile(outputPath, 'utf8')
if (!output.includes(importStatement)) {
  if (output.includes('.ks-app-host .react-flow')) process.exit(0)
  throw new Error('dist/index.css no longer contains the React Flow stylesheet import')
}

const reactFlowRoot = postcss.parse(await readFile(reactFlowStylePath, 'utf8'))
reactFlowRoot.walkRules((rule) => {
  // Keyframe steps are not selectors and must remain untouched.
  if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) {
    return
  }
  rule.selectors = rule.selectors.map((selector) => `.ks-app-host ${selector}`)
})

await writeFile(outputPath, output.replace(importStatement, reactFlowRoot.toString()))
