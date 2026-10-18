import { describe, expect, it } from 'vitest'
import {
  clampHtmlLayoutImageOffset,
  constrainHtmlLayoutImageMove,
  fitHtmlLayoutImageSize,
  htmlLayoutRectanglesOverlap
} from '@/util/htmlLayoutBounds'
import type { HtmlLayoutRectangle } from '@/util/htmlLayoutBounds'

describe('HTML layout image size bounds', () => {
  it.each([
    [{ width: 200, height: 100 }, { width: 150, height: 500 }, { width: 150, height: 75 }],
    [{ width: 200, height: 100 }, { width: 500, height: 30 }, { width: 60, height: 30 }],
    [{ width: 240, height: 160 }, { width: 150, height: 60 }, { width: 90, height: 60 }],
    [{ width: 240, height: 80 }, { width: 9, height: 2 }, { width: 6, height: 2 }]
  ])('uses one proportional scale for requested %j inside %j', (requested, available, expected) => {
    const result = fitHtmlLayoutImageSize(requested, available, true)
    expect(result).toEqual(expected)
    expect(result.width / result.height).toBeCloseTo(requested.width / requested.height, 12)
    expect(result.width).toBeLessThanOrEqual(available.width)
    expect(result.height).toBeLessThanOrEqual(available.height)
  })

  it('limits each dimension independently when the ratio is unlocked', () => {
    expect(fitHtmlLayoutImageSize({ width: 300, height: 80 }, { width: 120, height: 200 }, false))
      .toEqual({ width: 120, height: 80 })
    expect(fitHtmlLayoutImageSize({ width: 300, height: 80 }, { width: 0.5, height: 3.25 }, false))
      .toEqual({ width: 0.5, height: 3.25 })
  })

  it.each([true, false])('retains fitting fractional dimensions without growing or mutating the request with ratio %s', keepRatio => {
    const requested = { width: 32.25, height: 17.125 }
    const available = { width: 120, height: 80 }
    expect(fitHtmlLayoutImageSize(requested, available, keepRatio)).toEqual(requested)
    expect(requested).toEqual({ width: 32.25, height: 17.125 })
    expect(available).toEqual({ width: 120, height: 80 })
  })

  it('retains an exact fractional limiting size without rounding outside the edge', () => {
    expect(fitHtmlLayoutImageSize({ width: 100, height: 50 }, { width: 33.25, height: 60 }, true))
      .toEqual({ width: 33.25, height: 16.625 })
  })

  for (const parameter of ['requested', 'available'] as const) {
    for (const dimension of ['width', 'height'] as const) {
      it.each([0, -1, NaN, Infinity, -Infinity])(`rejects invalid ${parameter} ${dimension} %s`, value => {
        const requested = { width: 120, height: 80 }
        const available = { width: 240, height: 160 }
        const parameterSize = parameter === 'requested' ? requested : available
        parameterSize[dimension] = value
        expect(() => fitHtmlLayoutImageSize(requested, available, true)).toThrow('Invalid HTML layout size.')
        expect(() => fitHtmlLayoutImageSize(requested, available, false)).toThrow('Invalid HTML layout size.')
      })
    }
  }
})

