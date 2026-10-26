export interface HtmlLayoutTarget {
  id: string
  path: number[]
  kind: 'image' | 'text' | 'container'
  tagName: string
  label: string
  text: string
  textEditable: boolean
  src?: string
  canMovePrevious: boolean
  canMoveNext: boolean
}

export interface HtmlLayoutDocument {
  source: string
  previewHtml: string
  markerAttribute: string
  /** Leaf objects retain their order; complete enclosing groups follow them. */
  targets: HtmlLayoutTarget[]
  rootContainer: boolean
  rootTargetId?: string
}

export interface HtmlLayoutEdit {
  id: string
  width?: number
  height?: number
  preservePaddingBottom?: boolean
  offsetX?: number
  offsetY?: number
  text?: string
  fontSize?: number
  color?: string
  clearPaddingTop?: boolean
  position?: 'relative' | 'absolute'
  left?: number
  top?: number
  resetTransform?: boolean
}

export interface HtmlLayoutOptions {
  minimumHeight?: number
}

interface SourceAttribute {
  name: string
  valueStart: number
  valueEnd: number
  start: number
  end: number
  quote: string
}

interface SourceElement {
  id: string
  tagName: string
  start: number
  nameEnd: number
  openingEnd: number
  contentEnd: number | null
  completeEnd: number | null
  attributes: SourceAttribute[]
}

interface SourcePatch {
  start: number
  end: number
  value: string
}

const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const RAW_TEXT_TAGS = new Set('script style textarea title iframe xmp noembed noframes plaintext'.split(' '))
const EXCLUDED_TAGS = new Set('script style template iframe object embed noscript textarea title head svg math'.split(' '))
const TEXT_TAGS = new Set('p div section article aside header footer main blockquote pre h1 h2 h3 h4 h5 h6 li figcaption td th span label dd dt address'.split(' '))
const CONTAINER_TAGS = new Set('div section figure article table'.split(' '))

const applyPatches = (source: string, patches: SourcePatch[]): string => {
  let result = source
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, patch.start) + patch.value + result.slice(patch.end)
  }
  return result
}

const readAttributes = (source: string, start: number, end: number): SourceAttribute[] => {
  const attributes: SourceAttribute[] = []
  let offset = start
  while (offset < end) {
    while (/\s/.test(source[offset] ?? '')) offset++
    if (offset >= end || source[offset] === '/' || source[offset] === '>') break
    const attributeStart = offset
    while (offset < end && !/[\s=/>]/.test(source[offset] ?? '')) offset++
    const name = source.slice(attributeStart, offset).toLowerCase()
    const attributeNameEnd = offset
    while (/\s/.test(source[offset] ?? '')) offset++
    let quote = ''
    let hasValue = false
    let valueStart = offset
    let valueEnd = offset
    if (source[offset] === '=') {
      hasValue = true
      offset++
      while (/\s/.test(source[offset] ?? '')) offset++
      quote = source[offset] === '"' || source[offset] === "'" ? source[offset] ?? '' : ''
      if (quote) offset++
      valueStart = offset
      while (offset < end && (quote ? source[offset] !== quote : !/[\s>]/.test(source[offset] ?? ''))) offset++
      valueEnd = offset
      if (quote && source[offset] === quote) offset++
    }
    attributes.push({ name, valueStart, valueEnd, quote, start: attributeStart, end: hasValue ? offset : attributeNameEnd })
    if (offset === attributeStart) offset++
  }
  return attributes
}

