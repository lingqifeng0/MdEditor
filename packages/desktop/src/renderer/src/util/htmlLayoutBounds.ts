export interface HtmlLayoutSize {
  width: number
  height: number
}

interface HtmlLayoutImagePosition extends HtmlLayoutSize {
  offsetX: number
  offsetY: number
  left: number
  top: number
}

export interface HtmlLayoutRectangle extends HtmlLayoutSize {
  left: number
  top: number
}

const validSize = (size: HtmlLayoutSize): boolean =>
  Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0

/** Sizes are CSS pixels; small available bounds take precedence over any editor minimum. */
export function fitHtmlLayoutImageSize(
  requested: HtmlLayoutSize,
  available: HtmlLayoutSize,
  keepRatio: boolean
): HtmlLayoutSize {
  if (!validSize(requested) || !validSize(available)) throw new Error('Invalid HTML layout size.')
  if (keepRatio) {
    const scale = Math.min(1, available.width / requested.width, available.height / requested.height)
    return { width: requested.width * scale, height: requested.height * scale }
  }
  return { width: Math.min(requested.width, available.width), height: Math.min(requested.height, available.height) }
}

export function placeHtmlLayoutImage(requested: HtmlLayoutSize, bounds: HtmlLayoutSize, obstacles: readonly HtmlLayoutRectangle[]): HtmlLayoutRectangle {
  const maximum = fitHtmlLayoutImageSize(requested, bounds, true)
  const xs = [...new Set([0, ...obstacles.map(box => box.left + box.width)])].filter(x => x >= 0 && x < bounds.width).sort((a, b) => a - b)
  const ys = [...new Set([0, ...obstacles.map(box => box.top + box.height)])].filter(y => y >= 0 && y < bounds.height).sort((a, b) => a - b)
  let best: HtmlLayoutRectangle | null = null
  for (const top of ys) {
    for (const left of xs) {
      let scale = Math.min(1, (bounds.width - left) / maximum.width, (bounds.height - top) / maximum.height)
      for (const box of obstacles) {
        if (left >= box.left + box.width - 0.001 || left + maximum.width * scale <= box.left + 0.001 || top >= box.top + box.height - 0.001 || top + maximum.height * scale <= box.top + 0.001) continue
        scale = Math.max(0, Math.max((box.left - left) / maximum.width, (box.top - top) / maximum.height))
      }
      if (scale <= 0) continue
      const candidate = { left, top, width: maximum.width * scale, height: maximum.height * scale }
      if (!best || candidate.width * candidate.height > best.width * best.height) best = candidate
    }
  }
  return best ?? { left: 0, top: 0, ...maximum }
}

/** Coordinates share one CSS-pixel space; offsets are total translations, not incremental deltas. */
export function clampHtmlLayoutImageOffset(
  start: HtmlLayoutImagePosition,
  bounds: HtmlLayoutRectangle,
  deltaX: number,
  deltaY: number
): { offsetX: number; offsetY: number } {
  if (!validSize(start) || !validSize(bounds) ||
    ![start.offsetX, start.offsetY, start.left, start.top, bounds.left, bounds.top, deltaX, deltaY].every(Number.isFinite)) {
    throw new Error('Invalid HTML layout bounds or offset.')
  }
  const left = bounds.left - start.left
  const top = bounds.top - start.top
  return {
    offsetX: start.offsetX + (start.width > bounds.width
      ? left
      : Math.max(left, Math.min(bounds.left + bounds.width - start.left - start.width, deltaX))),
    offsetY: start.offsetY + (start.height > bounds.height
      ? top
      : Math.max(top, Math.min(bounds.top + bounds.height - start.top - start.height, deltaY)))
  }
}

const COLLISION_TOLERANCE = 0.001

const validRectangle = (rectangle: HtmlLayoutRectangle): boolean =>
  validSize(rectangle) && Number.isFinite(rectangle.left) && Number.isFinite(rectangle.top)

