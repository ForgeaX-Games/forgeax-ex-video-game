import type { ExtensionContext } from '@forgeax/extension-host/node'
import { describe, expect, test } from 'vitest'
import {
  ComponentAuthoringConflictError,
  ComponentAuthoringInputError,
  deleteAuthoredComponent,
  ensureAuthoredComponentModule,
  knownComponentIds,
  parseComposedOverlay,
  upsertAuthoredComponent,
  writeComposedOverlay,
} from './component-authoring'

const decoder = new TextDecoder()

function createFilesContext(): {
  context: ExtensionContext
  entries: Map<string, Uint8Array>
} {
  const entries = new Map<string, Uint8Array>()
  const context = {
    gameId: 'real-game',
    gameRoot: '/workspace/games/real-game',
    files: {
      async list(path: string) {
        const prefix = `${path.replace(/\/+$/u, '')}/`
        return [...new Set([...entries.keys()]
          .filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!)
          .filter(Boolean))].sort()
      },
      async read(path: string) {
        const bytes = entries.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, bytes: Uint8Array) {
        entries.set(path, new Uint8Array(bytes))
      },
      async delete(path: string) { entries.delete(path) },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) {
        return operation()
      },
    },
  } as ExtensionContext
  return { context, entries }
}

const optionButton = {
  id: 'OptionButton',
  label: '选项按钮',
  inputs: [
    { key: 'label', label: '文字', valueType: 'string', default: '选项' },
    { key: 'selected', label: '选中', valueType: 'boolean', default: false },
  ],
  events: [{ id: 'select', label: '选择' }],
  implementation: `function OptionButton(props) {
    return React.createElement('button', { onClick: function () { props.emit?.('select') } }, props.label)
  }`,
}

