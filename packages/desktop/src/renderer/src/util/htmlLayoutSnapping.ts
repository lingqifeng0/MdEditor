import { clampHtmlLayoutImageOffset, type HtmlLayoutRectangle } from './htmlLayoutBounds'

type SnapAxis = 'x' | 'y'
type SnapEdge = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'

export interface HtmlLayoutSnapImage {
  id: string
  rectangle: HtmlLayoutRectangle
}

export interface HtmlLayoutSnapGuide {
  key: string
  axis: SnapAxis
  kind: 'align' | 'contact' | 'frame'
  edge: SnapEdge
  targetEdge: SnapEdge
  targetId: string | null
  position: number
  start: number
  end: number
  label: string
}

export interface HtmlLayoutSnapState {
  x?: string
  y?: string
}

export interface HtmlLayoutSnapOptions {
  enabled?: boolean
  threshold?: number
  releaseThreshold?: number
  neighborDistance?: number
}

export interface HtmlLayoutSnapPreview {
  rectangle: HtmlLayoutRectangle
  guides: HtmlLayoutSnapGuide[]
  snapRectangle: HtmlLayoutRectangle
}

interface SnapCandidate extends HtmlLayoutSnapGuide {
  correction: number
  orthogonalGap: number
}

const edgeLabel: Record<SnapEdge, string> = {
  left: '左边', right: '右边', top: '顶边', bottom: '底边', 'center-x': '竖直中心', 'center-y': '水平中心'
}

const edgesForAxis = (axis: SnapAxis): readonly SnapEdge[] => axis === 'x'
  ? ['left', 'right', 'center-x']
  : ['top', 'bottom', 'center-y']

const edgePosition = (rectangle: HtmlLayoutRectangle, edge: SnapEdge): number => {
  if (edge === 'left') return rectangle.left
  if (edge === 'right') return rectangle.left + rectangle.width
  if (edge === 'top') return rectangle.top
  if (edge === 'bottom') return rectangle.top + rectangle.height
  if (edge === 'center-x') return rectangle.left + rectangle.width / 2
  return rectangle.top + rectangle.height / 2
}

const axisRange = (rectangle: HtmlLayoutRectangle, axis: SnapAxis): [number, number] => axis === 'x'
  ? [rectangle.left, rectangle.left + rectangle.width]
  : [rectangle.top, rectangle.top + rectangle.height]

const rangeGap = (first: [number, number], second: [number, number]): number =>
  Math.max(0, first[0] - second[1], second[0] - first[1])

const validRectangle = (rectangle: HtmlLayoutRectangle): boolean =>
  [rectangle.left, rectangle.top, rectangle.width, rectangle.height,
    rectangle.left + rectangle.width, rectangle.top + rectangle.height].every(Number.isFinite) &&
  rectangle.width > 0 && rectangle.height > 0

const candidatePriority = (candidate: SnapCandidate): number => {
  if (candidate.edge.startsWith('center-')) return 3
  if (candidate.kind === 'contact') return 0
  if (candidate.kind === 'align') return 1
  return 2
}

/**
 * All geometry and thresholds use rendered CSS pixels. Capture is local to nearby edges;
 * the returned state retains a captured edge until the unsnapped pointer position crosses
 * releaseThreshold. Disabling snapping clears that state while still enforcing bounds.
 */
