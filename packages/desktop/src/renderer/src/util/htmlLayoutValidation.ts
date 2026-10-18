import { htmlLayoutRectanglesOverlap } from './htmlLayoutBounds'
import type { HtmlLayoutRectangle } from './htmlLayoutBounds'

export interface HtmlLayoutMeasuredImage {
  id: string
  label: string
  rectangle: HtmlLayoutRectangle
}

export interface HtmlLayoutImageOverlap {
  first: HtmlLayoutMeasuredImage
  second: HtmlLayoutMeasuredImage
}

/**
 * Measurements share one CSS-pixel space and contain only visible images.
 * All pairs are returned in image order, without changing their measurements.
 * Edge contact and overlap depths up to tolerance CSS pixels are permitted;
 * zero-size images are ignored and invalid geometry prevents validation.
 */
export function findHtmlLayoutImageOverlaps(
  images: readonly HtmlLayoutMeasuredImage[],
  tolerance = 0.001
): HtmlLayoutImageOverlap[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Invalid HTML layout overlap tolerance.')
  const imageIds = new Set<string>()
  const measuredImages = images.filter(image => {
    if (imageIds.has(image.id)) throw new Error('Duplicate HTML layout image identifier.')
    imageIds.add(image.id)
    const { left, top, width, height } = image.rectangle
    if (![left, top, width, height, left + width, top + height].every(Number.isFinite) || width < 0 || height < 0) {
      throw new Error('Invalid HTML layout image geometry.')
    }
    return width > 0 && height > 0
  })
  const overlaps: HtmlLayoutImageOverlap[] = []
  for (const [firstIndex, first] of measuredImages.entries()) {
    for (const second of measuredImages.slice(firstIndex + 1)) {
      if (htmlLayoutRectanglesOverlap(first.rectangle, second.rectangle, tolerance)) overlaps.push({ first, second })
    }
  }
  return overlaps
}
