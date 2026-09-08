/**
 * Local copy of the platform `chat.reference.accept@1` envelope.
 *
 * game-video runs both in-process inside Arrival and as an iframe inside
 * ForgeaX Studio, so it cannot import this shape from agentstudio — it owns
 * its own producer-side copy and stays structurally compatible with the
 * platform capability contract (see
 * docs/superpowers/specs/2026-08-05-chat-context-reference-capability-design.md).
 */
export interface ContextReference {
  /** Namespaced, e.g. `game-video.blueprint-node.v1`. */
  readonly refKind: string
  readonly sourceExtensionId: string
  readonly display: { title: string; icon?: string; subtitle?: string }
  /** Structured payload for the agent; JSON-serializable, not a UI instruction. */
  readonly payload: unknown
  /**
   * Write-back / action hint. Agents may ignore unknown protocols.
   *  - tools     = via Host MCP tools
   *  - path-edit = snippet/asset-style path write-back
   *  - none      = context only, no write-back
   */
  readonly action?: {
    protocol: 'tools' | 'path-edit' | 'none'
    toolHints?: readonly string[]
  }
}