export function snapHtmlLayoutImage(
  requested: HtmlLayoutRectangle,
  bounds: HtmlLayoutRectangle,
  images: readonly HtmlLayoutSnapImage[],
  previous: HtmlLayoutSnapState = {},
  options: HtmlLayoutSnapOptions = {}
): { rectangle: HtmlLayoutRectangle; guides: HtmlLayoutSnapGuide[]; state: HtmlLayoutSnapState } {
  const threshold = options.threshold ?? 8
  const releaseThreshold = options.releaseThreshold ?? 12
  const neighborDistance = options.neighborDistance ?? 48
  if (!validRectangle(requested) || !validRectangle(bounds) ||
    ![threshold, releaseThreshold, neighborDistance].every(value => Number.isFinite(value) && value >= 0) ||
    releaseThreshold < threshold || images.some(image => !image.id || !validRectangle(image.rectangle)) ||
    new Set(images.map(image => image.id)).size !== images.length) {
    throw new Error('Invalid HTML image snapping geometry or thresholds.')
  }
  const bounded = clampHtmlLayoutImageOffset({ ...requested, offsetX: 0, offsetY: 0 }, bounds, 0, 0)
  const rectangle = { ...requested, left: requested.left + bounded.offsetX, top: requested.top + bounded.offsetY }
  const guides: HtmlLayoutSnapGuide[] = []
  const state: HtmlLayoutSnapState = {}
  if (options.enabled === false) return { rectangle, guides, state }

  for (const axis of ['x', 'y'] as const) {
    const ownRange = axisRange(rectangle, axis)
    const boundsRange = axisRange(bounds, axis)
    if (ownRange[1] - ownRange[0] > boundsRange[1] - boundsRange[0]) continue
    const orthogonalAxis = axis === 'x' ? 'y' : 'x'
    const ownOrthogonalRange = axisRange(rectangle, orthogonalAxis)
    const candidates: SnapCandidate[] = []
    const addCandidate = (target: HtmlLayoutRectangle, id: string | null, edge: SnapEdge, targetEdge: SnapEdge, kind: HtmlLayoutSnapGuide['kind']) => {
      const targetRange = axisRange(target, orthogonalAxis)
      const orthogonalGap = rangeGap(ownOrthogonalRange, targetRange)
      if (id !== null && orthogonalGap > neighborDistance) return
      const position = edgePosition(target, targetEdge)
      const correction = position - edgePosition(rectangle, edge)
      if (Math.abs(correction) > releaseThreshold || ownRange[0] + correction < boundsRange[0] - 0.001 ||
        ownRange[1] + correction > boundsRange[1] + 0.001) return
      candidates.push({
        key: JSON.stringify([axis, id, edge, targetEdge]),
        axis,
        kind,
        edge,
        targetEdge,
        targetId: id,
        position,
        correction,
        orthogonalGap,
        start: Math.min(ownOrthogonalRange[0], targetRange[0]),
        end: Math.max(ownOrthogonalRange[1], targetRange[1]),
        label: kind === 'frame'
          ? `HTML ${edgeLabel[edge]}贴边`
          : kind === 'contact' ? `${edgeLabel[edge]}贴${edgeLabel[targetEdge]}` : `${edgeLabel[edge]}对齐`
      })
    }
    const edges = edgesForAxis(axis)
    for (const edge of edges.slice(0, 2)) addCandidate(bounds, null, edge, edge, 'frame')
    for (const image of images) {
      for (const edge of edges) addCandidate(image.rectangle, image.id, edge, edge, 'align')
      addCandidate(image.rectangle, image.id, edges[0], edges[1], 'contact')
      addCandidate(image.rectangle, image.id, edges[1], edges[0], 'contact')
    }
    // Edge contact beats a nearly equal center match, but a distant edge cannot override the nearest intent.
    const eligible = candidates.filter(candidate => Math.abs(candidate.correction) <= threshold &&
      (candidate.kind === 'frame' || Math.abs(candidate.position - edgePosition(requested, candidate.edge)) <= threshold))
    const nearest = eligible.reduce((distance, candidate) => Math.min(distance, Math.abs(candidate.correction)), Infinity)
    const nearTies = eligible.filter(candidate => Math.abs(candidate.correction) <= nearest + 0.5)
    nearTies.sort((first, second) => candidatePriority(first) - candidatePriority(second) ||
      Math.abs(first.correction) - Math.abs(second.correction) || first.orthogonalGap - second.orthogonalGap ||
      first.key.localeCompare(second.key))
    // Bounds can leave less travel than the release distance, so capture follows the raw pointer intent.
    const captured = candidates.find(item => item.key === previous[axis] &&
      Math.abs(item.position - edgePosition(requested, item.edge)) <= releaseThreshold)
    const nearestEdge = eligible.filter(item => !item.edge.startsWith('center-'))
      .sort((first, second) => Math.abs(first.correction) - Math.abs(second.correction) || candidatePriority(first) - candidatePriority(second))[0]
    const replacesCenter = captured?.edge.startsWith('center-') && nearestEdge &&
      Math.abs(nearestEdge.correction) + 0.5 < Math.abs(captured.correction)
    const candidate = replacesCenter ? nearestEdge : captured ?? nearTies[0]
    if (!candidate) continue
    if (axis === 'x') rectangle.left = candidate.position - (candidate.edge === 'right' ? rectangle.width : candidate.edge === 'center-x' ? rectangle.width / 2 : 0)
    else rectangle.top = candidate.position - (candidate.edge === 'bottom' ? rectangle.height : candidate.edge === 'center-y' ? rectangle.height / 2 : 0)
    state[axis] = candidate.key
    const { correction: _correction, orthogonalGap: _orthogonalGap, ...guide } = candidate
    guides.push(guide)
  }
  const visibleGuides = guides.filter(guide => {
    const target = guide.targetId === null ? bounds : images.find(image => image.id === guide.targetId)?.rectangle
    const boundsRange = axisRange(bounds, guide.axis)
    if (!target || guide.position < boundsRange[0] || guide.position > boundsRange[1] ||
      Math.abs(edgePosition(rectangle, guide.edge) - guide.position) > 0.001) {
      delete state[guide.axis]
      return false
    }
    const axis = guide.axis === 'x' ? 'y' : 'x'
    const ownRange = axisRange(rectangle, axis)
    const targetRange = axisRange(target, axis)
    const spanBounds = axisRange(bounds, axis)
    guide.start = Math.max(spanBounds[0], Math.min(ownRange[0], targetRange[0]))
    guide.end = Math.min(spanBounds[1], Math.max(ownRange[1], targetRange[1]))
    return guide.end >= guide.start
  })
  return { rectangle, guides: visibleGuides, state }
}

