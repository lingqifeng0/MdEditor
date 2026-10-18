import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  ZoomPanController,
  fitScale,
  pan,
  wheelZoomFactor,
  zoomAt,
  type ZoomState
} from '@/util/zoomPan'

// Where a content point sits on screen, given the transform is
// `translate(x, y) scale(scale)` about the content's own centre and that centre
// starts at (cx, cy).
const projectX = (state: ZoomState, offset: number, cx: number): number =>
  cx + state.x + state.scale * offset

const projectY = (state: ZoomState, offset: number, cy: number): number =>
  cy + state.y + state.scale * offset

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const before: ZoomState = { scale: 1, x: 0, y: 0 }
    const cx = 400
    const cy = 300
    const px = 550
    const py = 380

    // The content offset that is under the cursor before the zoom.
    const ux = (px - cx - before.x) / before.scale
    const uy = (py - cy - before.y) / before.scale

    const after = zoomAt(before, 2, px, py, cx, cy)

    expect(projectX(after, ux, cx)).toBeCloseTo(px, 6)
    expect(projectY(after, uy, cy)).toBeCloseTo(py, 6)
  })

  it('keeps the point fixed when zooming out from an already panned state', () => {
    const before: ZoomState = { scale: 3, x: -120, y: 45 }
    const cx = 500
    const cy = 250
    const px = 610
    const py = 190

    const ux = (px - cx - before.x) / before.scale
    const uy = (py - cy - before.y) / before.scale
    const after = zoomAt(before, 0.5, px, py, cx, cy)

    expect(after.scale).toBeCloseTo(1.5, 6)
    expect(projectX(after, ux, cx)).toBeCloseTo(px, 6)
    expect(projectY(after, uy, cy)).toBeCloseTo(py, 6)
  })

  it('zooming about the centre leaves the translation alone', () => {
    const after = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 400, 300, 400, 300)
    expect(after).toEqual({ scale: 2, x: 0, y: 0 })
  })

  it('clamps at the maximum scale', () => {
    const after = zoomAt({ scale: MAX_SCALE, x: 0, y: 0 }, 4, 10, 10, 0, 0)
    expect(after.scale).toBe(MAX_SCALE)
  })

  it('clamps at the minimum scale', () => {
    const after = zoomAt({ scale: MIN_SCALE, x: 0, y: 0 }, 0.25, 10, 10, 0, 0)
    expect(after.scale).toBe(MIN_SCALE)
  })

  it('does not move anything when the clamp swallows the zoom', () => {
    const before: ZoomState = { scale: MAX_SCALE, x: 30, y: -40 }
    expect(zoomAt(before, 2, 120, 90, 0, 0)).toEqual(before)
  })
})

describe('fitScale', () => {
  it('shrinks content that is wider than the viewport', () => {
    expect(fitScale({ width: 2000, height: 500 }, { width: 1000, height: 800 })).toBeCloseTo(0.5, 6)
  })

  it('shrinks content that is taller than the viewport', () => {
    expect(fitScale({ width: 400, height: 1600 }, { width: 1000, height: 800 })).toBeCloseTo(0.5, 6)
  })

  it('uses the tighter of the two axes', () => {
    expect(fitScale({ width: 2000, height: 3200 }, { width: 1000, height: 800 })).toBeCloseTo(0.25, 6)
  })

  it('never enlarges content that already fits', () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 1000, height: 800 })).toBe(1)
  })

  it('never returns less than the minimum scale', () => {
    expect(fitScale({ width: 1e6, height: 1e6 }, { width: 10, height: 10 })).toBe(MIN_SCALE)
  })

  it('falls back to 1 for content with no measurable size', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 1000, height: 800 })).toBe(1)
  })
})

describe('pan', () => {
  it('adds the delta to the translation', () => {
    expect(pan({ scale: 2, x: 10, y: -5 }, 4, 6)).toEqual({ scale: 2, x: 14, y: 1 })
  })

  it('leaves the scale alone', () => {
    expect(pan({ scale: 2.5, x: 0, y: 0 }, 1, 1).scale).toBe(2.5)
  })
})

