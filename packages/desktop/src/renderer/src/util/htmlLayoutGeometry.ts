import { applyHtmlLayoutEdits, type HtmlLayoutDocument, type HtmlLayoutEdit } from './htmlLayout'

const hasOnlyTranslation = (style: CSSStyleDeclaration) => {
  if ([style.rotate, style.scale, style.translate].some(value => value && value !== 'none')) return false
  const transform = style.transform
  if (!transform || transform === 'none') return true
  const matrix = /^matrix\(([^)]+)\)$/.exec(transform)
  if (!matrix) return /^(?:translate(?:X|Y)?\([^)]+\)\s*)+$/i.test(transform)
  const values = matrix[1].split(',').map(Number)
  return values.length === 6 && values.every(Number.isFinite) && values[0] === 1 && values[1] === 0 && values[2] === 0 && values[3] === 1
}

/** Structural deletion must not let flex/grid reflow the surviving objects. */
export function preserveHtmlLayoutGeometry(model: HtmlLayoutDocument, stage: HTMLElement, pending: HtmlLayoutEdit[]): string {
  const snapshots = new Map(model.targets.flatMap(target => {
    const element = stage.querySelector<HTMLElement>(`[${model.markerAttribute}="${target.id}"]`)
    if (!element) return []
    const rect = element.getBoundingClientRect()
    if (target.kind === 'image' && (rect.width <= 0 || rect.height <= 0)) throw new Error('图片尚未加载或尺寸为零，请加载图片后再删除对象。')
    const style = getComputedStyle(element)
    if (!hasOnlyTranslation(style)) throw new Error('此布局包含旋转或缩放，请在 HTML 源码中删除对象，以保留原有变换。')
    return rect.width > 0 && rect.height > 0 ? [[target.id, { target, element, rect, style }] as const] : []
  }))
  const root = model.rootTargetId && snapshots.get(model.rootTargetId)
  if (!root || !model.rootContainer) return applyHtmlLayoutEdits(model, pending)
  const edits = new Map(pending.map(edit => [edit.id, { ...edit }]))
  for (const [id, snapshot] of snapshots) {
    const { element, rect, style } = snapshot
    const edit: HtmlLayoutEdit = { ...edits.get(id), id, width: rect.width, height: rect.height, preservePaddingBottom: true }
    if (id === model.rootTargetId) {
      edit.position = style.position === 'absolute' ? 'absolute' : 'relative'
    } else {
      let parent = element.parentElement
      while (parent && parent !== root.element && snapshots.get(parent.getAttribute(model.markerAttribute) ?? '')?.target.kind !== 'container') parent = parent.parentElement
      const ancestor = parent && snapshots.get(parent.getAttribute(model.markerAttribute) ?? '')
      if (!ancestor) continue
      edit.position = 'absolute'
      edit.left = rect.left - ancestor.rect.left - (parseFloat(ancestor.style.borderLeftWidth) || 0) - (parseFloat(style.marginLeft) || 0)
      edit.top = rect.top - ancestor.rect.top - (parseFloat(ancestor.style.borderTopWidth) || 0) - (parseFloat(style.marginTop) || 0)
      edit.offsetX = 0
      edit.offsetY = 0
      edit.resetTransform = true
    }
    // Container dimensions are frozen too: removing a caption cannot shrink its column or row.
    edits.set(id, edit)
  }
  return applyHtmlLayoutEdits(model, [...edits.values()])
}