const scanSourceElements = (source: string): SourceElement[] => {
  const records: SourceElement[] = []
  const stack: SourceElement[] = []
  let offset = 0
  while (offset < source.length) {
    const start = source.indexOf('<', offset)
    if (start < 0) break
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4)
      offset = end < 0 ? source.length : end + 3
      continue
    }
    const match = /^<\/?([a-z][\w:-]*)\b/i.exec(source.slice(start))
    if (!match?.[1]) {
      offset = start + 1
      continue
    }
    const tagName = match[1].toLowerCase()
    let end = start + match[0].length
    let quote = ''
    for (; end < source.length; end++) {
      const char = source[end]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
    }
    if (end === source.length) break
    offset = end + 1
    if (source[start + 1] === '/') {
      let index = stack.length - 1
      while (index >= 0 && stack[index]?.tagName !== tagName) index--
      if (index >= 0) {
        const record = stack[index]
        if (record) {
          record.contentEnd = start
          record.completeEnd = end + 1
        }
        stack.length = index
      }
      continue
    }
    const nameEnd = start + match[0].length
    const record: SourceElement = {
      id: `html-layout-${start}`,
      tagName,
      start,
      nameEnd,
      openingEnd: end + 1,
      contentEnd: null,
      completeEnd: VOID_TAGS.has(tagName) ? end + 1 : null,
      attributes: readAttributes(source, nameEnd, end)
    }
    records.push(record)
    if (!VOID_TAGS.has(tagName)) stack.push(record)
    if (RAW_TEXT_TAGS.has(tagName)) {
      const closing = new RegExp(`</${tagName}\\s*>`, 'ig')
      closing.lastIndex = offset
      const found = closing.exec(source)
      offset = found ? found.index : source.length
    }
  }
  return records
}

const hiddenElement = (element: Element): boolean => {
  const style = (element as HTMLElement).style
  return EXCLUDED_TAGS.has(element.tagName.toLowerCase()) || element.hasAttribute('hidden') ||
    style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' ||
    style?.opacity === '0'
}

const visibleText = (element: Element): string => {
  if (hiddenElement(element)) return ''
  return Array.from(element.childNodes).map(node =>
    node.nodeType === Node.TEXT_NODE
      ? node.textContent ?? ''
      : node.nodeType === Node.ELEMENT_NODE ? visibleText(node as Element) : ''
  ).join('')
}

const hasPlainTextSource = (source: string, record: SourceElement | undefined, text: string): boolean => {
  if (!record || record.contentEnd === null) return false
  const content = document.createElement('template')
  content.innerHTML = source.slice(record.openingEnd, record.contentEnd)
  // HTML parsing can close a paragraph before its explicit end tag. A DOM
  // text-only paragraph can therefore still enclose other source elements.
  return Array.from(content.content.childNodes).every(node => node.nodeType === Node.TEXT_NODE) &&
    content.content.textContent === text
}

const elementPath = (element: Element, root: DocumentFragment): number[] => {
  const path: number[] = []
  let current: Element | null = element
  while (current) {
    const parent: ParentNode | null = current.parentNode
    if (!parent) break
    path.unshift(Array.from(parent.children).indexOf(current))
    current = parent === root ? null : current.parentElement
  }
  return path
}