describe('IDENTITY', () => {
  it('is an untransformed state', () => {
    expect(IDENTITY).toEqual({ scale: 1, x: 0, y: 0 })
  })
})

describe('wheelZoomFactor', () => {
  it('uses wheel direction and magnitude while preserving the 120-pixel step', () => {
    expect(wheelZoomFactor(-120, 0, 600)).toBeCloseTo(1.1)
    expect(wheelZoomFactor(120, 0, 600)).toBeCloseTo(1 / 1.1)
    expect(wheelZoomFactor(-800, 0, 600)).toBeGreaterThan(wheelZoomFactor(-120, 0, 600))
  })

  it('normalizes line deltas to the same zoom as equivalent pixels', () => {
    expect(wheelZoomFactor(-3, 1, 600)).toBeCloseTo(wheelZoomFactor(-120, 0, 600))
  })

  it('normalizes page deltas using the stage height', () => {
    expect(wheelZoomFactor(-1, 2, 600)).toBeCloseTo(wheelZoomFactor(-600, 0, 600))
  })

  it('ignores a horizontal-only wheel gesture', () => {
    expect(wheelZoomFactor(0, 0, 600)).toBe(1)
  })

  it('bounds unusually large wheel deltas without reversing their direction', () => {
    expect(wheelZoomFactor(-1e9, 0, 600)).toBe(wheelZoomFactor(-1200, 0, 600))
    expect(wheelZoomFactor(1e9, 0, 600)).toBe(wheelZoomFactor(1200, 0, 600))
  })
})

