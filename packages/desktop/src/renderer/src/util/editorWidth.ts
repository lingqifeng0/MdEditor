export const DEFAULT_EDITOR_CONTENT_WIDTH = 1000

export type EditorWidthUnit = 'px' | '%' | 'ch'

export interface EditorWidthValue {
  amount: number
  unit: EditorWidthUnit
}

const WIDTH_PATTERN = /^([0-9]+)(px|%|ch)$/

const UNIT_DEFAULTS: Record<EditorWidthUnit, number> = {
  px: DEFAULT_EDITOR_CONTENT_WIDTH,
  '%': 80,
  ch: 100
}

const SLIDER_LIMITS: Record<EditorWidthUnit, { min: number; max: number; step: number }> = {
  px: { min: 480, max: 1700, step: 10 },
  '%': { min: 20, max: 100, step: 1 },
  ch: { min: 40, max: 180, step: 1 }
}

export const parseEditorWidth = (value: string): EditorWidthValue | null => {
  if (value === '') {
    return { amount: DEFAULT_EDITOR_CONTENT_WIDTH, unit: 'px' }
  }

  const match = WIDTH_PATTERN.exec(value)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isSafeInteger(amount)) return null

  return { amount, unit: match[2] as EditorWidthUnit }
}

export const formatEditorWidth = (amount: number, unit: EditorWidthUnit): string | null => {
  return Number.isSafeInteger(amount) && amount >= 0 ? `${amount}${unit}` : null
}

export const defaultEditorWidthForUnit = (unit: EditorWidthUnit): number => UNIT_DEFAULTS[unit]

export const editorWidthSliderLimits = (value: EditorWidthValue): { min: number; max: number; step: number } => {
  const limits = SLIDER_LIMITS[value.unit]
  // A previously saved value can be outside the convenient dragging range.
  // Keep it selectable without rewriting the preference when the UI opens.
  return {
    min: Math.min(limits.min, value.amount),
    max: Math.max(limits.max, value.amount),
    step: limits.step
  }
}
