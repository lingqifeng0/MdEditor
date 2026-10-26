import { afterEach, describe, expect, it } from 'vitest'
import { createHtmlLayoutDocument, removeHtmlLayoutText } from '@/util/htmlLayout'
import { preserveHtmlLayoutGeometry } from '@/util/htmlLayoutGeometry'

afterEach(() => document.body.replaceChildren())

describe('structural HTML edits preserve visual geometry', () => {
  it('pins a caption column and its image before deletion, preserving unrelated source', () => {
    const source = '<p id="row" style="display:flex;align-items:flex-end;border:2px solid red">\n  <!-- keep -->\n<span id="column" style="display:inline-flex;flex-direction:column"><img id="image" src="assets/原图.png"><span id="caption">说明</span></span>\n</p>'
    const model = createHtmlLayoutDocument(source)
    const stage = document.createElement('div')
    stage.innerHTML = model.previewHtml
    document.body.append(stage)
    const boxes: Record<string, [number, number, number, number]> = { row: [10, 20, 640, 180], column: [32, 52, 200, 140], image: [32, 52, 200, 110], caption: [62, 168, 140, 24] }
    for (const [id, box] of Object.entries(boxes)) {
      Object.defineProperty(stage.querySelector('#' + id), 'getBoundingClientRect', { value: () => new DOMRect(...box) })
    }
    const pinned = preserveHtmlLayoutGeometry(model, stage, [])
    const updated = createHtmlLayoutDocument(pinned)
    const caption = updated.targets.find(target => target.kind === 'text' && target.text === '说明')
    if (!caption) throw new Error('Missing caption')
    const result = removeHtmlLayoutText(updated, caption.id)
    const dom = new DOMParser().parseFromString(result, 'text/html')
    expect(dom.querySelector('#caption')).toBeNull()
    expect(dom.querySelector<HTMLElement>('#row')?.style.height).toBe('180px')
    expect(dom.querySelector<HTMLElement>('#column')?.style.top).toBe('30px')
    expect(dom.querySelector<HTMLElement>('#column')?.style.height).toBe('140px')
    expect(dom.querySelector<HTMLElement>('#image')?.style.top).toBe('0px')
    expect(dom.querySelector<HTMLElement>('#image')?.style.height).toBe('110px')
    expect(result).toContain('src="assets/原图.png"')
    expect(result).toContain('  <!-- keep -->')
  })

  it('keeps pending text styles when freezing a scene without a complete outer frame', () => {
    const model = createHtmlLayoutDocument('<span>original</span>')
    const stage = document.createElement('div')
    stage.innerHTML = model.previewHtml
    const target = model.targets[0]
    const result = preserveHtmlLayoutGeometry(model, stage, [{ id: target.id, text: 'edited', color: '#336699' }])
    expect(result).toContain('edited')
    expect(result).toContain('color: #336699')
  })

  it('does not replace unknown image geometry or author rotations with guessed boxes', () => {
    const source = '<div><img style="transform:rotate(20deg)" src="keep.png"><span>说明</span></div>'
    const model = createHtmlLayoutDocument(source)
    const stage = document.createElement('div')
    stage.innerHTML = model.previewHtml
    document.body.append(stage)
    expect(() => preserveHtmlLayoutGeometry(model, stage, [])).toThrow('尺寸为零')
    for (const element of stage.querySelectorAll('*')) Object.defineProperty(element, 'getBoundingClientRect', { value: () => new DOMRect(10, 10, 100, 100) })
    expect(() => preserveHtmlLayoutGeometry(model, stage, [])).toThrow('旋转或缩放')
    expect(model.source).toBe(source)
  })
})