describe('HTML layout image movement bounds', () => {
  const start = { offsetX: 7, offsetY: -2, left: 50, top: 60, width: 100, height: 50 }
  const bounds = { left: 20, top: 30, width: 300, height: 200 }

  it.each([
    [-1000, 0, { offsetX: -23, offsetY: -2 }],
    [1000, 0, { offsetX: 177, offsetY: -2 }],
    [0, -1000, { offsetX: 7, offsetY: -32 }],
    [0, 1000, { offsetX: 7, offsetY: 118 }],
    [-1000, -1000, { offsetX: -23, offsetY: -32 }],
    [1000, 1000, { offsetX: 177, offsetY: 118 }]
  ])('stops movement (%s, %s) at the corresponding edges', (deltaX, deltaY, expected) => {
    expect(clampHtmlLayoutImageOffset(start, bounds, deltaX, deltaY)).toEqual(expected)
  })

  it('adds in-bounds fractional movement to the existing total offsets', () => {
    expect(clampHtmlLayoutImageOffset(start, bounds, 19.375, 24.125))
      .toEqual({ offsetX: 26.375, offsetY: 22.125 })
    expect(start).toEqual({ offsetX: 7, offsetY: -2, left: 50, top: 60, width: 100, height: 50 })
    expect(bounds).toEqual({ left: 20, top: 30, width: 300, height: 200 })
  })

  it('keeps a fractional edge precise rather than rounding past it', () => {
    const fractionalBounds = { left: 20.25, top: 30.125, width: 300.125, height: 200.25 }
    expect(clampHtmlLayoutImageOffset(start, fractionalBounds, 1000, 1000))
      .toEqual({ offsetX: 177.375, offsetY: 118.375 })
    expect(clampHtmlLayoutImageOffset(start, fractionalBounds, -1000, -1000))
      .toEqual({ offsetX: -22.75, offsetY: -31.875 })
  })

  it('anchors an oversized image to the left and top independently of the requested delta', () => {
    const oversized = { offsetX: 10, offsetY: 20, left: 5, top: 8, width: 120, height: 80 }
    const smallBounds = { left: 10, top: 20, width: 100, height: 60 }
    expect(clampHtmlLayoutImageOffset(oversized, smallBounds, -500, 500))
      .toEqual({ offsetX: 15, offsetY: 32 })
  })

  it('still constrains the other axis when only one dimension is oversized', () => {
    expect(clampHtmlLayoutImageOffset({ ...start, width: 400 }, bounds, 1000, 1000))
      .toEqual({ offsetX: -23, offsetY: 118 })
    expect(clampHtmlLayoutImageOffset({ ...start, height: 300 }, bounds, 1000, 1000))
      .toEqual({ offsetX: 177, offsetY: -32 })
  })

  it('permits no movement on an axis whose image exactly fills the bounds', () => {
    expect(clampHtmlLayoutImageOffset({ ...start, left: 20, top: 30, width: 300, height: 200 }, bounds, 1000, -1000))
      .toEqual({ offsetX: 7, offsetY: -2 })
  })

  for (const parameter of ['start', 'bounds'] as const) {
    for (const dimension of ['width', 'height'] as const) {
      it.each([0, -1, NaN, Infinity, -Infinity])(`rejects invalid ${parameter} ${dimension} %s`, value => {
        const imageStart = { ...start }
        const imageBounds = { ...bounds }
        const parameterSize = parameter === 'start' ? imageStart : imageBounds
        parameterSize[dimension] = value
        expect(() => clampHtmlLayoutImageOffset(imageStart, imageBounds, 0, 0))
          .toThrow('Invalid HTML layout bounds or offset.')
      })
    }
  }

  for (const coordinate of ['offsetX', 'offsetY', 'left', 'top'] as const) {
    it.each([NaN, Infinity, -Infinity])(`rejects nonfinite image ${coordinate} %s`, value => {
      expect(() => clampHtmlLayoutImageOffset({ ...start, [coordinate]: value }, bounds, 0, 0))
        .toThrow('Invalid HTML layout bounds or offset.')
    })
  }

  for (const coordinate of ['left', 'top'] as const) {
    it.each([NaN, Infinity, -Infinity])(`rejects nonfinite bounds ${coordinate} %s`, value => {
      expect(() => clampHtmlLayoutImageOffset(start, { ...bounds, [coordinate]: value }, 0, 0))
        .toThrow('Invalid HTML layout bounds or offset.')
    })
  }

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite pointer movement %s', value => {
    expect(() => clampHtmlLayoutImageOffset(start, bounds, value, 0)).toThrow('Invalid HTML layout bounds or offset.')
    expect(() => clampHtmlLayoutImageOffset(start, bounds, 0, value)).toThrow('Invalid HTML layout bounds or offset.')
  })
})

