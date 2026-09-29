import { describe, expect, test } from 'vitest'
import {
  gameVideoMcpToolName,
  gameVideoToolId,
  qualifyAsMateMcpName,
  toMcpName,
} from '../mcp-tool-name'

describe('MCP tool transport naming', () => {
  test('maps stable game-video tool ids with the workbench transport convention', () => {
    expect(gameVideoToolId('configure-blueprint-node'))
      .toBe('game-video:configure-blueprint-node')
    expect(toMcpName('game-video:configure-blueprint-node'))
      .toBe('workbench__game_video__configure_blueprint_node')
    expect(gameVideoMcpToolName('configure-blueprint-node'))
      .toBe('mcp__as-mate-tools__workbench__game_video__configure_blueprint_node')
    expect(qualifyAsMateMcpName('workbench__game_video__patch_graph'))
      .toBe('mcp__as-mate-tools__workbench__game_video__patch_graph')
  })

  test('rejects ids that cannot round-trip through agentic_mate toMcpName', () => {
    expect(() => toMcpName('game_video:patch_graph')).toThrow(TypeError)
    expect(() => gameVideoToolId('patch_graph')).toThrow(TypeError)
  })
})
