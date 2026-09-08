/**
 * RuntimeComponentHost — wiring / expr / bind → concrete flat props for the leaf.
 * No extra DOM. Subscription stays at GamePlayer setSnap.
 */
import type { ComponentType, ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import type { OverlaySnap } from '@/runtime/core/engine/session'
import { resolveComponentInputs } from './resolveComponentInputs'
import type { SkinCtx } from './rendererRegistry'

export interface OverlayRendererRegistration {
  // Flat leaf props (+ Host-injected emit/preview*); keep loose for registration.
  component: ComponentType<Record<string, unknown>>
  manifest?: ComponentManifest
}

export interface RuntimeComponentHostProps {
  registration: OverlayRendererRegistration
  overlay: OverlaySnap
  emit?: (key: string) => void
  ctx?: SkinCtx
  preview?: boolean
  previewTimeMs?: number
  previewPlaying?: boolean
}

export function RuntimeComponentHost({
  registration,
  overlay,
  emit,
  ctx,
  preview,
  previewTimeMs,
  previewPlaying,
}: RuntimeComponentHostProps): ReactNode {
  const Component = registration.component
  const props = resolveComponentInputs(registration.manifest, overlay.inputs, ctx)
  return (
    <Component
      {...props}
      emit={emit}
      preview={preview}
      previewTimeMs={previewTimeMs}
      previewPlaying={previewPlaying}
    />
  )
}
