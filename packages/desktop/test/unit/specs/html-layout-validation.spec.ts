import { describe, expect, it } from 'vitest'
import { findHtmlLayoutImageOverlaps } from '@/util/htmlLayoutValidation'
import type { HtmlLayoutMeasuredImage } from '@/util/htmlLayoutValidation'
import type { HtmlLayoutRectangle } from '@/util/htmlLayoutBounds'

const image = (id: string, rectangle: Partial<HtmlLayoutRectangle> = {}): HtmlLayoutMeasuredImage => ({
  id,
  label: `图片 ${id}`,
  rectangle: { left: 0, top: 0, width: 100, height: 50, ...rectangle }
})

const pairIds = (images: readonly HtmlLayoutMeasuredImage[], tolerance?: number): string[][] =>
  findHtmlLayoutImageOverlaps(images, tolerance).map(pair => [pair.first.id, pair.second.id])

describe('HTML image overlap validation before applying a layout', () => {
  it('allows a layout without images and a single image', () => {
    expect(findHtmlLayoutImageOverlaps([])).toEqual([])
    expect(findHtmlLayoutImageOverlaps([image('1')])).toEqual([])
  })

  it.each([
    { left: 100 },
    { left: -100 },
    { top: 50 },
    { top: -50 },
    { left: 100, top: 50 },
    { left: -100, top: -50 },
    { left: 140, top: 10 },
    { left: 20, top: 80 }
  ])('allows side or corner contact and separated images at %j', rectangle => {
    expect(pairIds([image('1'), image('2', rectangle)])).toEqual([])
  })

  it.each([
    { left: 99, top: 49 },
    { left: -99, top: -49 },
    { left: 20, top: 10, width: 10, height: 5 },
    { left: -10, top: -10, width: 130, height: 70 },
    { left: 0, top: 0 }
  ])('reports partial, contained and identical image boxes at %j', rectangle => {
    expect(pairIds([image('1'), image('2', rectangle)])).toEqual([['1', '2']])
  })

  it('reports every conflicting pair in stable image order for useful feedback', () => {
    const images = [image('3'), image('1', { left: 30 }), image('2', { left: 60 }), image('4', { left: 300 })]
    const original = structuredClone(images)
    const overlaps = findHtmlLayoutImageOverlaps(images)
    expect(overlaps.map(pair => [pair.first.id, pair.second.id])).toEqual([['3', '1'], ['3', '2'], ['1', '2']])
    expect(overlaps[0]?.first).toBe(images[0])
    expect(overlaps[0]?.second).toBe(images[1])
    expect(overlaps[0]?.first.label).toBe('图片 3')
    expect(images).toEqual(original)
  })

  it('accepts swapped final positions after an overlapping intermediate placement', () => {
    const first = image('1')
    const second = image('2', { left: 120 })
    expect(pairIds([first, second])).toEqual([])
    first.rectangle.left = 80
    expect(pairIds([first, second])).toEqual([['1', '2']])
    second.rectangle.left = 0
    first.rectangle.left = 120
    expect(pairIds([first, second])).toEqual([])
  })

  it('detects an image enlarged into a neighbor even when its position stays the same', () => {
    const first = image('1')
    const second = image('2', { left: 120 })
    expect(pairIds([first, second])).toEqual([])
    first.rectangle.width = 121
    expect(pairIds([first, second])).toEqual([['1', '2']])
  })

  it('does not round a real fractional overlap into apparent edge contact', () => {
    expect(pairIds([image('1'), image('2', { left: 99.9 })])).toEqual([['1', '2']])
    expect(pairIds([image('1'), image('2', { top: 49.9 })])).toEqual([['1', '2']])
  })

  it('allows only subpixel measurement noise within the default tolerance', () => {
    expect(pairIds([image('1'), image('2', { left: 99.9995 })])).toEqual([])
    expect(pairIds([image('1'), image('2', { top: 49.9995 })])).toEqual([])
    expect(pairIds([image('1'), image('2', { left: 99.998 })])).toEqual([['1', '2']])
  })

  it('requires overlap deeper than the tolerance on both axes', () => {
    expect(pairIds([image('1'), image('2', { left: 99.9, top: 49.6 })], 0.25)).toEqual([])
    expect(pairIds([image('1'), image('2', { left: 99.6, top: 49.6 })], 0.25)).toEqual([['1', '2']])
    expect(pairIds([image('1'), image('2', { left: 99.9995 })], 0)).toEqual([['1', '2']])
  })

  it.each([
    { width: 0 },
    { height: 0 },
    { width: 0, height: 0 }
  ])('ignores unrendered zero-size image geometry %j', rectangle => {
    expect(pairIds([image('1'), image('hidden', rectangle), image('2', { left: 120 })])).toEqual([])
  })

  for (const coordinate of ['left', 'top', 'width', 'height'] as const) {
    it.each([NaN, Infinity, -Infinity])(`rejects nonfinite ${coordinate} %s instead of reporting a safe layout`, value => {
      expect(() => findHtmlLayoutImageOverlaps([image('1', { [coordinate]: value })]))
        .toThrow('Invalid HTML layout image geometry.')
    })
  }

  it.each([{ width: -1 }, { height: -1 }])('rejects negative image dimensions %j', rectangle => {
    expect(() => findHtmlLayoutImageOverlaps([image('1', rectangle)]))
      .toThrow('Invalid HTML layout image geometry.')
  })

  it('rejects finite values whose computed edge overflows the coordinate space', () => {
    expect(() => findHtmlLayoutImageOverlaps([image('1', { left: Number.MAX_VALUE, width: Number.MAX_VALUE })]))
      .toThrow('Invalid HTML layout image geometry.')
  })

  it('rejects duplicate image identifiers so conflict highlights cannot name the wrong image', () => {
    expect(() => findHtmlLayoutImageOverlaps([image('1'), image('1', { left: 120 })]))
      .toThrow('Duplicate HTML layout image identifier.')
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid overlap tolerance %s even for an empty layout', tolerance => {
    expect(() => findHtmlLayoutImageOverlaps([], tolerance)).toThrow('Invalid HTML layout overlap tolerance.')
  })
})
