import { describe, expect, it } from 'vitest'
import { caretScrollTarget } from '../../../src/renderer/src/util/caretScroll'

const viewport = { cursorY: 870, viewportTop: 32, height: 900, scrollTop: 2400, isCollapsed: true, followCaret: true, blocked: false, typewriter: false }

describe('caret scrolling intent', () => {
  it.each([false, true])('holds selected text near either viewport edge in typewriter=%s', typewriter => {
    for (const cursorY of [40, 120, 470, 870, 930]) {
      expect(caretScrollTarget({ ...viewport, cursorY, typewriter, isCollapsed: false })).toBeNull()
    }
  })
  it.each([false, true])('holds a pointer-placed caret until keyboard input in typewriter=%s', typewriter => {
    expect(caretScrollTarget({ ...viewport, typewriter, followCaret: false })).toBeNull()
  })
  it.each([false, true])('ignores temporary carets during formatting in typewriter=%s', typewriter => {
    expect(caretScrollTarget({ ...viewport, cursorY: 3400, typewriter, blocked: true })).toBeNull()
  })
  it('reveals typed text near the bottom using coordinates relative to the actual viewport', () => {
    expect(caretScrollTarget(viewport)).toBe(2438)
  })
  it('reveals keyboard navigation above the top margin', () => {
    expect(caretScrollTarget({ ...viewport, cursorY: 60 })).toBe(2328)
  })
  it('does not reposition an ordinary caret already in the writing area', () => {
    expect(caretScrollTarget({ ...viewport, cursorY: 430 })).toBeNull()
  })
  it('uses one typewriter destination instead of competing with the bottom-edge rule', () => {
    expect(caretScrollTarget({ ...viewport, typewriter: true })).toBe(2950)
  })
  it('avoids typewriter micro movements and invalid coordinates', () => {
    expect(caretScrollTarget({ ...viewport, cursorY: 321, typewriter: true })).toBeNull()
    expect(caretScrollTarget({ ...viewport, cursorY: Number.NaN })).toBeNull()
  })
  it('keeps the typewriter destination inside a short viewport', () => {
    expect(caretScrollTarget({ ...viewport, cursorY: 265, height: 250, typewriter: true })).toBe(2483)
  })
})