describe('component authoring', () => {
  test('seeds a valid empty catalog once without overwriting an existing module', async () => {
    const { context, entries } = createFilesContext()

    await expect(ensureAuthoredComponentModule(context)).resolves.toBe(true)
    const emptyModule = decoder.decode(entries.get('components/index.js'))
    expect(emptyModule).toContain('export default [\n]')

    entries.set('components/index.js', new TextEncoder().encode('export default ["existing"]'))
    await expect(ensureAuthoredComponentModule(context)).resolves.toBe(false)
    expect(decoder.decode(entries.get('components/index.js'))).toBe('export default ["existing"]')
  })

  test('upserts structured definitions and generates one browser ESM catalog', async () => {
    const { context, entries } = createFilesContext()

    await expect(upsertAuthoredComponent(context, optionButton)).resolves.toMatchObject({
      ok: true,
      componentId: 'OptionButton',
      created: true,
      componentCount: 1,
      definitionPath: 'components/definitions/OptionButton.json',
      modulePath: 'components/index.js',
    })
    await expect(upsertAuthoredComponent(context, {
      id: 'StatusChip',
      label: '状态标签',
      events: [],
      implementation: "function StatusChip() { return React.createElement('span', null, 'Ready') }",
    })).resolves.toMatchObject({ created: true, componentCount: 2 })

    const moduleSource = decoder.decode(entries.get('components/index.js'))
    expect(moduleSource).toContain("Symbol.for(\"forgeax.game-video.react\")")
    expect(moduleSource).toContain('function OptionButton(props)')
    expect(moduleSource).toContain('function StatusChip()')
    expect(moduleSource).toContain('"id":"OptionButton"')
    expect(moduleSource).toContain('export default [')
  })

  test('updates one definition without dropping other authored controls', async () => {
    const { context, entries } = createFilesContext()
    await upsertAuthoredComponent(context, optionButton)
    await upsertAuthoredComponent(context, {
      id: 'StatusChip',
      events: [],
      implementation: "function StatusChip() { return React.createElement('span') }",
    })

    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      label: '选项按钮 v2',
    })).resolves.toMatchObject({ created: false, componentCount: 2 })

    const moduleSource = decoder.decode(entries.get('components/index.js'))
    expect(moduleSource).toContain('选项按钮 v2')
    expect(moduleSource).toContain('StatusChip')
  })

  test('rejects paths, duplicate manifest keys, and non-JavaScript implementations', async () => {
    const { context, entries } = createFilesContext()

    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      id: '../escape',
    })).rejects.toBeInstanceOf(ComponentAuthoringInputError)
    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      inputs: [
        { key: 'label', valueType: 'string', default: '' },
        { key: 'label', valueType: 'string', default: '' },
      ],
    })).rejects.toThrow('unique logical identifier')
    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      implementation: 'function Broken( {',
    })).rejects.toThrow('valid JavaScript expression')
    expect(entries.size).toBe(0)
  })

  test.each([
    ['missing default', { key: 'label', valueType: 'string' }, 'inputs[0].default is required'],
    ['wrong string default', { key: 'label', valueType: 'string', default: false }, 'must be a string'],
    ['non-finite number default', { key: 'count', valueType: 'number', default: Number.NaN }, 'must be a finite number'],
    ['wrong boolean default', { key: 'selected', valueType: 'boolean', default: 'false' }, 'must be a boolean'],
    ['invalid color default', { key: 'color', valueType: 'color', default: 'bright-red' }, 'ColorPicker-compatible'],
    [
      'default outside options',
      {
        key: 'size',
        valueType: 'string',
        default: 'large',
        options: [{ value: 'small', label: '小' }],
      },
      'must equal one of inputs options[].value',
    ],
  ])('rejects %s without overwriting the working component', async (_case, authoredInput, message) => {
    const { context, entries } = createFilesContext()
    await upsertAuthoredComponent(context, optionButton)
    const definitionBefore = entries.get('components/definitions/OptionButton.json')
    const moduleBefore = entries.get('components/index.js')

    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      inputs: [authoredInput],
    })).rejects.toThrow(message)

    expect(entries.get('components/definitions/OptionButton.json')).toEqual(definitionBefore)
    expect(entries.get('components/index.js')).toEqual(moduleBefore)
  })

  test('accepts complete defaults, including ColorPicker colors and JSON values', async () => {
    const { context, entries } = createFilesContext()
    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      inputs: [
        { key: 'label', valueType: 'string', default: '' },
        { key: 'count', valueType: 'number', default: 0 },
        { key: 'selected', valueType: 'boolean', default: false },
        { key: 'accent', valueType: 'color', default: 'rgba(255,145,56,0.8)' },
        { key: 'binding', valueType: 'bind', default: '' },
        { key: 'payload', valueType: 'json', default: { items: [] } },
        {
          key: 'size',
          valueType: 'string',
          default: 'small',
          options: [{ value: 'small', label: '小' }],
        },
      ],
    })).resolves.toMatchObject({ ok: true, componentId: 'OptionButton' })

    expect(decoder.decode(entries.get('components/definitions/OptionButton.json')))
      .toContain('"default": "rgba(255,145,56,0.8)"')
  })

  test('rejects undeclared identifiers in deferred handlers without overwriting the working component', async () => {
    const { context, entries } = createFilesContext()
    await upsertAuthoredComponent(context, optionButton)
    const definitionBefore = entries.get('components/definitions/OptionButton.json')
    const moduleBefore = entries.get('components/index.js')

    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      implementation: `function CountdownTimer(props) {
        const [hovered, setHovered] = React.useState(false)
        return React.createElement('div', {
          onMouseEnter: function () { setHovered(function () { return ctx.active }) },
        }, hovered ? props.label : '00:10')
      }`,
    })).rejects.toThrow('undeclared identifier "ctx"')

    expect(entries.get('components/definitions/OptionButton.json')).toEqual(definitionBefore)
    expect(entries.get('components/index.js')).toEqual(moduleBefore)
  })

  test.each([
    ['var initializer', `function OptionButton(props) {
      var React = React
      return React.createElement('button', null, props.label)
    }`],
    ['parameter', `function OptionButton(React) {
      return React.createElement('button')
    }`],
    ['destructuring target', `function OptionButton(props) {
      const { React } = props
      return React.createElement('button')
    }`],
    ['catch binding', `function OptionButton() {
      try { throw new Error('x') } catch (React) { return React.createElement('button') }
    }`],
  ])('rejects a React %s binding without overwriting the working component', async (_case, implementation) => {
    const { context, entries } = createFilesContext()
    await upsertAuthoredComponent(context, optionButton)
    const definitionBefore = entries.get('components/definitions/OptionButton.json')
    const moduleBefore = entries.get('components/index.js')

    await expect(upsertAuthoredComponent(context, {
      ...optionButton,
      implementation,
    })).rejects.toThrow('declares or shadows the injected React runtime')

    expect(entries.get('components/definitions/OptionButton.json')).toEqual(definitionBefore)
    expect(entries.get('components/index.js')).toEqual(moduleBefore)
  })

  test('allows declared timer state and approved browser scheduling globals', async () => {
    const { context } = createFilesContext()

    await expect(upsertAuthoredComponent(context, {
      id: 'CountdownTimer',
      inputs: [{ key: 'duration', valueType: 'number', default: 10 }],
      events: [{ id: 'complete' }],
      implementation: `function CountdownTimer(props) {
        const [remaining, setRemaining] = React.useState(props.duration)
        React.useEffect(function () {
          const startedAt = Date.now()
          const timer = setInterval(function () {
            const next = Math.max(0, props.duration - Math.floor((Date.now() - startedAt) / 1000))
            setRemaining(next)
            if (next === 0) props.emit?.('complete')
          }, 250)
          return function () { clearInterval(timer) }
        }, [props.duration])
        return React.createElement('span', null, String(remaining))
      }`,
    })).resolves.toMatchObject({ ok: true, componentId: 'CountdownTimer' })
  })

  test('repairs a legacy invalid definition when replacing the same component id', async () => {
    const { context, entries } = createFilesContext()
    const broken = {
      schemaVersion: 1,
      manifest: optionButton,
      implementation: "function OptionButton() { return React.createElement('span', null, ctx.label) }",
    }
    entries.set(
      'components/definitions/OptionButton.json',
      new TextEncoder().encode(`${JSON.stringify(broken)}\n`),
    )
    entries.set(
      'components/index.js',
      new TextEncoder().encode('// legacy invalid module'),
    )

    await expect(upsertAuthoredComponent(context, optionButton)).resolves.toMatchObject({
      created: false,
      componentId: 'OptionButton',
    })
    expect(decoder.decode(entries.get('components/index.js'))).not.toContain('ctx.label')
  })

  test('keeps legacy definitions without defaults readable while enforcing defaults on new writes', async () => {
    const { context, entries } = createFilesContext()
    entries.set(
      'components/definitions/LegacyChip.json',
      new TextEncoder().encode(`${JSON.stringify({
        schemaVersion: 1,
        manifest: {
          id: 'LegacyChip',
          inputs: [{ key: 'label', valueType: 'string' }],
          events: [],
        },
        implementation: "function LegacyChip(props) { return React.createElement('span', null, props.label) }",
      })}\n`),
    )

    await expect(upsertAuthoredComponent(context, optionButton)).resolves.toMatchObject({
      componentCount: 2,
    })
    expect(decoder.decode(entries.get('components/index.js'))).toContain('LegacyChip')

    await expect(upsertAuthoredComponent(context, {
      id: 'LegacyChip',
      inputs: [{ key: 'label', valueType: 'string' }],
      events: [],
      implementation: "function LegacyChip(props) { return React.createElement('span', null, props.label) }",
    })).rejects.toThrow('inputs[0].default is required')
  })

  test('deletes one authored component, rebuilds the catalog, and remains idempotent', async () => {
    const { context, entries } = createFilesContext()
    await upsertAuthoredComponent(context, optionButton)
    await upsertAuthoredComponent(context, {
      id: 'StatusChip',
      events: [],
      implementation: "function StatusChip() { return React.createElement('span', null, 'Ready') }",
    })

    await expect(deleteAuthoredComponent(context, 'OptionButton')).resolves.toMatchObject({
      ok: true,
      componentId: 'OptionButton',
      deleted: true,
      componentCount: 1,
    })
    expect(entries.has('components/definitions/OptionButton.json')).toBe(false)
    expect(decoder.decode(entries.get('components/index.js'))).not.toContain('OptionButton')
    expect(decoder.decode(entries.get('components/index.js'))).toContain('StatusChip')
    await expect(deleteAuthoredComponent(context, 'OptionButton')).resolves.toMatchObject({
      deleted: false,
      componentCount: 1,
    })
  })

  test('refuses to delete while the persisted blueprint still references the component', async () => {
    const { context, entries } = createFilesContext()
    await upsertAuthoredComponent(context, optionButton)
    entries.set('blueprint.json', new TextEncoder().encode(JSON.stringify({
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      ui: {
        overlays: {
          'base:OptionButton': {
            id: 'base:OptionButton',
            children: [{ id: 'button', component: 'OptionButton' }],
          },
        },
      },
      manifest: {
        version: 'game-video.blueprint-manifest.v1',
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', title: 'Main', entry: 'entry', graph: { nodes: [], edges: [] } },
        },
      },
    })))

    await expect(deleteAuthoredComponent(context, 'OptionButton'))
      .rejects.toBeInstanceOf(ComponentAuthoringConflictError)
    expect(entries.has('components/definitions/OptionButton.json')).toBe(true)
    expect(decoder.decode(entries.get('components/index.js'))).toContain('OptionButton')
  })
})

