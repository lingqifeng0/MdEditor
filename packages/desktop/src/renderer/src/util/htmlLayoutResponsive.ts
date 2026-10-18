import { createHtmlLayoutDocument, type HtmlLayoutDocument, type HtmlLayoutTarget } from './htmlLayout'

interface LayoutBox {
  left: number
  top: number
  width: number
  height: number
}

interface LayoutBorders {
  left: number
  top: number
  right: number
  bottom: number
}

interface ResponsiveGroup {
  root: HTMLElement
  width: number
  height: number
  borders: LayoutBorders
  maximumWidth?: number
  images: { element: HTMLImageElement; box: LayoutBox }[]
}

interface OpeningAttribute {
  name: string
  start: number
  end: number
  valueStart: number
  valueEnd: number
  quote: string
}

const numberText = (value: number): string => `${Number(value.toFixed(10))}`
const pixelValue = (value: string): number | undefined => {
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/.exec(value.trim())
  if (!match || (!value.trim().endsWith('px') && Number(match[1]) !== 0)) return undefined
  const result = Number(match[1])
  return Number.isFinite(result) ? result : undefined
}

const stylePixels = (style: CSSStyleDeclaration, property: string): number | undefined => {
  const value = style.getPropertyValue(property)
  return value ? pixelValue(value) : 0
}

const bordersFromStyle = (style: CSSStyleDeclaration): LayoutBorders | undefined => {
  const values = ['left', 'top', 'right', 'bottom'].map(side => {
    const borderStyle = style.getPropertyValue(`border-${side}-style`)
    return !borderStyle || ['none', 'hidden'].includes(borderStyle) ? 0 : stylePixels(style, `border-${side}-width`)
  })
  if (values.some(value => value === undefined || value < 0)) return undefined
  return { left: values[0]!, top: values[1]!, right: values[2]!, bottom: values[3]! }
}

const directImages = (root: HTMLElement): HTMLImageElement[] | undefined => {
  if (!['DIV', 'SECTION', 'FIGURE', 'ARTICLE', 'P'].includes(root.tagName)) return undefined
  if (![...root.childNodes].every(node => node.nodeType === Node.COMMENT_NODE ||
    (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) || node instanceof HTMLImageElement)) return undefined
  const images = [...root.children] as HTMLImageElement[]
  return images.length ? images : undefined
}

export const isResponsiveHtmlLayoutContainer = (element: HTMLElement): boolean =>
  !!directImages(element) && element.style.width === '100%' && !!element.style.aspectRatio &&
  pixelValue(element.style.maxWidth) !== undefined

const translation = (style: CSSStyleDeclaration): { x: number; y: number } | undefined => {
  if ([style.getPropertyValue('scale'), style.getPropertyValue('rotate')].some(value => value && value !== 'none')) return undefined
  let x = 0
  let y = 0
  const independent = style.getPropertyValue('translate')
  if (independent && independent !== 'none') {
    const values = independent.trim().split(/\s+/).map(pixelValue)
    if (!values.length || values.length > 2 || values.some(value => value === undefined)) return undefined
    x += values[0]!
    y += values[1] ?? 0
  }
  const transform = style.transform.trim()
  if (!transform || transform === 'none') return { x, y }
  const pattern = /(translate(?:X|Y)?|matrix)\(([^)]+)\)/gi
  let end = 0
  for (const match of transform.matchAll(pattern)) {
    if (transform.slice(end, match.index).trim()) return undefined
    end = match.index! + match[0].length
    const type = match[1]!.toLowerCase()
    const values = match[2]!.trim().split(/\s*,\s*|\s+/)
    if (type === 'matrix') {
      const matrix = values.map(Number)
      if (matrix.length !== 6 || matrix.some(value => !Number.isFinite(value)) ||
        matrix[0] !== 1 || matrix[1] !== 0 || matrix[2] !== 0 || matrix[3] !== 1) return undefined
      x += matrix[4]!
      y += matrix[5]!
    } else {
      const offsets = values.map(pixelValue)
      if (!offsets.length || offsets.length > (type === 'translate' ? 2 : 1) || offsets.some(value => value === undefined)) return undefined
      if (type === 'translatey') y += offsets[0]!
      else {
        x += offsets[0]!
        if (type === 'translate') y += offsets[1] ?? 0
      }
    }
  }
  return end === transform.length ? { x, y } : undefined
}

