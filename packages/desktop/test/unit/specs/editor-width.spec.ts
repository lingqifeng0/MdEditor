import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EDITOR_CONTENT_WIDTH,
  defaultEditorWidthForUnit,
  editorWidthSliderLimits,
  formatEditorWidth,
  parseEditorWidth,
  type EditorWidthUnit
} from '@/util/editorWidth'

describe('editor width preference compatibility', () => {
  it('keeps the empty preference as the default sentinel', () => {
    expect(parseEditorWidth('')).toEqual({ amount: DEFAULT_EDITOR_CONTENT_WIDTH, unit: 'px' })
    expect(DEFAULT_EDITOR_CONTENT_WIDTH).toBe(1000)
  })

  it.each([
    ['791px', 791, 'px'],
    ['60%', 60, '%'],
    ['80ch', 80, 'ch'],
    ['0px', 0, 'px'],
    ['2500px', 2500, 'px']
  ] as const)('preserves the saved width %s', (value, amount, unit) => {
    expect(parseEditorWidth(value)).toEqual({ amount, unit })
    expect(formatEditorWidth(amount, unit)).toBe(value)
  })

  it.each(['800', '-20px', '2.5px', '50vw', '600px trailing', '9007199254740992px'])(
    'does not treat the invalid or imprecise value %s as a numeric control value', (value) => {
      expect(parseEditorWidth(value)).toBeNull()
    }
  )

  it('does not silently clip historical values outside the convenient dragging range', () => {
    expect(editorWidthSliderLimits({ amount: 2500, unit: 'px' })).toEqual({ min: 480, max: 2500, step: 10 })
    expect(editorWidthSliderLimits({ amount: 250, unit: 'px' })).toEqual({ min: 250, max: 1700, step: 10 })
    expect(editorWidthSliderLimits({ amount: 120, unit: '%' })).toEqual({ min: 20, max: 120, step: 1 })
  })

  it.each(['px', '%', 'ch'] as EditorWidthUnit[])('provides a valid starting width when switching to %s', (unit) => {
    const value = formatEditorWidth(defaultEditorWidthForUnit(unit), unit)
    expect(value).not.toBeNull()
    expect(parseEditorWidth(value ?? '')?.unit).toBe(unit)
  })

  it.each([-1, 3.4, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid numeric edit %s', (amount) => {
    expect(formatEditorWidth(amount, 'px')).toBeNull()
  })
})
