import { describe, expect, it } from 'vitest'
import { previewHtmlLayoutImageSnap, snapHtmlLayoutImage, type HtmlLayoutSnapImage } from '@/util/htmlLayoutSnapping'
import { htmlLayoutRectanglesOverlap, type HtmlLayoutRectangle } from '@/util/htmlLayoutBounds'

const bounds = { left: 0, top: 0, width: 800, height: 600 }
const neighbor: HtmlLayoutSnapImage = { id: 'neighbor', rectangle: { left: 300, top: 100, width: 120, height: 160 } }
const rectangle = (changes: Partial<HtmlLayoutRectangle> = {}): HtmlLayoutRectangle => ({ left: 424, top: 175, width: 80, height: 90, ...changes })

describe('HTML image release snapping preview', () => {
  it('keeps the dragged image under the pointer while suggesting precise edge contact on release', () => {
    const requested = rectangle()
    const original = structuredClone({ requested, bounds, neighbor })
    const result = previewHtmlLayoutImageSnap(requested, bounds, [neighbor])
    expect(result.rectangle).toEqual(requested)
    expect(result.snapRectangle).toEqual(rectangle({ left: 420, top: 170 }))
    expect(result.guides.map(guide => guide.label)).toEqual(['左边贴右边', '底边对齐'])
    expect(htmlLayoutRectanglesOverlap(result.snapRectangle, neighbor.rectangle, 0)).toBe(false)
    expect({ requested, bounds, neighbor }).toEqual(original)
  })

  it.each([
    ['x', -1, { left: 0.25, top: 80, width: 40, height: 40 }, { left: 6, top: 80, width: 40, height: 40 }],
    ['x', 1, { left: 159.75, top: 80, width: 40, height: 40 }, { left: 154, top: 80, width: 40, height: 40 }],
    ['y', -1, { left: 80, top: 0.25, width: 40, height: 40 }, { left: 80, top: 6, width: 40, height: 40 }],
    ['y', 1, { left: 80, top: 159.75, width: 40, height: 40 }, { left: 80, top: 154, width: 40, height: 40 }]
  ] as const)('follows every pointer sample exactly toward and away from the %s frame edge in direction %s', (axis, direction, adjacentRectangle, start) => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const adjacent = { id: 'adjacent', rectangle: adjacentRectangle }
    let previousPosition: number | undefined
    let previousDistance: number | undefined
    for (const distance of [-10, -5, 0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 20, 40, 80, 40, 20, 14, 12, 10, 8, 6, 4, 3, 2, 1, 0, -5, -10]) {
      const requested = axis === 'x' ? { ...start, left: start.left + distance * direction } : { ...start, top: start.top + distance * direction }
      const result = previewHtmlLayoutImageSnap(requested, frame, [adjacent])
      const position = axis === 'x' ? result.rectangle.left : result.rectangle.top
      const rawPosition = axis === 'x' ? requested.left : requested.top
      expect(result.rectangle).toEqual({ ...requested, [axis === 'x' ? 'left' : 'top']: Math.max(0, Math.min(160, rawPosition)) })
      if (previousPosition !== undefined && previousDistance !== undefined) {
        expect(Math.abs(position - previousPosition)).toBeLessThanOrEqual(Math.abs(distance - previousDistance))
      }
      expect(Math.abs(result.snapRectangle.left - result.rectangle.left)).toBeLessThanOrEqual(8)
      expect(Math.abs(result.snapRectangle.top - result.rectangle.top)).toBeLessThanOrEqual(8)
      previousPosition = position
      previousDistance = distance
    }
  })

  it.each([8, 8.0001, 11, 13])('uses only the fresh eight-pixel release threshold at a side gap of %s', distance => {
    const requested = rectangle({ left: 420 + distance })
    const result = previewHtmlLayoutImageSnap(requested, bounds, [neighbor])
    expect(result.rectangle).toEqual(requested)
    expect(result.snapRectangle.left).toBe(distance <= 8 ? 420 : requested.left)
    expect(result.guides.some(guide => guide.axis === 'x')).toBe(distance <= 8)
  })

  it('keeps a vertical drag exact when two neighbors enter and leave the candidate range', () => {
    const frame = { left: 0, top: 0, width: 300, height: 250 }
    const images = [
      { id: 'lower-right', rectangle: { left: 172, top: 100, width: 35, height: 44 } },
      { id: 'upper-right', rectangle: { left: 70, top: 30, width: 55, height: 60 } }
    ]
    const trajectory = Array.from({ length: 96 }, (_, index) => 60 + index)
    for (const top of [...trajectory, ...[...trajectory].reverse()]) {
      const requested = { left: 30, top, width: 90, height: 90 }
      const result = previewHtmlLayoutImageSnap(requested, frame, images)
      expect(result.rectangle).toEqual(requested)
      expect(Math.abs(result.snapRectangle.left - result.rectangle.left)).toBeLessThanOrEqual(8)
      expect(Math.abs(result.snapRectangle.top - result.rectangle.top)).toBeLessThanOrEqual(8)
    }
  })

  it('never retains an earlier candidate or carries it into a restarted drag', () => {
    const first = previewHtmlLayoutImageSnap(rectangle(), bounds, [neighbor])
    const departed = previewHtmlLayoutImageSnap(rectangle({ left: 431, top: 183 }), bounds, [neighbor])
    expect(departed.rectangle).toEqual(rectangle({ left: 431, top: 183 }))
    expect(departed.snapRectangle).toEqual(departed.rectangle)
    expect(departed.guides).toEqual([])
    expect(previewHtmlLayoutImageSnap(rectangle(), bounds, [neighbor])).toEqual(first)
  })

  it('has zero release displacement for an already aligned image', () => {
    const requested = rectangle({ left: 420, top: 170 })
    const result = previewHtmlLayoutImageSnap(requested, bounds, [neighbor])
    expect(result.rectangle).toEqual(requested)
    expect(result.snapRectangle).toEqual(requested)
    expect(result.guides.map(guide => guide.label)).toEqual(['左边贴右边', '底边对齐'])
  })

  it('spans candidate guides from the actual image instead of the predicted release position', () => {
    const result = previewHtmlLayoutImageSnap(rectangle(), bounds, [neighbor])
    expect(result.guides.find(guide => guide.axis === 'x')).toMatchObject({ position: 420, start: 100, end: 265 })
    expect(result.guides.find(guide => guide.axis === 'y')).toMatchObject({ position: 260, start: 300, end: 504 })
  })

  it.each([
    [{ left: 80, top: -30, width: 40, height: 80 }, { left: 84, top: 60, width: 40, height: 40 }, 'x', 0, 100],
    [{ left: 80, top: 150, width: 40, height: 80 }, { left: 84, top: 90, width: 40, height: 40 }, 'x', 90, 200],
    [{ left: -30, top: 80, width: 80, height: 40 }, { left: 60, top: 84, width: 40, height: 40 }, 'y', 0, 100],
    [{ left: 150, top: 80, width: 80, height: 40 }, { left: 90, top: 84, width: 40, height: 40 }, 'y', 90, 200]
  ] as const)('clips the %s candidate guide to the frame beside a partially outside neighbor', (adjacentRectangle, moving, axis, spanStart, spanEnd) => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const result = previewHtmlLayoutImageSnap(moving, frame, [{ id: 'outside', rectangle: adjacentRectangle }])
    expect(result.rectangle).toEqual(moving)
    expect(result.guides.find(guide => guide.axis === axis)).toMatchObject({ targetId: 'outside', start: spanStart, end: spanEnd })
    for (const guide of result.guides) {
      expect(guide.position).toBeGreaterThanOrEqual(0)
      expect(guide.position).toBeLessThanOrEqual(200)
      expect(guide.start).toBeGreaterThanOrEqual(0)
      expect(guide.end).toBeLessThanOrEqual(200)
    }
  })

  it('does not suggest a neighboring capture from raw intent far beyond the frame', () => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const adjacent = { id: 'adjacent', rectangle: { left: 0.25, top: 80, width: 40, height: 40 } }
    const result = previewHtmlLayoutImageSnap({ left: -50, top: 80, width: 40, height: 40 }, frame, [adjacent])
    expect(result.rectangle.left).toBe(0)
    expect(result.snapRectangle.left).toBe(0)
    expect(result.guides.find(guide => guide.axis === 'x')?.kind).toBe('frame')
  })

  it('keeps fractional frame coordinates and free movement without rounding', () => {
    const frame = { left: 12.25, top: -8.75, width: 600.5, height: 400.5 }
    const requested = rectangle({ left: 15.125, top: 300.375 })
    const result = previewHtmlLayoutImageSnap(requested, frame, [])
    expect(result.rectangle).toEqual(requested)
    expect(result.snapRectangle).toEqual({ ...requested, left: 12.25, top: 301.75 })
  })

  it('uses a configured release threshold without changing the dragged position', () => {
    const requested = rectangle()
    const result = previewHtmlLayoutImageSnap(requested, bounds, [neighbor], { threshold: 3 })
    expect(result.rectangle).toEqual(requested)
    expect(result.snapRectangle).toEqual(requested)
    expect(result.guides).toEqual([])
  })

  it('disables candidates while keeping the image inside the frame', () => {
    const requested = rectangle({ left: -20, top: 590 })
    const result = previewHtmlLayoutImageSnap(requested, bounds, [neighbor], { enabled: false })
    expect(result.rectangle).toEqual(rectangle({ left: 0, top: 510 }))
    expect(result.snapRectangle).toEqual(result.rectangle)
    expect(result.guides).toEqual([])
  })
})