describe('composed overlay authoring', () => {
  function seedBlueprint(entries: Map<string, Uint8Array>): void {
    entries.set('blueprint.json', new TextEncoder().encode(JSON.stringify({
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      ui: { overlays: {} },
      manifest: {
        version: 'game-video.blueprint-manifest.v1',
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', title: 'Main', entry: 'entry', graph: { nodes: [], edges: [] } },
        },
      },
    })))
  }

  test('parses a compose block with known components', () => {
    const parsed = parseComposedOverlay({
      id: 'scheme-hud',
      title: '战斗 HUD',
      prompt: '整块放右下角',
      children: [
        { id: 'hp', component: 'BattlePlayerHpBar' },
        { id: 'skill', component: 'BattleSkill', inputs: { label: '斩' } },
      ],
    }, new Set(['BattlePlayerHpBar', 'BattleSkill']))

    expect(parsed.overlayId).toBe('scheme-hud')
    expect(parsed.title).toBe('战斗 HUD')
    expect(parsed.prompt).toBe('整块放右下角')
    expect(parsed.children).toHaveLength(2)
    expect(parsed.children[1]!.inputs).toEqual({ label: '斩' })
  })

  test('rejects unknown component references in compose children', () => {
    expect(() => parseComposedOverlay({
      children: [{ id: 'hp', component: 'MissingControl' }],
    }, new Set(['BattlePlayerHpBar']))).toThrow('not a known control')
  })

  test('rejects reserved overlay ids', () => {
    expect(() => parseComposedOverlay({
      id: 'base:HpBar',
      children: [{ id: 'hp', component: 'BattlePlayerHpBar' }],
    }, new Set(['BattlePlayerHpBar']))).toThrow('compose.id must be a logical identifier')
  })

  test('allows the newly created component id in the same call', () => {
    const parsed = parseComposedOverlay({
      children: [{ id: 'hp', component: 'NewHpBar' }],
    }, new Set(['BattlePlayerHpBar']), 'NewHpBar')
    expect(parsed.children[0]!.component).toBe('NewHpBar')
  })

  test('writes a composed template into blueprint.json ui.overlays', async () => {
    const { context, entries } = createFilesContext()
    seedBlueprint(entries)
    const ids = await knownComponentIds(context)
    const parsed = parseComposedOverlay({
      id: 'scheme-hud',
      title: '战斗 HUD',
      children: [
        { id: 'hp', component: 'BattlePlayerHpBar' },
        { id: 'skill', component: 'BattleSkill' },
      ],
    }, ids)

    const written = await writeComposedOverlay(context, parsed)
    expect(written.overlayId).toBe('scheme-hud')
    expect(written.title).toBe('战斗 HUD')

    const blueprint = JSON.parse(decoder.decode(entries.get('blueprint.json')!))
    const overlay = blueprint.ui.overlays['scheme-hud']
    expect(overlay).toBeDefined()
    expect(overlay.title).toBe('战斗 HUD')
    expect(overlay.children).toHaveLength(2)
    expect(overlay.children.map((child: { component: string }) => child.component))
      .toEqual(['BattlePlayerHpBar', 'BattleSkill'])
  })
})