const parseLayout = (source: string) => {
  const records = scanSourceElements(source)
  let markerAttribute = 'data-mt-html-layout'
  while (new RegExp(`\\b${markerAttribute}\\b`, 'i').test(source)) markerAttribute += '-x'
  const previewSource = applyPatches(source, records.map(record => ({
    start: record.nameEnd, end: record.nameEnd, value: ` ${markerAttribute}="${record.id}"`
  })))
  const template = document.createElement('template')
  template.innerHTML = previewSource
  const elements = new Map<string, HTMLElement>()
  const duplicateIds = new Set<string>()
  for (const element of template.content.querySelectorAll<HTMLElement>(`[${markerAttribute}]`)) {
    const id = element.getAttribute(markerAttribute)
    if (!id) continue
    if (elements.has(id)) duplicateIds.add(id)
    elements.set(id, element)
  }
  for (const id of duplicateIds) elements.delete(id)
  const recordById = new Map(records.map(record => [record.id, record]))
  const isVisible = (element: Element): boolean => {
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      if (hiddenElement(parent)) return false
    }
    return true
  }
  const candidates = Array.from(elements.values()).filter(element => {
    if (!isVisible(element)) return false
    const tagName = element.tagName.toLowerCase()
    return tagName === 'img' || (TEXT_TAGS.has(tagName) && (!!visibleText(element).trim() || element.hasAttribute('data-mt-textbox')))
  })
  const leaves = candidates.filter(element => !candidates.some(child => child !== element && element.contains(child)))
  const completeContainer = (element: Element): boolean => {
    const id = element.getAttribute(markerAttribute)
    const record = id ? recordById.get(id) : undefined
    if (!record?.completeEnd || record.contentEnd === null) return false
    const contentEnd = record.contentEnd
    // Foster parenting and reconstructed formatting can move source children
    // outside their container. Such groups cannot identify a complete object.
    return records.filter(child => child.start >= record.openingEnd && child.start < contentEnd).every(child => {
      const descendant = elements.get(child.id)
      return !!descendant && element.contains(descendant)
    }) && Array.from(element.querySelectorAll(`[${markerAttribute}]`)).every(descendant => {
      const childId = descendant.getAttribute(markerAttribute)
      const child = childId ? recordById.get(childId) : undefined
      return !!child && child.start >= record.openingEnd && child.start < contentEnd
    })
  }
  const containerTagAllowed = (element: Element): boolean => CONTAINER_TAGS.has(element.tagName.toLowerCase()) ||
    (element.tagName === 'P' && leaves.some(leaf => leaf.tagName === 'IMG' && element.contains(leaf)))
  const containers = Array.from(elements.values()).filter(element =>
    containerTagAllowed(element) && isVisible(element) && !leaves.includes(element) &&
    (leaves.some(leaf => element.contains(leaf)) || (element.parentNode === template.content && !element.children.length && !element.textContent?.trim())) && completeContainer(element)
  )
  const containerIds = new Set(containers.map(element => element.getAttribute(markerAttribute)))
  const selected = [...leaves, ...containers]
  const selectedIds = new Set(selected.map(element => element.getAttribute(markerAttribute)))
  const targets: HtmlLayoutTarget[] = selected.map(element => {
    const id = element.getAttribute(markerAttribute) ?? ''
    const record = recordById.get(id)
    const tagName = element.tagName.toLowerCase()
    const container = containerIds.has(id)
    const text = element.textContent ?? ''
    const neighborAvailable = (neighbor: Element | null): boolean => {
      const neighborId = neighbor?.getAttribute(markerAttribute)
      const neighborRecord = neighborId ? recordById.get(neighborId) : undefined
      return !!(record?.completeEnd && neighborRecord?.completeEnd && selectedIds.has(neighborId ?? null) &&
        (record.completeEnd <= neighborRecord.start || neighborRecord.completeEnd <= record.start))
    }
    return {
      id,
      path: elementPath(element, template.content),
      kind: container ? 'container' : tagName === 'img' ? 'image' : 'text',
      tagName,
      label: (container
        ? `${tagName}${element.id ? `#${element.id}` : ''}${element.className ? `.${element.className.trim().replace(/\s+/g, '.')}` : ''}`
        : tagName === 'img' ? element.getAttribute('alt') || element.getAttribute('src') || 'img' : visibleText(element) || '文字框').trim().replace(/\s+/g, ' ').slice(0, 100),
      text,
      textEditable: !container && tagName !== 'img' && hasPlainTextSource(source, record, text) &&
        Array.from(element.childNodes).every(node => node.nodeType === Node.TEXT_NODE),
      src: tagName === 'img' ? element.getAttribute('src') ?? '' : undefined,
      canMovePrevious: neighborAvailable(element.previousElementSibling),
      canMoveNext: neighborAvailable(element.nextElementSibling)
    }
  })
  const root = template.content.children.length === 1 ? template.content.firstElementChild : null
  const rootId = root?.getAttribute(markerAttribute)
  const rootRecord = rootId ? recordById.get(rootId) : undefined
  const rootContainer = !!(root && rootRecord?.completeEnd && completeContainer(root) &&
    containerTagAllowed(root) &&
    Array.from(template.content.childNodes).every(node => node === root ||
      node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())))
  const rootTargetId = rootContainer && selectedIds.has(rootId ?? null) ? rootId ?? undefined : undefined
  return { template, markerAttribute, targets, elements, recordById, rootContainer, rootId, rootTargetId }
}