const includeImageBounds = (group: ResponsiveGroup): ResponsiveGroup => {
  const left = Math.min(0, ...group.images.map(image => image.box.left))
  const top = Math.min(0, ...group.images.map(image => image.box.top))
  const right = Math.max(group.width, ...group.images.map(image => image.box.left + image.box.width))
  const bottom = Math.max(group.height, ...group.images.map(image => image.box.top + image.box.height))
  if (left === 0 && top === 0 && right === group.width && bottom === group.height) return group
  // An old frame can omit part of a positioned image; the entire visual group shares one new origin and scale.
  return {
    ...group,
    maximumWidth: group.maximumWidth ?? group.width,
    width: right - left,
    height: bottom - top,
    images: group.images.map(image => ({ ...image, box: { ...image.box, left: image.box.left - left, top: image.box.top - top } }))
  }
}

const legacyGroup = (root: HTMLElement): ResponsiveGroup | undefined => {
  const images = directImages(root)
  if (!images || root.hidden || !['relative', 'absolute'].includes(root.style.position) || !translation(root.style)) return undefined
  const borders = bordersFromStyle(root.style)
  const padding = ['left', 'top', 'right', 'bottom'].map(side => stylePixels(root.style, `padding-${side}`))
  const declaredWidth = pixelValue(root.style.width)
  const declaredHeight = pixelValue(root.style.height) ?? pixelValue(root.style.minHeight)
  if (!borders || padding.some(value => value === undefined) || !declaredWidth || !declaredHeight || declaredWidth <= 0 || declaredHeight <= 0) return undefined
  const contentBox = root.style.boxSizing !== 'border-box'
  const width = declaredWidth + (contentBox ? padding[0]! + padding[2]! + borders.left + borders.right : 0)
  const height = declaredHeight + (contentBox ? padding[1]! + padding[3]! + borders.top + borders.bottom : 0)
  const snapshots: ResponsiveGroup['images'] = []
  for (const image of images) {
    const style = image.style
    const offset = translation(style)
    const left = pixelValue(style.left)
    const top = pixelValue(style.top)
    const imageWidth = pixelValue(style.width) ?? Number(image.getAttribute('width'))
    const imageHeight = pixelValue(style.height) ?? Number(image.getAttribute('height'))
    const imageBorders = bordersFromStyle(style)
    const imagePadding = ['left', 'top', 'right', 'bottom'].map(side => stylePixels(style, `padding-${side}`))
    const marginLeft = stylePixels(style, 'margin-left')
    const marginTop = stylePixels(style, 'margin-top')
    if (style.position !== 'absolute' || image.hidden || !offset || !imageBorders || left === undefined || top === undefined ||
      !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0 ||
      imagePadding.some(value => value === undefined) || marginLeft === undefined || marginTop === undefined) return undefined
    const imageContentBox = style.boxSizing !== 'border-box'
    snapshots.push({
      element: image,
      box: {
        left: borders.left + left + marginLeft + offset.x,
        top: borders.top + top + marginTop + offset.y,
        width: imageWidth + (imageContentBox ? imagePadding[0]! + imagePadding[2]! + imageBorders.left + imageBorders.right : 0),
        height: imageHeight + (imageContentBox ? imagePadding[1]! + imagePadding[3]! + imageBorders.top + imageBorders.bottom : 0)
      }
    })
  }
  return includeImageBounds({ root, width, height, borders, images: snapshots })
}

/** Absolute percentages use the padding box; measured rectangles include the border. */
export const responsiveHtmlLayoutLength = (value: number, extent: number, borderTotal = 0, borderStart = 0): string => {
  if (![value, extent, borderTotal, borderStart].every(Number.isFinite) || extent <= 0) throw new Error('Invalid responsive HTML geometry.')
  const ratio = value / extent
  const correction = ratio * borderTotal - borderStart
  const percent = `${numberText(ratio * 100)}%`
  return Math.abs(correction) < 1e-10 ? percent : `calc(${percent} ${correction < 0 ? '-' : '+'} ${numberText(Math.abs(correction))}px)`
}

