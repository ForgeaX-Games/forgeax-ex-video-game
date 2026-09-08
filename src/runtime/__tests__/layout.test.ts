import { describe, expect, it } from 'vitest'
import {
  STAGE_FILL_LAYOUT,
  childWrapStyle,
  layoutHasExplicitSize,
  layoutIsEffectivelyEmpty,
  layoutValueToCss,
  layoutToCss,
  mountWrapStyle,
  resolveMountLayoutForChildren,
} from '../core/schema/layout'

describe('layout', () => {
  it('layoutValueToCss maps fraction and strings', () => {
    expect(layoutValueToCss(0)).toBe('0%')
    expect(layoutValueToCss(0.5)).toBe('50%')
    expect(layoutValueToCss(-0.5)).toBe('-50%')
    expect(layoutValueToCss('12px')).toBe('12px')
    expect(layoutValueToCss('50%')).toBe('50%')
  })

  it('layoutIsEffectivelyEmpty', () => {
    expect(layoutIsEffectivelyEmpty(undefined)).toBe(true)
    expect(layoutIsEffectivelyEmpty({})).toBe(true)
    expect(layoutIsEffectivelyEmpty({ left: 0 })).toBe(false)
  })

  it('layoutHasExplicitSize', () => {
    expect(layoutHasExplicitSize({ width: 1 })).toBe(true)
    expect(layoutHasExplicitSize({ left: 0, top: 0 })).toBe(false)
  })

  it('fills missing mount dimensions when a child uses the full parent stage', () => {
    expect(resolveMountLayoutForChildren(
      { left: 0.2, top: 0.1 },
      [{ left: -0.15, top: -0.02, width: 1, height: 1 }],
    )).toEqual({
      left: 0.2,
      top: 0.1,
      width: 1,
      height: 1,
    })
  })

  it('keeps auto-sized mounts for non-stage children', () => {
    expect(resolveMountLayoutForChildren(
      { left: 0.2, top: 0.1 },
      [{ left: 0, top: 0 }],
    )).toEqual({ left: 0.2, top: 0.1 })
  })

  it('mountWrapStyle: auto-size when no layout', () => {
    expect(mountWrapStyle()).toEqual({
      position: 'absolute',
      pointerEvents: 'none',
      left: 0,
      top: 0,
      width: 'fit-content',
      height: 'fit-content',
    })
  })

  it('mountWrapStyle: explicit width, auto height', () => {
    expect(mountWrapStyle({ left: 0, top: 0, width: 1 })).toMatchObject({
      position: 'absolute',
      left: '0%',
      top: '0%',
      width: '100%',
      height: 'fit-content',
    })
  })

  it('childWrapStyle: fill mount when mount has size and child has no layout', () => {
    expect(childWrapStyle(undefined, true)).toEqual({
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    })
  })

  it('childWrapStyle: preserves stacking for a z-index-only child', () => {
    expect(childWrapStyle({ zIndex: 3 }, true)).toEqual({
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 3,
    })
    expect(childWrapStyle({ zIndex: 3 }, false)).toEqual({
      position: 'relative',
      pointerEvents: 'auto',
      zIndex: 3,
    })
  })

  it('childWrapStyle: layout → CSS passthrough', () => {
    expect(childWrapStyle(STAGE_FILL_LAYOUT, true)).toEqual({
      position: 'absolute',
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    })
  })

  it('childWrapStyle: flow when mount auto-size', () => {
    expect(childWrapStyle(undefined, false)).toEqual({ pointerEvents: 'auto' })
  })

  it('childWrapStyle: anchor-only keeps pointer events for panels', () => {
    expect(childWrapStyle({ left: 0, top: 0 }, true)).toMatchObject({
      left: '0%',
      top: '0%',
      pointerEvents: 'auto',
    })
  })

  it('layoutToCss: vertical center left-aligned', () => {
    expect(
      layoutToCss({ left: 0, top: 0.5, translateY: -0.5 }),
    ).toEqual({
      position: 'absolute',
      left: '0%',
      top: '50%',
      transform: 'translate(0, -50%)',
    })
  })

  it('layoutToCss: true center', () => {
    expect(
      layoutToCss({ left: '50%', top: '50%', translateX: '-50%', translateY: '-50%' }),
    ).toEqual({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    })
  })

  it('layoutToCss: bottom bar', () => {
    expect(layoutToCss({ left: 0, right: 0, bottom: 0, height: 0.12 })).toEqual({
      position: 'absolute',
      left: '0%',
      right: '0%',
      bottom: '0%',
      height: '12%',
    })
  })

  it('layoutToCss: zIndex', () => {
    expect(layoutToCss({ left: 0, top: 0, zIndex: 3 })).toEqual({
      position: 'absolute',
      left: '0%',
      top: '0%',
      zIndex: 3,
    })
  })
})
