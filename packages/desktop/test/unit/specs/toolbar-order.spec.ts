import { describe, expect, it } from 'vitest'
import { normalizeToolbarOrder, swapToolbarButtons, TOOLBAR_BUTTONS } from 'common/toolbar'

describe('formatting toolbar order', () => {
  it('keeps the complete default toolbar for missing or malformed settings', () => {
    for (const value of [undefined, null, '', {}, []]) expect(normalizeToolbarOrder(value)).toEqual(TOOLBAR_BUTTONS)
  })

  it('preserves custom order while dropping duplicate and obsolete IDs and appending new tools', () => {
    const saved = ['clear', 'mark', 'clear', 'obsolete', 3]
    const normalized = normalizeToolbarOrder(saved)
    expect(normalized.slice(0, 2)).toEqual(['clear', 'mark'])
    expect(normalized).toHaveLength(TOOLBAR_BUTTONS.length)
    expect(new Set(normalized)).toEqual(new Set(TOOLBAR_BUTTONS))
    expect(saved).toEqual(['clear', 'mark', 'clear', 'obsolete', 3])
  })

  it('exchanges two distant slots without shifting intermediate buttons or mutating saved settings', () => {
    const saved = [...TOOLBAR_BUTTONS]
    const swapped = swapToolbarButtons(saved, 'clear', 'codeblock')
    expect(swapped[0]).toBe('clear')
    expect(swapped[12]).toBe('codeblock')
    expect(swapped.slice(1, 12)).toEqual(TOOLBAR_BUTTONS.slice(1, 12))
    expect(saved).toEqual(TOOLBAR_BUTTONS)
    expect(swapToolbarButtons(swapped, 'clear', 'codeblock')).toEqual(TOOLBAR_BUTTONS)
  })

  it('swaps adjacent slots in either direction and keeps color controls as one item', () => {
    expect(swapToolbarButtons([], 'heading-n', 'codeblock').slice(0, 2)).toEqual(['heading-n', 'codeblock'])
    expect(swapToolbarButtons([], 'codeblock', 'heading-n').slice(0, 2)).toEqual(['heading-n', 'codeblock'])
    const swapped = swapToolbarButtons([], 'background-color', 'strong')
    expect(swapped.slice(0, 4)).toEqual(['codeblock', 'heading-n', 'background-color', 'em'])
    expect(swapped.at(-1)).toBe('strong')
    expect(new Set(swapped)).toEqual(new Set(TOOLBAR_BUTTONS))
  })

  it('ignores canceled or invalid moves', () => {
    for (const [id, target] of [['mark', 'mark'], ['unknown', 'strong'], ['mark', 'unknown']]) {
      expect(swapToolbarButtons([], id, target)).toEqual(TOOLBAR_BUTTONS)
    }
  })
})