describe('ZoomPanController interactions', () => {
  let viewport: HTMLDivElement
  let content: HTMLImageElement
  let wheelSurface: HTMLDivElement
  let controller: ZoomPanController
  let onChange: Mock<(state: ZoomState) => void>
  let captured: number | null

  const pointer = (target: EventTarget, type: string, x: number, y: number, pointerId = 7, button = 0) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    target.dispatchEvent(event)
    return event
  }
  const latest = (): ZoomState => {
    const state = onChange.mock.calls.at(-1)?.[0] as ZoomState | undefined
    if (!state) throw new Error('The controller has not emitted a transform')
    return state
  }

  beforeEach(() => {
    wheelSurface = document.createElement('div')
    viewport = document.createElement('div')
    content = document.createElement('img')
    viewport.append(content)
    wheelSurface.append(viewport)
    document.body.append(wheelSurface)
    Object.defineProperties(viewport, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
      getBoundingClientRect: { value: () => ({ left: 50, top: 30, width: 800, height: 600 }) }
    })
    Object.defineProperties(content, {
      offsetWidth: { value: 1600 },
      offsetHeight: { value: 900 }
    })
    captured = null
    viewport.setPointerCapture = vi.fn((id: number) => { captured = id })
    viewport.hasPointerCapture = vi.fn((id: number) => captured === id)
    viewport.releasePointerCapture = vi.fn(() => { captured = null })
    onChange = vi.fn<(state: ZoomState) => void>()
    controller = new ZoomPanController(viewport, content, { wheelSurface, onChange })
  })

  afterEach(() => {
    controller.destroy()
    wheelSurface.remove()
  })

  it('fits the natural image size and actual size resets both zoom and pan', () => {
    controller.fit()
    expect(latest()).toEqual({ scale: 0.5, x: 0, y: 0 })
    controller.panBy(100, 60)
    controller.actualSize()
    expect(latest()).toEqual(IDENTITY)
  })

  it('anchors wheel zoom to the cursor and consumes the event on an overlaid surface', () => {
    controller.panBy(-100, 60)
    const before = latest()
    const event = new WheelEvent('wheel', { deltaY: -120, clientX: 630, clientY: 430, cancelable: true, bubbles: true })
    const bubble = vi.fn()
    document.addEventListener('wheel', bubble)
    wheelSurface.dispatchEvent(event)
    document.removeEventListener('wheel', bubble)
    const after = latest()
    expect(projectX(after, (630 - 450 - before.x) / before.scale, 450)).toBeCloseTo(630)
    expect(projectY(after, (430 - 330 - before.y) / before.scale, 330)).toBeCloseTo(430)
    expect(after.scale).toBeCloseTo(1.1)
    expect(event.defaultPrevented).toBe(true)
    expect(bubble).not.toHaveBeenCalled()
  })

  it('does not zoom when only deltaX changes', () => {
    wheelSurface.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: 0 }))
    expect(controller.scale).toBe(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('captures a drag, shows the hand cursor and permits free pan beyond the viewport', () => {
    expect(viewport.style.cursor).toBe('grab')
    const event = pointer(viewport, 'pointerdown', 100, 120)
    expect(event.defaultPrevented).toBe(true)
    expect(captured).toBe(7)
    expect(viewport.style.cursor).toBe('grabbing')
    pointer(document, 'pointermove', 2100, -1880)
    expect(latest()).toEqual({ scale: 1, x: 2000, y: -2000 })
    pointer(document, 'pointerup', 2100, -1880)
    expect(captured).toBe(null)
    expect(viewport.style.cursor).toBe('grab')
  })

  it('starts a new drag from the current pan without jumping', () => {
    controller.panBy(120, -45)
    pointer(viewport, 'pointerdown', 400, 300)
    pointer(document, 'pointermove', 483, 357)
    expect(latest()).toEqual({ scale: 1, x: 203, y: 12 })
  })

  it('ignores the secondary button and unrelated pointers', () => {
    pointer(viewport, 'pointerdown', 100, 100, 7, 2)
    expect(viewport.style.cursor).toBe('grab')
    pointer(viewport, 'pointerdown', 100, 100)
    pointer(viewport, 'pointerdown', 200, 200, 8)
    pointer(document, 'pointermove', 300, 300, 8)
    pointer(document, 'pointerup', 300, 300, 8)
    expect(onChange).not.toHaveBeenCalled()
    expect(viewport.style.cursor).toBe('grabbing')
    pointer(document, 'pointermove', 120, 130)
    expect(latest()).toEqual({ scale: 1, x: 20, y: 30 })
  })

  for (const eventName of ['pointercancel', 'lostpointercapture']) {
    it(`ends a drag after ${eventName} without moving on later events`, () => {
      pointer(viewport, 'pointerdown', 100, 100)
      pointer(eventName === 'lostpointercapture' ? viewport : document, eventName, 100, 100)
      pointer(document, 'pointermove', 300, 400)
      expect(viewport.style.cursor).toBe('grab')
      expect(onChange).not.toHaveBeenCalled()
    })
  }

  it('ends a drag when focus leaves the application window', () => {
    pointer(viewport, 'pointerdown', 100, 100)
    window.dispatchEvent(new Event('blur'))
    pointer(document, 'pointermove', 300, 400)
    expect(captured).toBe(null)
    expect(viewport.style.cursor).toBe('grab')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses document events if pointer capture is no longer available', () => {
    viewport.setPointerCapture = vi.fn(() => { throw new Error('No active pointer') })
    pointer(viewport, 'pointerdown', 100, 100)
    pointer(document, 'pointermove', 120, 130)
    expect(latest()).toEqual({ scale: 1, x: 20, y: 30 })
  })

  it('destroying mid-drag releases capture and removes every interaction listener', () => {
    pointer(viewport, 'pointerdown', 100, 100)
    controller.destroy()
    expect(captured).toBe(null)
    expect(viewport.style.cursor).toBe('grab')
    pointer(viewport, 'pointerdown', 100, 100)
    pointer(document, 'pointermove', 200, 300)
    wheelSurface.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
