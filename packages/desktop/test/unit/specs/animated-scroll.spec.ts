// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { animatedScrollTo, cancelAnimatedScrollTo } from '../../../src/renderer/src/util/animatedScroll'

let sequence = 0
let now = 0
const frames = new Map<number, FrameRequestCallback>()
beforeEach(() => {
  frames.clear()
  sequence = 0
  now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const frame = ++sequence
    frames.set(frame, callback)
    return frame
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const advance = (milliseconds: number): void => {
  now += milliseconds
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
}

describe('editor scroll animation ownership', () => {
  it('keeps the position where history interrupted an unfinished typewriter scroll', () => {
    const element = document.createElement('div')
    element.scrollTop = 700
    const completed = vi.fn()
    animatedScrollTo(element, 1100, 100, completed)
    advance(30)
    const beforeUndo = element.scrollTop
    expect(beforeUndo).toBeGreaterThan(700)
    cancelAnimatedScrollTo(element)
    advance(200)
    expect(element.scrollTop).toBe(beforeUndo)
    expect(completed).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('cancels a pending animation before an immediate viewport restoration', () => {
    const element = document.createElement('div')
    animatedScrollTo(element, 1200, 300)
    animatedScrollTo(element, 700, 0)
    advance(400)
    expect(element.scrollTop).toBe(700)
    expect(frames.size).toBe(0)
  })

  it('lets a newer animation replace the prior destination and finish exactly once', () => {
    const element = document.createElement('div')
    const oldCallback = vi.fn()
    const newCallback = vi.fn()
    animatedScrollTo(element, 1200, 300, oldCallback)
    advance(40)
    animatedScrollTo(element, 900, 100, newCallback)
    advance(50)
    advance(50)
    expect(element.scrollTop).toBe(900)
    expect(oldCallback).not.toHaveBeenCalled()
    expect(newCallback).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })
})