/** Edge contact and overlaps no deeper than tolerance CSS pixels are permitted. */
export function htmlLayoutRectanglesOverlap(
  first: HtmlLayoutRectangle,
  second: HtmlLayoutRectangle,
  tolerance = COLLISION_TOLERANCE
): boolean {
  if (!validRectangle(first) || !validRectangle(second) || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('Invalid HTML layout collision rectangle or tolerance.')
  }
  return Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left) > tolerance &&
    Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top) > tolerance
}

const sweepAxis = (start: number, size: number, obstacle: number, obstacleSize: number, delta: number): [number, number] | null => {
  if (!delta) {
    return start + size <= obstacle + COLLISION_TOLERANCE || start >= obstacle + obstacleSize - COLLISION_TOLERANCE
      ? null
      : [-Infinity, Infinity]
  }
  if (delta > 0) {
    const gap = obstacle - start - size
    return [(gap >= -COLLISION_TOLERANCE ? Math.max(0, gap) : gap) / delta, (obstacle + obstacleSize - start) / delta]
  }
  const gap = start - obstacle - obstacleSize
  return [(gap >= -COLLISION_TOLERANCE ? Math.max(0, gap) : gap) / -delta, (obstacle - start - size) / delta]
}

/**
 * Uses the current rendered rectangle and total offsets, with an incremental movement delta.
 * Sweeps the bounded path and slides at contact; an existing overlap is ignored for this call
 * so legacy layouts can be separated. Once separated, that obstacle blocks later calls.
 */
export function constrainHtmlLayoutImageMove(
  start: HtmlLayoutImagePosition,
  bounds: HtmlLayoutRectangle,
  obstacles: HtmlLayoutRectangle[],
  deltaX: number,
  deltaY: number
): { offsetX: number; offsetY: number } {
  const bounded = clampHtmlLayoutImageOffset(start, bounds, deltaX, deltaY)
  for (const obstacle of obstacles) {
    if (!validRectangle(obstacle)) throw new Error('Invalid HTML layout collision rectangle or tolerance.')
  }
  const blockers = obstacles.filter(obstacle => !htmlLayoutRectanglesOverlap(start, obstacle))
  let remainingX = bounded.offsetX - start.offsetX
  let remainingY = bounded.offsetY - start.offsetY
  let left = start.left
  let top = start.top
  // Each contact removes a movement axis; the third pass completes any unblocked remainder.
  for (let contact = 0; contact < 3 && (remainingX || remainingY); contact++) {
    let first: { time: number; blockX: boolean; blockY: boolean } | null = null
    const timeTolerance = COLLISION_TOLERANCE / Math.max(1, Math.abs(remainingX), Math.abs(remainingY))
    for (const obstacle of blockers) {
      const x = sweepAxis(left, start.width, obstacle.left, obstacle.width, remainingX)
      const y = sweepAxis(top, start.height, obstacle.top, obstacle.height, remainingY)
      if (!x || !y) continue
      const entry = Math.max(x[0], y[0])
      const exit = Math.min(x[1], y[1])
      if (entry < 0 || entry > 1 || exit <= Math.max(0, entry)) continue
      const corner = x[0] === y[0]
      const blockX = corner ? Math.abs(remainingX) < Math.abs(remainingY) : x[0] > y[0]
      const hit = { time: entry, blockX, blockY: !blockX }
      if (!first || entry < first.time - timeTolerance) first = hit
      else if (Math.abs(entry - first.time) <= timeTolerance) {
        first.blockX ||= hit.blockX
        first.blockY ||= hit.blockY
        first.time = Math.min(first.time, hit.time)
      }
    }
    if (!first) {
      left += remainingX
      top += remainingY
      break
    }
    left += remainingX * first.time
    top += remainingY * first.time
    remainingX = first.blockX ? 0 : remainingX * (1 - first.time)
    remainingY = first.blockY ? 0 : remainingY * (1 - first.time)
  }
  return { offsetX: start.offsetX + left - start.left, offsetY: start.offsetY + top - start.top }
}