const resolvedLayoutLength = (value: string, extent: number): number | undefined => {
  const decimal = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const percent = new RegExp(`^(${decimal})%$`).exec(value)
  if (percent) return Number(percent[1]) * extent / 100
  const calculation = new RegExp(`^calc\\(\\s*(${decimal})%\\s*([+-])\\s*(${decimal})px\\s*\\)$`).exec(value)
  if (calculation) return Number(calculation[1]) * extent / 100 + Number(calculation[3]) * (calculation[2] === '-' ? -1 : 1)
  return pixelValue(value)
}

/** Logical CSS geometry avoids independent layout rounding turning exact edge contact into an overlap. */
export const responsiveHtmlLayoutImageRectangle = (image: HTMLImageElement): LayoutBox | undefined => {
  const root = image.parentElement
  if (!root || !isResponsiveHtmlLayoutContainer(root)) return undefined
  const rootStyle = getComputedStyle(root)
  const imageStyle = getComputedStyle(image)
  const offset = translation(imageStyle)
  if (!translation(rootStyle) || !offset || offset.x !== 0 || offset.y !== 0 || imageStyle.position !== 'absolute' ||
    imageStyle.boxSizing !== 'border-box' || ['left', 'top', 'right', 'bottom'].some(side => stylePixels(imageStyle, `margin-${side}`) !== 0) ||
    ['left', 'top', 'width', 'height'].some(property => image.style.getPropertyPriority(property) !== 'important')) return undefined
  if (stylePixels(imageStyle, 'min-width') !== 0 || stylePixels(imageStyle, 'min-height') !== 0 ||
    imageStyle.maxWidth !== 'none' || imageStyle.maxHeight !== 'none') return undefined
  const borders = bordersFromStyle(rootStyle)
  const rect = root.getBoundingClientRect()
  if (!borders || rect.width <= 0 || rect.height <= 0) return undefined
  const paddingWidth = rect.width - borders.left - borders.right
  const paddingHeight = rect.height - borders.top - borders.bottom
  const left = resolvedLayoutLength(image.style.left, paddingWidth)
  const top = resolvedLayoutLength(image.style.top, paddingHeight)
  const width = resolvedLayoutLength(image.style.width, paddingWidth)
  const height = resolvedLayoutLength(image.style.height, paddingHeight)
  if (![left, top, width, height].every(value => value !== undefined && Number.isFinite(value)) || width! <= 0 || height! <= 0) return undefined
  const imageBorders = bordersFromStyle(imageStyle)
  const padding = ['left', 'top', 'right', 'bottom'].map(side => stylePixels(imageStyle, `padding-${side}`))
  if (!imageBorders || padding.some(value => value === undefined) ||
    imageBorders.left + imageBorders.right + padding[0]! + padding[2]! > width! ||
    imageBorders.top + imageBorders.bottom + padding[1]! + padding[3]! > height!) return undefined
  const rectangle = { left: rect.left + borders.left + left!, top: rect.top + borders.top + top!, width: width!, height: height! }
  const painted = image.getBoundingClientRect()
  // CSS constraints or another containing block can invalidate the declared formulas; only layout noise may differ.
  if (['left', 'top', 'width', 'height'].some(property => Math.abs(rectangle[property as keyof LayoutBox] - painted[property as keyof LayoutBox]) > 1 / 32)) return undefined
  return rectangle
}

const writeResponsiveGroup = (group: ResponsiveGroup): void => {
  const { root, width, height, borders } = group
  const set = (element: HTMLElement, property: string, value: string) => element.style.setProperty(property, value, 'important')
  set(root, 'position', 'relative')
  set(root, 'width', '100%')
  set(root, 'max-width', `${numberText(group.maximumWidth ?? width)}px`)
  set(root, 'min-width', '0')
  set(root, 'height', 'auto')
  set(root, 'min-height', '0')
  set(root, 'max-height', 'none')
  set(root, 'aspect-ratio', `${numberText(width)} / ${numberText(height)}`)
  set(root, 'box-sizing', 'border-box')
  // Padding has already been included in the captured image positions.
  set(root, 'padding', '0')
  for (const { element, box } of group.images) {
    set(element, 'position', 'absolute')
    set(element, 'left', responsiveHtmlLayoutLength(box.left, width, borders.left + borders.right, borders.left))
    set(element, 'top', responsiveHtmlLayoutLength(box.top, height, borders.top + borders.bottom, borders.top))
    set(element, 'width', responsiveHtmlLayoutLength(box.width, width, borders.left + borders.right))
    set(element, 'height', responsiveHtmlLayoutLength(box.height, height, borders.top + borders.bottom))
    set(element, 'min-width', '0')
    set(element, 'max-width', 'none')
    set(element, 'min-height', '0')
    set(element, 'max-height', 'none')
    set(element, 'box-sizing', 'border-box')
    set(element, 'margin', '0')
    set(element, 'transform', 'none')
    set(element, 'translate', 'none')
    set(element, 'right', 'auto')
    set(element, 'bottom', 'auto')
  }
}