/** Paths and markers belong to this source snapshot; preview URLs never enter the saved source. */
export const createHtmlLayoutDocument = (
  source: string,
  resolveImageSrc?: (src: string) => string
): HtmlLayoutDocument => {
  const parsed = parseLayout(source)
  const targetIds = new Set(parsed.targets.map(target => target.id))
  // Source mapping also needs wrappers, but the visible preview must expose
  // selection markers only for objects that the edit API can modify.
  for (const element of parsed.template.content.querySelectorAll(`[${parsed.markerAttribute}]`)) {
    if (!targetIds.has(element.getAttribute(parsed.markerAttribute) ?? '')) {
      element.removeAttribute(parsed.markerAttribute)
    }
  }
  if (resolveImageSrc) {
    for (const image of parsed.template.content.querySelectorAll('img[src]')) {
      image.setAttribute('src', resolveImageSrc(image.getAttribute('src') ?? ''))
    }
  }
  return {
    source,
    previewHtml: parsed.template.innerHTML,
    markerAttribute: parsed.markerAttribute,
    targets: parsed.targets,
    rootContainer: parsed.rootContainer,
    rootTargetId: parsed.rootTargetId
  }
}

const escapeAttribute = (value: string, quote: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n|\r|\n/g, '&#10;')

const pixels = (value: number, positive = false): string => {
  if (!Number.isFinite(value) || (positive && value <= 0)) throw new Error('Invalid layout size or offset.')
  // Rounding measured sizes can cross Chromium's subpixel layout floor and separate snapped edges after saving.
  return `${value}px`
}

