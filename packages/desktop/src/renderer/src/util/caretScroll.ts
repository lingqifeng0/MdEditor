interface CaretViewport {
  cursorY: number
  viewportTop: number
  height: number
  scrollTop: number
  isCollapsed: boolean
  followCaret: boolean
  blocked: boolean
  typewriter: boolean
}

/** Pointer selection and intermediate formatting ranges must not move the reading viewport. */
export const caretScrollTarget = (viewport: CaretViewport): number | null => {
  const { cursorY, viewportTop, height, scrollTop, isCollapsed, followCaret, blocked, typewriter } = viewport
  if (!isCollapsed || !followCaret || blocked || !Number.isFinite(cursorY)) return null
  if (typewriter) {
    const targetY = Math.min(viewportTop + height - 100, Math.max(viewportTop + 100, 320))
    return Math.abs(cursorY - targetY) > 2 ? scrollTop + cursorY - targetY : null
  }
  const relativeY = cursorY - viewportTop
  if (relativeY > height - 100) return scrollTop + relativeY - height + 100
  if (relativeY < 100) return scrollTop + relativeY - 100
  return null
}
