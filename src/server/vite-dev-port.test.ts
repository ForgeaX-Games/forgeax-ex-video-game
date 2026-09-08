import type { UserConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VITE_DEV_PORT, resolveViteDevPort } from '../../scripts/vite-dev-port'

const initialDevPort = process.env.VITE_DEV_PORT

afterEach(() => {
  if (initialDevPort === undefined) delete process.env.VITE_DEV_PORT
  else process.env.VITE_DEV_PORT = initialDevPort
  vi.resetModules()
})

function setDevPort(value: string | undefined): void {
  if (value === undefined) delete process.env.VITE_DEV_PORT
  else process.env.VITE_DEV_PORT = value
}

async function loadRootViteConfig(): Promise<UserConfig> {
  const { default: config } = await import('../../vite.config')
  if (typeof config !== 'function') throw new Error('Expected root Vite config function')
  return await config({
    command: 'serve',
    mode: 'test',
    isSsrBuild: false,
    isPreview: false,
  }) as UserConfig
}

async function loadStandaloneViteConfig(): Promise<UserConfig> {
  const { default: config } = await import('../player/vite.config')
  return config as UserConfig
}

describe('resolveViteDevPort', () => {
  it('uses the standalone development default when no port is injected', () => {
    expect(resolveViteDevPort(undefined)).toBe(DEFAULT_VITE_DEV_PORT)
  })

  it('uses an injected valid port', () => {
    expect(resolveViteDevPort('25185')).toBe(25185)
  })

  it('applies the default port to root and standalone Vite configs', async () => {
    setDevPort(undefined)

    const [root, standalone] = await Promise.all([
      loadRootViteConfig(),
      loadStandaloneViteConfig(),
    ])

    expect(root.server).toMatchObject({ port: DEFAULT_VITE_DEV_PORT, strictPort: true })
    expect(standalone.server).toMatchObject({ port: DEFAULT_VITE_DEV_PORT, strictPort: true })
    expect(standalone.preview).toMatchObject({ port: DEFAULT_VITE_DEV_PORT, strictPort: true })
  })

  it('applies an injected port to root and standalone Vite configs', async () => {
    setDevPort('25185')

    const [root, standalone] = await Promise.all([
      loadRootViteConfig(),
      loadStandaloneViteConfig(),
    ])

    expect(root.server).toMatchObject({ port: 25185, strictPort: true })
    expect(standalone.server).toMatchObject({ port: 25185, strictPort: true })
    expect(standalone.preview).toMatchObject({ port: 25185, strictPort: true })
  })

  it.each(['0', '65536', '15185.5', ' 15185', '15185 ', ''])(
    'rejects invalid port %j',
    (value) => {
      expect(() => resolveViteDevPort(value)).toThrow(
        'VITE_DEV_PORT must be an integer between 1 and 65535',
      )
    },
  )

  it('rejects invalid injected ports from both Vite configs', async () => {
    setDevPort('0')

    await expect(loadRootViteConfig()).rejects.toThrow(
      'VITE_DEV_PORT must be an integer between 1 and 65535',
    )
    await expect(loadStandaloneViteConfig()).rejects.toThrow(
      'VITE_DEV_PORT must be an integer between 1 and 65535',
    )
  })
})