/** Offsets are total deltas in pixels from the snapshot, rather than increments from the last edit. */
export const applyHtmlLayoutEdits = (
  model: HtmlLayoutDocument,
  edits: HtmlLayoutEdit[],
  options: HtmlLayoutOptions = {}
): string => {
  if (!edits.length) return model.source
  const parsed = parseLayout(model.source)
  const combined = new Map<string, HtmlLayoutEdit>()
  for (const edit of edits) combined.set(edit.id, { ...combined.get(edit.id), ...edit })
  const patches: SourcePatch[] = []
  const styleChanges = new Map<string, string[]>()
  const setStyle = (id: string, element: HTMLElement, property: string, value: string) => {
    const existing = element.style.getPropertyValue(property)
    if (existing !== value && !(value === '0' && existing === '0px')) {
      const declarations = styleChanges.get(id) ?? []
      const shorthand = property.startsWith('padding-') ? 'padding' : property.startsWith('margin-') ? 'margin' : ''
      const priority = element.style.getPropertyPriority(property) || (shorthand ? element.style.getPropertyPriority(shorthand) : '')
      const declaration = `${property}: ${value}${priority ? ' !important' : ''};`
      if (!declarations.includes(declaration)) declarations.push(declaration)
      styleChanges.set(id, declarations)
    }
  }
  for (const edit of combined.values()) {
    const target = parsed.targets.find(target => target.id === edit.id)
    const record = parsed.recordById.get(edit.id)
    const element = parsed.elements.get(edit.id)
    if (!target || !record || !element) throw new Error('The HTML layout target is no longer available.')
    if (edit.fontSize !== undefined || edit.color !== undefined) {
      if (target.kind !== 'text') throw new Error('Only text objects can have text styles.')
      if (edit.fontSize !== undefined) setStyle(edit.id, element, 'font-size', pixels(edit.fontSize, true))
      if (edit.color !== undefined) {
        if (!/^#[\da-f]{6}$/i.test(edit.color)) throw new Error('Invalid text color.')
        setStyle(edit.id, element, 'color', edit.color)
      }
    }
    if (edit.position !== undefined) {
      if (!['relative', 'absolute'].includes(edit.position)) throw new Error('Invalid layout position.')
      setStyle(edit.id, element, 'position', edit.position)
    }
    if (edit.left !== undefined) setStyle(edit.id, element, 'left', pixels(edit.left))
    if (edit.top !== undefined) setStyle(edit.id, element, 'top', pixels(edit.top))
    if (edit.width !== undefined) {
      setStyle(edit.id, element, 'width', pixels(edit.width, true))
      setStyle(edit.id, element, 'min-width', '0')
      setStyle(edit.id, element, 'max-width', 'none')
    }
    if (edit.height !== undefined) {
      setStyle(edit.id, element, 'height', pixels(edit.height, true))
      setStyle(edit.id, element, 'min-height', '0')
      setStyle(edit.id, element, 'max-height', 'none')
      if (target.kind === 'container' && !edit.preservePaddingBottom) setStyle(edit.id, element, 'padding-bottom', '0')
    }
    if (target.kind === 'container' && edit.clearPaddingTop) setStyle(edit.id, element, 'padding-top', '0')
    if (edit.width !== undefined || edit.height !== undefined) {
      setStyle(edit.id, element, 'box-sizing', 'border-box')
    }
    if (['span', 'label'].includes(target.tagName) &&
      (edit.width !== undefined || edit.height !== undefined || edit.offsetX || edit.offsetY) &&
      ['', 'inline'].includes(element.style.display)) {
      setStyle(edit.id, element, 'display', 'inline-block')
    }
    if (edit.resetTransform) setStyle(edit.id, element, 'transform', 'none')
    if (edit.offsetX !== undefined || edit.offsetY !== undefined) {
      const x = edit.offsetX ?? 0
      const y = edit.offsetY ?? 0
      const translation = `translate(${pixels(x)}, ${pixels(y)})`
      if (x || y) {
        const original = edit.resetTransform ? 'none' : element.style.transform
        setStyle(edit.id, element, 'transform', original && original !== 'none' ? `${translation} ${original}` : translation)
      }
      if (y && edit.id === parsed.rootId && target.kind === 'container') {
        const original = element.style.marginBottom
        const margin = original && !['auto', 'initial', 'inherit', 'unset', 'revert', 'revert-layer'].includes(original) ? original : '0px'
        // Author negative margins must not consume the space reserved for a downward move.
        setStyle(edit.id, element, 'margin-bottom', `max(0px, ${pixels(y)}, calc(${margin} + ${pixels(y)}))`)
      }
    }
    if (edit.text !== undefined && edit.text !== target.text) {
      if (!target.textEditable || record.contentEnd === null) throw new Error('Only plain text blocks can be edited.')
      patches.push({ start: record.openingEnd, end: record.contentEnd, value: escapeText(edit.text) })
    }
  }
  if (styleChanges.size && options.minimumHeight !== undefined && parsed.rootContainer && parsed.rootId) {
    const root = parsed.elements.get(parsed.rootId)
    if (root) {
      const requested = pixels(options.minimumHeight, true)
      const existing = combined.get(parsed.rootId)?.height !== undefined ? '' : root.style.minHeight
      const minimum = /^\d+(?:\.\d+)?px$/.test(existing)
        ? pixels(Math.max(parseFloat(existing), options.minimumHeight), true)
        : existing && !['auto', 'initial', 'inherit', 'unset', 'revert', 'revert-layer'].includes(existing)
          ? `max(${existing}, ${requested})`
          : requested
      setStyle(parsed.rootId, root, 'min-height', minimum)
      setStyle(parsed.rootId, root, 'box-sizing', 'border-box')
    }
  }
  for (const [id, declarations] of styleChanges) {
    const record = parsed.recordById.get(id)
    const element = parsed.elements.get(id)
    if (!record || !element) continue
    const attribute = record.attributes.find(attribute => attribute.name === 'style')
    const existing = element.getAttribute('style') ?? ''
    const separator = existing && !existing.trimEnd().endsWith(';') ? '; ' : existing ? ' ' : ''
    const addition = separator + declarations.join(' ')
    if (attribute?.quote) {
      patches.push({ start: attribute.valueEnd, end: attribute.valueEnd, value: escapeAttribute(addition, attribute.quote) })
    } else if (attribute) {
      patches.push({ start: attribute.start, end: attribute.end, value: `style="${escapeAttribute(existing + addition, '"')}"` })
    } else {
      patches.push({ start: record.nameEnd, end: record.nameEnd, value: ` style="${escapeAttribute(addition, '"')}"` })
    }
  }
  return applyPatches(model.source, patches)
}

export const reorderHtmlLayoutTarget = (
  model: HtmlLayoutDocument,
  id: string,
  direction: 'previous' | 'next'
): string => {
  const parsed = parseLayout(model.source)
  const target = parsed.targets.find(target => target.id === id)
  if (!target || !(direction === 'previous' ? target.canMovePrevious : target.canMoveNext)) return model.source
  const element = parsed.elements.get(id)
  const neighbor = direction === 'previous' ? element?.previousElementSibling : element?.nextElementSibling
  const neighborId = neighbor?.getAttribute(parsed.markerAttribute)
  const record = parsed.recordById.get(id)
  const neighborRecord = neighborId ? parsed.recordById.get(neighborId) : undefined
  if (!record?.completeEnd || !neighborRecord?.completeEnd) return model.source
  return applyPatches(model.source, [
    { start: record.start, end: record.completeEnd, value: model.source.slice(neighborRecord.start, neighborRecord.completeEnd) },
    { start: neighborRecord.start, end: neighborRecord.completeEnd, value: model.source.slice(record.start, record.completeEnd) }
  ])
}

const removeHtmlLayoutObject = (model: HtmlLayoutDocument, id: string, kind: 'image' | 'text'): string => {
  const parsed = parseLayout(model.source)
  if (parsed.targets.find(target => target.id === id)?.kind !== kind || (kind === 'text' && id === parsed.rootId)) return model.source
  const record = parsed.recordById.get(id)
  if (!record?.completeEnd) return model.source
  const lineStart = model.source.lastIndexOf('\n', record.start - 1) + 1
  const trailing = /^[ \t\r]*(?:\n|$)/.exec(model.source.slice(record.completeEnd))
  const standalone = /^[ \t\r]*$/.test(model.source.slice(lineStart, record.start)) && trailing
  return applyPatches(model.source, [{ start: standalone ? lineStart : record.start, end: record.completeEnd + (standalone ? trailing[0].length : 0), value: '' }])
}

export const removeHtmlLayoutImage = (model: HtmlLayoutDocument, id: string): string => removeHtmlLayoutObject(model, id, 'image')

export const removeHtmlLayoutText = (model: HtmlLayoutDocument, id: string): string => removeHtmlLayoutObject(model, id, 'text')

const appendHtmlLayoutObject = (model: HtmlLayoutDocument, markup: string): string => {
  const parsed = parseLayout(model.source)
  const root = parsed.rootId ? parsed.elements.get(parsed.rootId) : undefined
  const record = parsed.rootId ? parsed.recordById.get(parsed.rootId) : undefined
  if (!parsed.rootContainer || !root || !record || record.contentEnd === null || !['DIV', 'SECTION', 'FIGURE', 'ARTICLE', 'P'].includes(root.tagName)) {
    throw new Error('请先把内容放在完整的 div、section、figure 或 article 外框中。')
  }
  // A blank line ends a CommonMark HTML block, splitting the new image from its outer frame on reopen.
  const lineStart = model.source.lastIndexOf('\n', record.contentEnd - 1) + 1
  const closingIndent = model.source.slice(lineStart, record.contentEnd)
  const insertion = /^[ \t]*$/.test(closingIndent) ? lineStart : record.contentEnd
  const indent = insertion === lineStart ? closingIndent : ''
  const newline = model.source.includes('\r\n') ? '\r\n' : '\n'
  const separator = /[\r\n]$/.test(model.source.slice(0, insertion)) ? '' : newline
  return applyPatches(model.source, [{
    start: insertion,
    end: insertion,
    value: `${separator}${indent}${markup}${newline}`
  }])
}

export const appendHtmlLayoutImage = (model: HtmlLayoutDocument, image: { src: string; alt: string; style: string }): string =>
  appendHtmlLayoutObject(model, `<img src="${escapeAttribute(image.src, '"')}" alt="${escapeAttribute(image.alt, '"')}" style="${escapeAttribute(image.style, '"')}">`)

export const appendHtmlLayoutText = (model: HtmlLayoutDocument, text: { text: string; style?: string }): string => {
  const style = 'display: inline-block; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 1.5; min-height: 1.5em; ' + (text.style ?? '')
  return appendHtmlLayoutObject(model, `<span data-mt-textbox="true" style="${escapeAttribute(style, '"')}">${escapeText(text.text)}</span>`)
}