/** The returned markup is render-only. The caller must still sanitize it before mounting. */
export const transformResponsiveHtmlPreview = (html: string): string => {
  const model = createHtmlLayoutDocument(html)
  const template = document.createElement('template')
  template.innerHTML = model.previewHtml
  let changed = false
  for (const target of model.targets.filter(target => target.kind === 'container')) {
    const root = template.content.querySelector<HTMLElement>(`[${model.markerAttribute}="${target.id}"]`)
    const group = root && legacyGroup(root)
    if (!group) continue
    writeResponsiveGroup(group)
    changed = true
  }
  if (!changed) return html
  for (const element of template.content.querySelectorAll(`[${model.markerAttribute}]`)) element.removeAttribute(model.markerAttribute)
  return template.innerHTML
}

export const prepareResponsiveHtmlLayoutPreview = (model: HtmlLayoutDocument): string =>
  transformResponsiveHtmlPreview(model.previewHtml)

const openingAttributes = (source: string, start: number): { attributes: OpeningAttribute[]; insertion: number } | undefined => {
  const name = /^<[a-z][\w:-]*/i.exec(source.slice(start))
  if (!name) return undefined
  const insertion = start + name[0].length
  const attributes: OpeningAttribute[] = []
  let offset = insertion
  while (offset < source.length) {
    while (/\s/.test(source[offset] ?? '')) offset++
    if (source[offset] === '>' || (source[offset] === '/' && source[offset + 1] === '>')) return { attributes, insertion }
    const attributeStart = offset
    while (offset < source.length && !/[\s=/>]/.test(source[offset]!)) offset++
    if (offset === attributeStart) return undefined
    const attributeName = source.slice(attributeStart, offset).toLowerCase()
    const nameEnd = offset
    while (/\s/.test(source[offset] ?? '')) offset++
    let quote = ''
    let valueStart = offset
    let valueEnd = offset
    if (source[offset] === '=') {
      offset++
      while (/\s/.test(source[offset] ?? '')) offset++
      quote = source[offset] === '"' || source[offset] === "'" ? source[offset]! : ''
      if (quote) offset++
      valueStart = offset
      while (offset < source.length && (quote ? source[offset] !== quote : !/[\s>]/.test(source[offset]!))) offset++
      valueEnd = offset
      if (quote && source[offset] !== quote) return undefined
      if (quote) offset++
    } else offset = nameEnd
    attributes.push({ name: attributeName, start: attributeStart, end: offset, valueStart, valueEnd, quote })
  }
  return undefined
}

