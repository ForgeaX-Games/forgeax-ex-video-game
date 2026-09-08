import { resolve } from 'node:path'
import { resolveViteDevPort } from './vite-dev-port'

const cwd = resolve(import.meta.dir, '..')
const standalone = Bun.argv.includes('--standalone')
const scripts = ['dev:frontend', 'dev:backend'] as const
const children = scripts.map((script) => ({
  script,
  process: Bun.spawn(['bun', 'run', script], {
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
}))

if (standalone) {
  console.log(`[dev] local host shell: http://localhost:${resolveViteDevPort()}/dev.html`)
}

let stopping = false

function stopChildren(signal: NodeJS.Signals): void {
  if (stopping) return
  stopping = true

  for (const child of children) {
    child.process.kill(signal)
  }
}

process.on('SIGINT', () => stopChildren('SIGINT'))
process.on('SIGTERM', () => stopChildren('SIGTERM'))

const firstExit = await Promise.race(
  children.map(async (child) => ({
    script: child.script,
    exitCode: await child.process.exited,
  })),
)

stopChildren('SIGTERM')
await Promise.all(children.map((child) => child.process.exited))

if (firstExit.exitCode !== 0) {
  console.error(`[dev] ${firstExit.script} exited with code ${firstExit.exitCode}`)
}

process.exit(firstExit.exitCode)
