import { beforeEach, describe, expect, it } from 'vitest'
import packageJson from '../../../../package.json'
import {
  clearErrorReports,
  dismissErrorReport,
  formatErrorReportForAi,
  getErrorReports,
  registerDiagnosticContext,
  reportRenderError,
} from '../error-report'

describe('render error reports', () => {
  beforeEach(() => {
    clearErrorReports()
  })

  it('merges equivalent render failures and increments their count', () => {
    const first = reportRenderError({
      error: new Error('preview exploded'),
      reactStack: '\n    at BrokenPreview',
      region: 'node-preview',
    })
    const second = reportRenderError({
      error: new Error('preview exploded'),
      reactStack: '\n    at BrokenPreview',
      region: 'node-preview',
    })

    expect(second.id).toBe(first.id)
    expect(getErrorReports()).toHaveLength(1)
    expect(getErrorReports()[0]?.count).toBe(2)
  })

  it('keeps failures from different regions separate', () => {
    const error = new Error('render failed')

    reportRenderError({ error, region: 'graph-canvas' })
    reportRenderError({ error, region: 'node-inspector' })

    expect(getErrorReports()).toHaveLength(2)
  })

  it('collects lazy safe context and formats an AI-ready report', () => {
    const unregister = registerDiagnosticContext(() => ({
      gameId: 'game-42',
      view: 'graph',
      blueprintId: 'boss-fight',
      selectedNodeId: 'intro',
    }))
    const report = reportRenderError({
      error: Object.assign(new Error('skin exploded'), {
        stack: 'Error: skin exploded\n    at ProjectSkin (components/index.js:12:4)',
      }),
      reactStack: '\n    at ProjectSkin\n    at SkinHost',
      region: 'project-component',
      context: { componentId: 'hud.health-bar' },
    })
    unregister()

    const text = formatErrorReportForAi(report)
    expect(text).toContain('Please repair this React render failure')
    expect(text).toContain(`Extension version: ${packageJson.version}`)
    expect(text).toContain('Region: project-component')
    expect(text).toContain('gameId: game-42')
    expect(text).toContain('blueprintId: boss-fight')
    expect(text).toContain('componentId: hud.health-bar')
    expect(text).toContain('JS stack:')
    expect(text).toContain('React component stack:')
  })

  it('dismisses one report without clearing the others', () => {
    const first = reportRenderError({ error: new Error('first'), region: 'sidebar' })
    reportRenderError({ error: new Error('second'), region: 'graph-canvas' })

    dismissErrorReport(first.id)

    expect(getErrorReports().map((report) => report.message)).toEqual(['second'])
  })
})