describe('HTML image edge snapping', () => {
  it('places different-height neighbors at exact side contact and bottom alignment', () => {
    const result = snapHtmlLayoutImage(rectangle(), bounds, [neighbor])
    expect(result.rectangle).toEqual(rectangle({ left: 420, top: 170 }))
    expect(result.guides.map(guide => guide.label)).toEqual(['左边贴右边', '底边对齐'])
    expect(htmlLayoutRectanglesOverlap(result.rectangle, neighbor.rectangle)).toBe(false)
  })

  it('chooses the top instead of the bottom when the top is nearer', () => {
    const result = snapHtmlLayoutImage(rectangle({ top: 104 }), bounds, [neighbor])
    expect(result.rectangle.top).toBe(100)
    expect(result.guides.find(guide => guide.axis === 'y')?.edge).toBe('top')
    expect(result.guides.find(guide => guide.axis === 'y')?.label).toBe('顶边对齐')
  })

  it('uses a center line only when no edge is nearly as close', () => {
    const result = snapHtmlLayoutImage(rectangle({ top: 138 }), bounds, [neighbor])
    expect(result.rectangle.top).toBe(135)
    expect(result.guides.find(guide => guide.axis === 'y')?.edge).toBe('center-y')
  })

  it('prefers a nearby bottom edge over an almost tied center of another image', () => {
    const another: HtmlLayoutSnapImage = { id: 'another', rectangle: { left: 500, top: 153.4, width: 60, height: 140 } }
    const result = snapHtmlLayoutImage(rectangle({ top: 174.4 }), bounds, [neighbor, another])
    expect(result.guides.find(guide => guide.axis === 'y')?.edge).toBe('bottom')
    expect(result.rectangle.top).toBeCloseTo(170)
  })

  it.each([
    [{ left: 217, top: 160 }, 'x', 'right', 'left', 220],
    [{ left: 424, top: 160 }, 'x', 'left', 'right', 420],
    [{ left: 340, top: 7 }, 'y', 'bottom', 'top', 10],
    [{ left: 340, top: 265 }, 'y', 'top', 'bottom', 260]
  ] as const)('snaps each contacting side %j', (changes, axis, edge, targetEdge, position) => {
    const result = snapHtmlLayoutImage(rectangle(changes), bounds, [neighbor])
    const guide = result.guides.find(item => item.axis === axis)
    expect(guide?.kind).toBe('contact')
    expect(guide?.edge).toBe(edge)
    expect(guide?.targetEdge).toBe(targetEdge)
    expect(axis === 'x' ? result.rectangle.left : result.rectangle.top).toBe(position)
    expect(htmlLayoutRectanglesOverlap(result.rectangle, neighbor.rectangle)).toBe(false)
  })

  it.each([
    [{ left: 5, top: 180 }, 'x', 'left', 0],
    [{ left: 715, top: 180 }, 'x', 'right', 720],
    [{ left: 180, top: 5 }, 'y', 'top', 0],
    [{ left: 180, top: 505 }, 'y', 'bottom', 510]
  ] as const)('snaps each HTML inner boundary %j', (changes, axis, edge, position) => {
    const result = snapHtmlLayoutImage(rectangle(changes), bounds, [])
    const guide = result.guides.find(item => item.axis === axis)
    expect(guide?.kind).toBe('frame')
    expect(guide?.edge).toBe(edge)
    expect(guide?.targetId).toBeNull()
    expect(axis === 'x' ? result.rectangle.left : result.rectangle.top).toBe(position)
  })

  it('uses a translated inner frame coordinate space without rounding', () => {
    const inner = { left: 12.25, top: -8.75, width: 600.5, height: 400.5 }
    const result = snapHtmlLayoutImage(rectangle({ left: 15, top: 302 }), inner, [])
    expect(result.rectangle.left).toBe(12.25)
    expect(result.rectangle.top + result.rectangle.height).toBe(391.75)
  })

  it('retains subpixel edge contact so overlap validation accepts the final layout', () => {
    const fractional = { id: 'fractional', rectangle: { left: 300.125, top: 100.375, width: 120.375, height: 160.375 } }
    const result = snapHtmlLayoutImage(rectangle({ left: 425.1, top: 175.1 }), bounds, [fractional])
    expect(result.rectangle.left).toBe(420.5)
    expect(result.rectangle.top).toBe(170.75)
    expect(htmlLayoutRectanglesOverlap(result.rectangle, fractional.rectangle, 0)).toBe(false)
  })

  it('keeps intended deep overlap while images are being exchanged', () => {
    const requested = rectangle({ left: 340, top: 170 })
    const result = snapHtmlLayoutImage(requested, bounds, [neighbor])
    expect(result.rectangle.left).toBe(340)
    expect(htmlLayoutRectanglesOverlap(result.rectangle, neighbor.rectangle)).toBe(true)
  })

  it('leaves a gap beyond the capture threshold untouched', () => {
    const requested = rectangle({ left: 429, top: 175 })
    expect(snapHtmlLayoutImage(requested, bounds, [neighbor]).rectangle.left).toBe(429)
  })

  it('captures at the threshold and refuses to pull at a greater distance', () => {
    expect(snapHtmlLayoutImage(rectangle({ left: 428 }), bounds, [neighbor]).rectangle.left).toBe(420)
    expect(snapHtmlLayoutImage(rectangle({ left: 428.01 }), bounds, [neighbor]).rectangle.left).toBe(428.01)
  })

  it('does not align distant images even when their edges share the same coordinate', () => {
    const remote = { id: 'remote', rectangle: { left: 424, top: 440, width: 120, height: 100 } }
    const requested = rectangle({ top: 180 })
    const result = snapHtmlLayoutImage(requested, bounds, [remote])
    expect(result.rectangle).toEqual(requested)
    expect(result.guides).toEqual([])
  })

  it('does not teleport to a closer edge hundreds of pixels away', () => {
    const requested = rectangle({ left: 600, top: 380 })
    const result = snapHtmlLayoutImage(requested, bounds, [neighbor])
    expect(result.rectangle).toEqual(requested)
    expect(result.state).toEqual({})
  })

  it('holds a captured edge between capture and release thresholds', () => {
    const capture = snapHtmlLayoutImage(rectangle(), bounds, [neighbor])
    const retained = snapHtmlLayoutImage(rectangle({ left: 431, top: 181 }), bounds, [neighbor], capture.state)
    expect(retained.rectangle).toEqual(rectangle({ left: 420, top: 170 }))
    expect(retained.state).toEqual(capture.state)
    const released = snapHtmlLayoutImage(rectangle({ left: 433, top: 183 }), bounds, [neighbor], retained.state)
    expect(released.rectangle).toEqual(rectangle({ left: 433, top: 183 }))
    expect(released.guides).toEqual([])
  })

  it('releases a captured bottom beside the frame when the raw pointer passes its release distance', () => {
    const frame = { left: 0, top: 0, width: 650, height: 154 }
    const adjacent = { id: 'adjacent', rectangle: { left: 0, top: 0.927, width: 180, height: 145.073 } }
    const image = { left: 160, top: 35.698, width: 168, height: 110.302 }
    const captured = snapHtmlLayoutImage(image, frame, [adjacent])
    expect(captured.rectangle.top + captured.rectangle.height).toBe(146)
    expect(captured.guides.find(guide => guide.axis === 'y')?.targetId).toBe('adjacent')

    const released = snapHtmlLayoutImage({ ...image, top: 135.698 }, frame, [adjacent], captured.state)
    expect(released.rectangle.top + released.rectangle.height).toBe(154)
    expect(released.guides.find(guide => guide.axis === 'y')?.targetId).toBeNull()
  })

  it.each([
    [{ left: 8, top: 100, width: 40, height: 40 }, { left: 9, top: 100, width: 40, height: 40 }, { left: -90 }, 'x', 0],
    [{ left: 152, top: 100, width: 40, height: 40 }, { left: 151, top: 100, width: 40, height: 40 }, { left: 250 }, 'x', 160],
    [{ left: 100, top: 8, width: 40, height: 40 }, { left: 100, top: 9, width: 40, height: 40 }, { top: -90 }, 'y', 0],
    [{ left: 100, top: 152, width: 40, height: 40 }, { left: 100, top: 151, width: 40, height: 40 }, { top: 250 }, 'y', 160]
  ] as const)('can leave neighboring capture for each frame edge %j', (neighborRectangle, moving, movement, axis, position) => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const adjacent = { id: 'adjacent', rectangle: neighborRectangle }
    const captured = snapHtmlLayoutImage(moving, frame, [adjacent])
    expect(captured.guides.find(guide => guide.axis === axis)?.targetId).toBe('adjacent')
    const released = snapHtmlLayoutImage({ ...moving, ...movement }, frame, [adjacent], captured.state)
    expect(axis === 'x' ? released.rectangle.left : released.rectangle.top).toBe(position)
    expect(released.guides.find(guide => guide.axis === axis)?.targetId).toBeNull()
  })

  it.each([
    ['x', -1, { left: 0.25, top: 80, width: 40, height: 40 }, { left: 6, top: 80, width: 40, height: 40 }],
    ['x', 1, { left: 159.75, top: 80, width: 40, height: 40 }, { left: 154, top: 80, width: 40, height: 40 }],
    ['y', -1, { left: 80, top: 0.25, width: 40, height: 40 }, { left: 80, top: 6, width: 40, height: 40 }],
    ['y', 1, { left: 80, top: 159.75, width: 40, height: 40 }, { left: 80, top: 154, width: 40, height: 40 }]
  ] as const)('moves continuously toward the %s frame edge in direction %s without recapturing a departed neighbor', (axis, direction, adjacentRectangle, start) => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const adjacent = { id: 'adjacent', rectangle: adjacentRectangle }
    const captured = snapHtmlLayoutImage(start, frame, [adjacent])
    expect(captured.guides.find(guide => guide.axis === axis)?.targetId).toBe('adjacent')
    let previous = captured
    for (const distance of [2, 6, 10, 14, 18, 24, 40, 80]) {
      const requested = axis === 'x' ? { ...start, left: start.left + distance * direction } : { ...start, top: start.top + distance * direction }
      const current = snapHtmlLayoutImage(requested, frame, [adjacent], previous.state)
      const position = axis === 'x' ? current.rectangle.left : current.rectangle.top
      const previousPosition = axis === 'x' ? previous.rectangle.left : previous.rectangle.top
      expect((position - previousPosition) * direction).toBeGreaterThanOrEqual(0)
      expect(position).toBeGreaterThanOrEqual(0)
      expect(position + 40).toBeLessThanOrEqual(200)
      if (distance >= 24) {
        expect(position).toBe(direction < 0 ? 0 : 160)
        expect(current.guides.find(guide => guide.axis === axis)?.targetId).toBeNull()
      }
      previous = current
    }
  })

  it('does not create a new neighboring capture from a pointer position far outside the frame', () => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const adjacent = { id: 'adjacent', rectangle: { left: 0.25, top: 80, width: 40, height: 40 } }
    const result = snapHtmlLayoutImage({ left: -50, top: 80, width: 40, height: 40 }, frame, [adjacent])
    expect(result.rectangle.left).toBe(0)
    expect(result.guides.find(guide => guide.axis === 'x')?.kind).toBe('frame')
  })

  it.each([
    [{ left: 80, top: -30, width: 40, height: 80 }, { left: 80, top: 60, width: 40, height: 40 }, 'x', 0, 100],
    [{ left: 80, top: 150, width: 40, height: 80 }, { left: 80, top: 90, width: 40, height: 40 }, 'x', 90, 200],
    [{ left: -30, top: 80, width: 80, height: 40 }, { left: 60, top: 80, width: 40, height: 40 }, 'y', 0, 100],
    [{ left: 150, top: 80, width: 80, height: 40 }, { left: 90, top: 80, width: 40, height: 40 }, 'y', 90, 200]
  ] as const)('clips the %s guide span to the frame for a partially outside neighboring image', (adjacentRectangle, moving, axis, spanStart, spanEnd) => {
    const frame = { left: 0, top: 0, width: 200, height: 200 }
    const result = snapHtmlLayoutImage(moving, frame, [{ id: 'outside', rectangle: adjacentRectangle }])
    expect(result.guides.find(guide => guide.axis === axis)).toMatchObject({ targetId: 'outside', start: spanStart, end: spanEnd })
    for (const guide of result.guides) {
      expect(guide.position).toBeGreaterThanOrEqual(0)
      expect(guide.position).toBeLessThanOrEqual(200)
      expect(guide.start).toBeGreaterThanOrEqual(0)
      expect(guide.end).toBeLessThanOrEqual(200)
      const positions = {
        left: result.rectangle.left,
        right: result.rectangle.left + result.rectangle.width,
        top: result.rectangle.top,
        bottom: result.rectangle.top + result.rectangle.height,
        'center-x': result.rectangle.left + result.rectangle.width / 2,
        'center-y': result.rectangle.top + result.rectangle.height / 2
      }
      expect(guide.position).toBe(positions[guide.edge])
    }
  })

  it('retains the captured intent while another edge becomes marginally closer', () => {
    const first = { id: 'first', rectangle: { left: 300, top: 100, width: 120, height: 160 } }
    const second = { id: 'second', rectangle: { left: 300, top: 106, width: 120, height: 160 } }
    const captured = snapHtmlLayoutImage(rectangle({ top: 171 }), bounds, [first, second])
    const retained = snapHtmlLayoutImage(rectangle({ top: 175 }), bounds, [first, second], captured.state)
    expect(retained.rectangle.top).toBe(170)
    expect(retained.guides.find(guide => guide.axis === 'y')?.targetId).toBe('first')
  })

  it('releases a captured center when a near-height image is moved toward its bottom edge', () => {
    const nearlyEqualHeight = { id: 'near-height', rectangle: { left: 300, top: 100, width: 120, height: 100 } }
    const captured = snapHtmlLayoutImage(rectangle({ top: 105 }), bounds, [nearlyEqualHeight])
    expect(captured.guides.find(guide => guide.axis === 'y')?.edge).toBe('center-y')
    const result = snapHtmlLayoutImage(rectangle({ top: 110 }), bounds, [nearlyEqualHeight], captured.state)
    expect(result.rectangle.top).toBe(110)
    expect(result.guides.find(guide => guide.axis === 'y')?.edge).toBe('bottom')
    expect(result.rectangle.top + result.rectangle.height).toBe(200)
  })

  it('keeps a captured bottom stable when the nearby center becomes closer', () => {
    const nearlyEqualHeight = { id: 'near-height', rectangle: { left: 300, top: 100, width: 120, height: 100 } }
    const captured = snapHtmlLayoutImage(rectangle({ top: 110 }), bounds, [nearlyEqualHeight])
    const result = snapHtmlLayoutImage(rectangle({ top: 105 }), bounds, [nearlyEqualHeight], captured.state)
    expect(result.rectangle.top).toBe(110)
    expect(result.guides.find(guide => guide.axis === 'y')?.edge).toBe('bottom')
  })

  it('releases a captured image when its orthogonal distance is no longer local', () => {
    const captured = snapHtmlLayoutImage(rectangle(), bounds, [neighbor])
    const result = snapHtmlLayoutImage(rectangle({ left: 424, top: 400 }), bounds, [neighbor], captured.state)
    expect(result.rectangle.left).toBe(424)
    expect(result.guides).toEqual([])
  })

  it('clears capture and guides when snapping is bypassed', () => {
    const requested = rectangle()
    const captured = snapHtmlLayoutImage(requested, bounds, [neighbor])
    const result = snapHtmlLayoutImage(requested, bounds, [neighbor], captured.state, { enabled: false })
    expect(result.rectangle).toEqual(requested)
    expect(result.guides).toEqual([])
    expect(result.state).toEqual({})
  })

  it('enforces bounds even while snapping is bypassed', () => {
    const result = snapHtmlLayoutImage(rectangle({ left: -20, top: 590 }), bounds, [], {}, { enabled: false })
    expect(result.rectangle).toEqual(rectangle({ left: 0, top: 510 }))
  })

  it('cannot snap to an image edge outside the HTML frame', () => {
    const outside = { id: 'outside', rectangle: { left: -10, top: 180, width: 1, height: 90 } }
    const result = snapHtmlLayoutImage(rectangle({ left: 1, top: 180 }), bounds, [outside])
    expect(result.rectangle.left).toBe(0)
    expect(result.guides.find(guide => guide.axis === 'x')?.kind).toBe('frame')
  })

  it('anchors oversized images instead of pretending two opposing frame edges fit', () => {
    const result = snapHtmlLayoutImage(rectangle({ width: 900, height: 700 }), bounds, [neighbor])
    expect(result.rectangle.left).toBe(0)
    expect(result.rectangle.top).toBe(0)
    expect(result.guides).toEqual([])
  })

  it('lets callers configure capture, release and neighbor distance in CSS pixels', () => {
    const narrow = snapHtmlLayoutImage(rectangle(), bounds, [neighbor], {}, { threshold: 3, releaseThreshold: 6 })
    expect(narrow.rectangle).toEqual(rectangle())
    const far = { id: 'far', rectangle: { left: 420, top: 350, width: 120, height: 100 } }
    expect(snapHtmlLayoutImage(rectangle(), bounds, [far], {}, { neighborDistance: 100 }).rectangle.left).toBe(420)
  })

  it('returns stable target identities and guide segments without changing caller data', () => {
    const requested = rectangle()
    const original = structuredClone({ requested, bounds, neighbor })
    const result = snapHtmlLayoutImage(requested, bounds, [neighbor])
    expect(result.guides.every(guide => guide.targetId === 'neighbor')).toBe(true)
    expect(result.guides.find(guide => guide.axis === 'y')).toMatchObject({ position: 260, start: 300, end: 500 })
    expect({ requested, bounds, neighbor }).toEqual(original)
    expect(snapHtmlLayoutImage(requested, bounds, [neighbor]).state).toEqual(result.state)
  })

  it('chooses the same target regardless of input ordering when all distances tie', () => {
    const other = { ...neighbor, id: 'another' }
    expect(snapHtmlLayoutImage(rectangle(), bounds, [neighbor, other]).state)
      .toEqual(snapHtmlLayoutImage(rectangle(), bounds, [other, neighbor]).state)
  })

  it.each([
    { left: NaN }, { top: Infinity }, { width: 0 }, { height: -1 }, { width: Infinity }
  ])('rejects invalid moving geometry %j', invalid => {
    expect(() => snapHtmlLayoutImage(rectangle(invalid), bounds, [neighbor])).toThrow()
  })

  it.each([
    { threshold: -1 }, { threshold: Infinity }, { releaseThreshold: 7 }, { releaseThreshold: NaN }, { neighborDistance: -1 }
  ])('rejects invalid snapping thresholds %j', invalid => {
    expect(() => snapHtmlLayoutImage(rectangle(), bounds, [neighbor], {}, invalid)).toThrow()
  })

  it('rejects ambiguous neighbor identities and invalid neighbor geometry', () => {
    expect(() => snapHtmlLayoutImage(rectangle(), bounds, [neighbor, neighbor])).toThrow()
    expect(() => snapHtmlLayoutImage(rectangle(), bounds, [{ id: '', rectangle: neighbor.rectangle }])).toThrow()
    expect(() => snapHtmlLayoutImage(rectangle(), bounds, [{ ...neighbor, rectangle: { ...neighbor.rectangle, height: NaN } }])).toThrow()
  })
})