const escapeStyle = (value: string, quote: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')

const patchStyle = (source: string, target: HtmlLayoutTarget, value: string): { start: number; end: number; value: string } | undefined => {
  const offset = /^html-layout-(\d+)$/.exec(target.id)
  const opening = offset && openingAttributes(source, Number(offset[1]))
  if (!opening) return undefined
  const styles = opening.attributes.filter(attribute => attribute.name === 'style')
  if (styles.length > 1) return undefined
  const attribute = styles[0]
  if (attribute?.quote) return { start: attribute.valueStart, end: attribute.valueEnd, value: escapeStyle(value, attribute.quote) }
  if (attribute) return { start: attribute.start, end: attribute.end, value: `style="${escapeStyle(value, '"')}"` }
  return { start: opening.insertion, end: opening.insertion, value: ` style="${escapeStyle(value, '"')}"` }
}

const renderedGroup = (root: HTMLElement): ResponsiveGroup | undefined => {
  const images = directImages(root)
  if (!images) return undefined
  const style = getComputedStyle(root)
  if (!translation(style)) return undefined
  const borders = bordersFromStyle(style)
  const rect = root.getBoundingClientRect()
  if (!borders || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return undefined
  const snapshots: ResponsiveGroup['images'] = []
  for (const image of images) {
    const imageStyle = getComputedStyle(image)
    const box = image.getBoundingClientRect()
    if (imageStyle.position !== 'absolute' || !translation(imageStyle) || image.hidden ||
      !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) return undefined
    snapshots.push({ element: image, box: { left: box.left - rect.left, top: box.top - rect.top, width: box.width, height: box.height } })
  }
  return includeImageBounds({ root, width: rect.width, height: rect.height, borders, images: snapshots })
}

const designMaximumWidth = (root: HTMLElement, fallback: number): number => {
  const declared = pixelValue(root.style.maxWidth) ?? pixelValue(root.style.width)
  if (!declared || declared <= 0) return fallback
  if (root.style.boxSizing === 'border-box') return declared
  const borders = bordersFromStyle(root.style)
  const left = stylePixels(root.style, 'padding-left')
  const right = stylePixels(root.style, 'padding-right')
  return borders && left !== undefined && right !== undefined ? declared + borders.left + borders.right + left + right : fallback
}

/** Only changed drafts and complete direct-image groups are patched; URLs and non-style source bytes stay intact. */
export const serializeResponsiveHtmlLayout = (model: HtmlLayoutDocument, renderedStage: HTMLElement, sourceResult: string): string => {
  if (sourceResult === model.source) return sourceResult
  const nextModel = createHtmlLayoutDocument(sourceResult)
  const template = document.createElement('template')
  template.innerHTML = nextModel.previewHtml
  const originalTemplate = document.createElement('template')
  originalTemplate.innerHTML = model.previewHtml
  const targetsByPath = new Map(nextModel.targets.map(target => [target.path.join('/'), target]))
  const patches: { start: number; end: number; value: string }[] = []
  for (const target of model.targets.filter(target => target.kind === 'container')) {
    const root = renderedStage.querySelector<HTMLElement>(`[${model.markerAttribute}="${target.id}"]`)
    const group = root && renderedGroup(root)
    const nextTarget = targetsByPath.get(target.path.join('/'))
    const nextRoot = nextTarget && template.content.querySelector<HTMLElement>(`[${nextModel.markerAttribute}="${nextTarget.id}"]`)
    const nextImages = nextRoot && directImages(nextRoot)
    const originalRoot = originalTemplate.content.querySelector<HTMLElement>(`[${model.markerAttribute}="${target.id}"]`)
    const originalImages = originalRoot && directImages(originalRoot)
    if (!group || !nextRoot || !nextTarget || !nextImages || !originalRoot || !originalImages ||
      nextImages.length !== group.images.length || originalImages.length !== nextImages.length || target.tagName !== nextTarget.tagName) continue
    if (originalRoot.getAttribute('style') === nextRoot.getAttribute('style') &&
      originalImages.every((image, index) => image.getAttribute('style') === nextImages[index]!.getAttribute('style'))) continue
    const nextGroup: ResponsiveGroup = {
      ...group,
      root: nextRoot,
      maximumWidth: designMaximumWidth(originalRoot, group.width),
      images: group.images.map((image, index) => ({ element: nextImages[index]!, box: image.box }))
    }
    writeResponsiveGroup(nextGroup)
    const groupPatches = [patchStyle(sourceResult, nextTarget, nextRoot.style.cssText)]
    for (const image of nextImages) {
      const imageTarget = nextModel.targets.find(candidate => candidate.id === image.getAttribute(nextModel.markerAttribute))
      groupPatches.push(imageTarget ? patchStyle(sourceResult, imageTarget, image.style.cssText) : undefined)
    }
    if (groupPatches.every(patch => patch !== undefined)) patches.push(...groupPatches as { start: number; end: number; value: string }[])
  }
  let result = sourceResult
  for (const patch of patches.sort((first, second) => second.start - first.start)) result = result.slice(0, patch.start) + patch.value + result.slice(patch.end)
  return result
}