describe('HTML layout image collision movement', () => {
  const bounds = { left: 0, top: 0, width: 200, height: 200 }
  const start = { left: 50, top: 50, width: 20, height: 20, offsetX: 3, offsetY: -4 }
  const movedRectangle = (offset: { offsetX: number; offsetY: number }): HtmlLayoutRectangle => ({
    ...start,
    left: start.left + offset.offsetX - start.offsetX,
    top: start.top + offset.offsetY - start.offsetY
  })

  it.each([
    [{ left: 100, top: 40, width: 30, height: 40 }, 100, 0, { offsetX: 33, offsetY: -4 }],
    [{ left: 10, top: 40, width: 20, height: 40 }, -100, 0, { offsetX: -17, offsetY: -4 }],
    [{ left: 40, top: 10, width: 40, height: 20 }, 0, -100, { offsetX: 3, offsetY: -24 }],
    [{ left: 40, top: 100, width: 40, height: 30 }, 0, 100, { offsetX: 3, offsetY: 26 }]
  ])('stops at obstacle %j for movement (%s, %s)', (obstacle, deltaX, deltaY, expected) => {
    const result = constrainHtmlLayoutImageMove(start, bounds, [obstacle], deltaX, deltaY)
    expect(result).toEqual(expected)
    expect(htmlLayoutRectanglesOverlap(movedRectangle(result), obstacle)).toBe(false)
  })

  it('slides along a vertical image edge when dragging diagonally', () => {
    const obstacle = { left: 100, top: 20, width: 40, height: 160 }
    const result = constrainHtmlLayoutImageMove(start, bounds, [obstacle], 80, 40)
    expect(result).toEqual({ offsetX: 33, offsetY: 36 })
    expect(htmlLayoutRectanglesOverlap(movedRectangle(result), obstacle)).toBe(false)
  })

  it('slides along a horizontal image edge when dragging diagonally', () => {
    const obstacle = { left: 20, top: 100, width: 160, height: 40 }
    const result = constrainHtmlLayoutImageMove(start, bounds, [obstacle], 40, 80)
    expect(result).toEqual({ offsetX: 43, offsetY: 26 })
    expect(htmlLayoutRectanglesOverlap(movedRectangle(result), obstacle)).toBe(false)
  })

  it('slides deterministically along an edge when the path meets an exact corner', () => {
    const obstacle = { left: 100, top: 100, width: 50, height: 50 }
    const result = constrainHtmlLayoutImageMove(start, bounds, [obstacle], 80, 80)
    expect(result).toEqual({ offsetX: 83, offsetY: 26 })
    expect(htmlLayoutRectanglesOverlap(movedRectangle(result), obstacle)).toBe(false)
  })

  it('does not teleport across an image when a fast drag ends beyond it', () => {
    const image = { ...start, left: 10 }
    const obstacle = { left: 100, top: 40, width: 20, height: 40 }
    const result = constrainHtmlLayoutImageMove(image, { ...bounds, width: 1000 }, [obstacle], 500, 0)
    expect(result).toEqual({ offsetX: 73, offsetY: -4 })
  })

  it.each([false, true])('slides into a second blocker independent of obstacle order %s', reverse => {
    const obstacles = [
      { left: 100, top: 20, width: 20, height: 120 },
      { left: 80, top: 120, width: 100, height: 20 }
    ]
    if (reverse) obstacles.reverse()
    const result = constrainHtmlLayoutImageMove(start, bounds, obstacles, 100, 100)
    expect(result).toEqual({ offsetX: 33, offsetY: 46 })
    for (const obstacle of obstacles) expect(htmlLayoutRectanglesOverlap(movedRectangle(result), obstacle)).toBe(false)
  })

  it('stops both axes when different obstacles form a closed corner', () => {
    const obstacles = [
      { left: 100, top: 20, width: 20, height: 80 },
      { left: 20, top: 100, width: 80, height: 20 }
    ]
    expect(constrainHtmlLayoutImageMove(start, bounds, obstacles, 100, 100))
      .toEqual({ offsetX: 33, offsetY: 26 })
  })

  it.each([
    [-30, 0, { offsetX: -27, offsetY: -4 }],
    [0, 50, { offsetX: 3, offsetY: 46 }],
    [20, 0, { offsetX: 3, offsetY: -4 }],
    [20, 30, { offsetX: 3, offsetY: 26 }]
  ])('permits leaving or sliding along an existing contact for movement (%s, %s)', (deltaX, deltaY, expected) => {
    const touching = { ...start, left: 80 }
    const obstacle = { left: 100, top: 20, width: 40, height: 160 }
    expect(constrainHtmlLayoutImageMove(touching, bounds, [obstacle], deltaX, deltaY)).toEqual(expected)
  })

  it('allows a path that only touches a corner at a single instant', () => {
    const image = { ...start, top: 110 }
    const obstacle = { left: 100, top: 100, width: 30, height: 30 }
    expect(constrainHtmlLayoutImageMove(image, bounds, [obstacle], 100, -100))
      .toEqual({ offsetX: 103, offsetY: -104 })
  })

  it('keeps fractional edge contact exact', () => {
    const image = { left: 10.125, top: 20.25, width: 15.5, height: 10.75, offsetX: 3.5, offsetY: -1 }
    const obstacle = { left: 40.875, top: 10, width: 20.125, height: 70 }
    expect(constrainHtmlLayoutImageMove(image, bounds, [obstacle], 100, 0))
      .toEqual({ offsetX: 18.75, offsetY: -1 })
  })

  it('blocks movement deeper into an overlap smaller than the edge tolerance', () => {
    const image = { ...start, left: 80.0005 }
    const obstacle = { left: 100, top: 20, width: 40, height: 160 }
    expect(constrainHtmlLayoutImageMove(image, bounds, [obstacle], 20, 0))
      .toEqual({ offsetX: 3, offsetY: -4 })
  })

  it('slides at an obstacle while retaining the outer boundary limit', () => {
    const image = { left: 80, top: 30, width: 10, height: 10, offsetX: 0, offsetY: 0 }
    const outer = { left: 10, top: 20, width: 100, height: 90 }
    const obstacle = { left: 90, top: 55, width: 20, height: 30 }
    const result = constrainHtmlLayoutImageMove(image, outer, [obstacle], 100, 100)
    expect(result.offsetX).toBeCloseTo(20, 10)
    expect(result.offsetY).toBeCloseTo(15, 10)
    const moved = { ...image, left: image.left + result.offsetX, top: image.top + result.offsetY }
    expect(moved.left + moved.width).toBeLessThanOrEqual(outer.left + outer.width)
    expect(htmlLayoutRectanglesOverlap(moved, obstacle)).toBe(false)
  })

  it('allows a legacy overlap to be repaired, then blocks reentry on the next incremental call', () => {
    const obstacle = { left: 60, top: 50, width: 20, height: 20 }
    const repaired = constrainHtmlLayoutImageMove(start, bounds, [obstacle], -30, 0)
    expect(repaired).toEqual({ offsetX: -27, offsetY: -4 })
    const current = { ...movedRectangle(repaired), ...repaired }
    const reentry = constrainHtmlLayoutImageMove(current, bounds, [obstacle], 100, 0)
    expect(reentry).toEqual({ offsetX: -7, offsetY: -4 })
  })

  it('matches ordinary boundary movement when there are no obstacles', () => {
    expect(constrainHtmlLayoutImageMove(start, bounds, [], 1000, -1000))
      .toEqual(clampHtmlLayoutImageOffset(start, bounds, 1000, -1000))
  })

  it('retains zero movement and leaves input geometry unchanged', () => {
    const obstacle = { left: 100, top: 40, width: 30, height: 40 }
    const original = { ...obstacle }
    expect(constrainHtmlLayoutImageMove(start, bounds, [obstacle], 0, 0))
      .toEqual({ offsetX: 3, offsetY: -4 })
    expect(obstacle).toEqual(original)
    expect(start).toEqual({ left: 50, top: 50, width: 20, height: 20, offsetX: 3, offsetY: -4 })
  })

  for (const dimension of ['width', 'height'] as const) {
    it.each([0, -1, NaN, Infinity, -Infinity])(`rejects invalid obstacle ${dimension} %s`, value => {
      const obstacle = { left: 100, top: 40, width: 30, height: 40, [dimension]: value }
      expect(() => constrainHtmlLayoutImageMove(start, bounds, [obstacle], 0, 0)).toThrow('Invalid HTML layout collision')
    })
  }

  for (const coordinate of ['left', 'top'] as const) {
    it.each([NaN, Infinity, -Infinity])(`rejects nonfinite obstacle ${coordinate} %s`, value => {
      const obstacle = { left: 100, top: 40, width: 30, height: 40, [coordinate]: value }
      expect(() => constrainHtmlLayoutImageMove(start, bounds, [obstacle], 0, 0)).toThrow('Invalid HTML layout collision')
    })
  }

  it('validates start, outer bounds and movement before collision sweeping', () => {
    expect(() => constrainHtmlLayoutImageMove({ ...start, left: Infinity }, bounds, [], 0, 0)).toThrow('Invalid HTML layout bounds')
    expect(() => constrainHtmlLayoutImageMove(start, { ...bounds, width: 0 }, [], 0, 0)).toThrow('Invalid HTML layout bounds')
    expect(() => constrainHtmlLayoutImageMove(start, bounds, [], NaN, 0)).toThrow('Invalid HTML layout bounds')
    expect(() => constrainHtmlLayoutImageMove(start, bounds, [], 0, Infinity)).toThrow('Invalid HTML layout bounds')
  })
})