/**
 * Dragging uses rectangle; only a deliberate pointer release may use snapRectangle.
 * Guides describe nearby release candidates, not alignment of the current image.
 * Every call uses fresh intent in one CSS-pixel space, without retained capture.
 */
export function previewHtmlLayoutImageSnap(
  requested: HtmlLayoutRectangle,
  bounds: HtmlLayoutRectangle,
  images: readonly HtmlLayoutSnapImage[],
  options: Omit<HtmlLayoutSnapOptions, 'releaseThreshold'> = {}
): HtmlLayoutSnapPreview {
  const threshold = options.threshold ?? 8
  const snapped = snapHtmlLayoutImage(requested, bounds, images, {}, { ...options, releaseThreshold: threshold })
  const bounded = clampHtmlLayoutImageOffset({ ...requested, offsetX: 0, offsetY: 0 }, bounds, 0, 0)
  const rectangle = { ...requested, left: requested.left + bounded.offsetX, top: requested.top + bounded.offsetY }
  const snapRectangle = { ...rectangle }
  const guides: HtmlLayoutSnapGuide[] = []
  for (const guide of snapped.guides) {
    const target = guide.targetId === null ? bounds : images.find(image => image.id === guide.targetId)?.rectangle
    if (!target || Math.abs(edgePosition(rectangle, guide.edge) - guide.position) > threshold) continue
    const axis = guide.axis === 'x' ? 'y' : 'x'
    const ownRange = axisRange(rectangle, axis)
    const targetRange = axisRange(target, axis)
    const spanBounds = axisRange(bounds, axis)
    const start = Math.max(spanBounds[0], Math.min(ownRange[0], targetRange[0]))
    const end = Math.min(spanBounds[1], Math.max(ownRange[1], targetRange[1]))
    if (end < start) continue
    guides.push({ ...guide, start, end })
    if (guide.axis === 'x') snapRectangle.left = snapped.rectangle.left
    else snapRectangle.top = snapped.rectangle.top
  }
  return { rectangle, guides, snapRectangle }
}
