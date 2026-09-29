import { Component, useLayoutEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import { reportRenderError } from '@/lib/diagnostics/error-report'
import { overlayContentAndHitTargets } from './overlay-fit-targets'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

const THUMBNAIL_STAGE_CSS = `
.component-thumbnail-stage {
  position:absolute; left:0; top:0; width:640px; height:360px;
  container-type:size; transform-origin:0 0; pointer-events:none; cursor:default;
}
.component-thumbnail-stage, .component-thumbnail-stage * {
  pointer-events:none !important;
}
`

const PREVIEW_INPUT_OVERRIDES: Record<string, Record<string, unknown>> = {
  Dialogue: { speaker: '角色', text: '示例对白' },
}

function previewProps(
  componentId: string,
  inputs: readonly { key: string; default?: unknown }[],
): Record<string, unknown> {
  return {
    ...Object.fromEntries(inputs
      .filter((input) => input.default !== undefined)
      .map((input) => [input.key, input.default])),
    ...PREVIEW_INPUT_OVERRIDES[componentId],
  }
}

class PreviewBoundary extends Component<{ componentId: string, children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRenderError({
      error,
      reactStack: info.componentStack,
      region: 'component-library-preview',
      context: { componentId: this.props.componentId },
    })
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/** Shared scaled live preview for a renderable UI control. */
export function ComponentThumbnail({
  component: Preview,
  manifest,
}: {
  component: ComponentType<Record<string, unknown>>
  manifest: ComponentManifest
}): JSX.Element {
  injectStyleOnce('component-thumbnail-stage', THUMBNAIL_STAGE_CSS)
  const id = manifest.id
  const previewRef = useRef<HTMLSpanElement>(null)
  const stageRef = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{
    left: number
    top: number
    width: number
    height: number
    previewWidth: number
    previewHeight: number
  } | null>(null)

  useLayoutEffect(() => {
    const preview = previewRef.current
    const stage = stageRef.current
    if (!preview || !stage) return
    const measure = (): void => {
      const stageRect = stage.getBoundingClientRect()
      const previewRect = preview.getBoundingClientRect()
      const scaleX = stageRect.width / 640 || 1
      const scaleY = stageRect.height / 360 || scaleX
      const targets = overlayContentAndHitTargets(stage)
      const rects = targets.map((target) => target.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height)
      if (!rects.length) return
      const next = {
        left: (Math.min(...rects.map((rect) => rect.left)) - stageRect.left) / scaleX,
        top: (Math.min(...rects.map((rect) => rect.top)) - stageRect.top) / scaleY,
        width: (Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left))) / scaleX,
        height: (Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top))) / scaleY,
        previewWidth: previewRect.width,
        previewHeight: previewRect.height,
      }
      setBox((current) => current
        && Math.abs(current.left - next.left) < 0.5
        && Math.abs(current.top - next.top) < 0.5
        && Math.abs(current.width - next.width) < 0.5
        && Math.abs(current.height - next.height) < 0.5
        && Math.abs(current.previewWidth - next.previewWidth) < 0.5
        && Math.abs(current.previewHeight - next.previewHeight) < 0.5 ? current : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(preview)
    stage.addEventListener('load', measure, true)
    return () => {
      observer?.disconnect()
      stage.removeEventListener('load', measure, true)
    }
  }, [id])

  const scale = box
    ? Math.min((box.previewWidth - 8) / box.width, (box.previewHeight - 6) / box.height)
    : 0.2
  const transform = box
    ? `translate(${box.previewWidth / 2 - (box.left + box.width / 2) * scale}px, ${box.previewHeight / 2 - (box.top + box.height / 2) * scale}px) scale(${scale})`
    : 'translate(-274px, -150px) scale(.2)'

  return (
    <span ref={previewRef} style={{
      position: 'absolute',
      inset: 0,
      display: 'block',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      pointerEvents: 'none',
    }} aria-hidden>
      <span
        ref={stageRef}
        className="component-thumbnail-stage"
        style={{
        transform,
        visibility: box ? 'visible' : 'hidden',
        }}
      >
        <PreviewBoundary componentId={id}>
          <Preview {...previewProps(id, manifest.inputs ?? [])} preview previewTimeMs={400} />
        </PreviewBoundary>
      </span>
    </span>
  )
}