describe('HTML layout image overlap detection', () => {
  const image = { left: 10, top: 20, width: 30, height: 40 }

  it.each([
    { left: 40, top: 20, width: 30, height: 40 },
    { left: -20, top: 20, width: 30, height: 40 },
    { left: 10, top: 60, width: 30, height: 40 },
    { left: 10, top: -20, width: 30, height: 40 },
    { left: 40, top: 60, width: 30, height: 40 }
  ])('permits touching rectangle %j', other => {
    expect(htmlLayoutRectanglesOverlap(image, other)).toBe(false)
  })

  it('detects positive overlap symmetrically while accepting the edge tolerance', () => {
    const overlapping = { left: 39.99, top: 20, width: 30, height: 40 }
    expect(htmlLayoutRectanglesOverlap(image, overlapping)).toBe(true)
    expect(htmlLayoutRectanglesOverlap(overlapping, image)).toBe(true)
    expect(htmlLayoutRectanglesOverlap(image, { ...overlapping, left: 39.9995 })).toBe(false)
    expect(htmlLayoutRectanglesOverlap(image, { ...overlapping, left: 39.9995 }, 0)).toBe(true)
  })

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid overlap tolerance %s', tolerance => {
    expect(() => htmlLayoutRectanglesOverlap(image, image, tolerance)).toThrow('Invalid HTML layout collision')
  })

  it('rejects invalid rectangles in either argument', () => {
    expect(() => htmlLayoutRectanglesOverlap({ ...image, width: 0 }, image)).toThrow('Invalid HTML layout collision')
    expect(() => htmlLayoutRectanglesOverlap(image, { ...image, top: NaN })).toThrow('Invalid HTML layout collision')
  })
})
