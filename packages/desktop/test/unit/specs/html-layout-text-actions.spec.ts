import { describe, it, expect } from 'vitest'
import { appendHtmlLayoutText, applyHtmlLayoutEdits, createHtmlLayoutDocument, removeHtmlLayoutText, type HtmlLayoutDocument } from '@/util/htmlLayout'
import { MarkdownToState } from '@muyajs/core/state/markdownToState'

const parse = (source: string) => new DOMParser().parseFromString(source, 'text/html')
const requireTarget = (model: HtmlLayoutDocument, kind: 'text' | 'image') => {
  const target = model.targets.find(target => target.kind === kind)
  if (!target) throw new Error(`Missing ${kind} test target`)
  return target
}
const textTarget = (source: string) => requireTarget(createHtmlLayoutDocument(source), 'text')

describe('HTML layout text objects', () => {
  it.each(['\n', '\r\n'])('adds text without splitting a Markdown HTML frame using %j line endings', newline => {
    const source = `<div data-note='keep' style="height:120px">${newline}<img src="assets/电感.png">${newline}  </div>`
    const result = appendHtmlLayoutText(createHtmlLayoutDocument(source), { text: '屏蔽电感', style: 'position:absolute;left:20px;top:80px' })
    expect(result).toContain(source.slice(0, source.lastIndexOf(`${newline}  </div>`)))
    expect(result).not.toMatch(/\n[ \t\r]*\n/)
    expect(parse(result).querySelector('img')?.getAttribute('src')).toBe('assets/电感.png')
    expect(parse(result).querySelector('[data-mt-textbox]')?.textContent).toBe('屏蔽电感')
    const blocks = new MarkdownToState().generate(`before\n\n${result}\n\nafter`)
    expect(blocks).toHaveLength(3)
    expect(blocks.filter(block => block.name === 'html-block')).toHaveLength(1)
  })

  it('uses an inline box that remains legal inside an existing paragraph frame', () => {
    const source = '<p><img src="keep.png"></p>'
    const result = appendHtmlLayoutText(createHtmlLayoutDocument(source), { text: '说明' })
    const dom = parse(result)
    expect(dom.body.children).toHaveLength(1)
    expect(dom.querySelector('p > span')?.textContent).toBe('说明')
    expect(createHtmlLayoutDocument(result).rootContainer).toBe(true)
  })

  it('keeps an intentionally empty new box selectable and editable after reopening', () => {
    const source = appendHtmlLayoutText(createHtmlLayoutDocument('<div></div>'), { text: '' })
    const model = createHtmlLayoutDocument(source)
    const target = requireTarget(model, 'text')
    expect(target.textEditable).toBe(true)
    expect(target.text).toBe('')
    expect(target.label).toBe('文字框')
    const edited = applyHtmlLayoutEdits(model, [{ id: target.id, text: '新说明', fontSize: 28, color: '#d14343' }])
    expect(textTarget(edited).text).toBe('新说明')
    expect(parse(edited).querySelector('span')?.style.fontSize).toBe('28px')
  })

  it('round-trips literal markup, ampersands and blank text lines as one HTML block', () => {
    const content = '第一行 <img src="other.png"> &\n\n最后一行 >'
    const added = appendHtmlLayoutText(createHtmlLayoutDocument('<div><img src="keep.png"></div>'), { text: content })
    expect(added).toContain('&#10;&#10;')
    expect(added).not.toContain('\n\n')
    expect(parse(added).querySelectorAll('img')).toHaveLength(1)
    expect(textTarget(added).text).toBe(content)
    const model = createHtmlLayoutDocument(added)
    const target = requireTarget(model, 'text')
    const updated = applyHtmlLayoutEdits(model, [{ id: target.id, text: content + '\r\n下一行' }])
    expect(textTarget(updated).text).toBe(content + '\n下一行')
    expect(updated).not.toContain('\n\n')
  })

  it('styles a whole existing text object without flattening its rich markup or siblings', () => {
    const source = '<div data-keep="x"><p id="caption" style="font-weight:bold!important">Keep <em>emphasis</em><!--keep--></p><img src="a.png"></div>'
    const model = createHtmlLayoutDocument(source)
    const target = requireTarget(model, 'text')
    expect(target.textEditable).toBe(false)
    const result = applyHtmlLayoutEdits(model, [{ id: target.id, fontSize: 32, color: '#ff5577' }])
    const caption = parse(result).querySelector('#caption') as HTMLElement
    expect(caption.style.fontSize).toBe('32px')
    expect(caption.style.color).toBe('rgb(255, 85, 119)')
    expect(caption.innerHTML).toBe('Keep <em>emphasis</em><!--keep-->')
    expect(result).toContain('font-weight:bold!important')
    expect(result).toContain('<img src="a.png">')
  })

  it('preserves existing text color unless a color edit is supplied', () => {
    const source = '<div><span style="color: red !important; font-size:20px">原文字</span></div>'
    const model = createHtmlLayoutDocument(source)
    const target = requireTarget(model, 'text')
    expect(applyHtmlLayoutEdits(model, [{ id: target.id, text: '修改文字' }])).toBe(source.replace('原文字', '修改文字'))
    const result = applyHtmlLayoutEdits(model, [{ id: target.id, color: '#336699' }])
    const style = parse(result).querySelector('span')?.style
    // JSDOM keeps the first duplicate !important color; Chromium verifies the
    // saved value in the Electron regression. Preserve the source priority here.
    expect(result).toContain('color: #336699 !important;')
    expect(style?.getPropertyPriority('color')).toBe('important')
  })

  it.each([0, -1, NaN, Infinity])('rejects an invalid font size %j', fontSize => {
    const model = createHtmlLayoutDocument('<div><p>text</p></div>')
    const target = requireTarget(model, 'text')
    expect(() => applyHtmlLayoutEdits(model, [{ id: target.id, fontSize }])).toThrow()
  })

  it.each(['red;position:fixed', 'url(example)', '#invalid'])('rejects unsupported color %s', color => {
    const model = createHtmlLayoutDocument('<div><p>text</p></div>')
    const target = requireTarget(model, 'text')
    expect(() => applyHtmlLayoutEdits(model, [{ id: target.id, color }])).toThrow()
  })

  it('refuses applying text styles to images', () => {
    const model = createHtmlLayoutDocument('<div><img src="a.png"></div>')
    const target = requireTarget(model, 'image')
    expect(() => applyHtmlLayoutEdits(model, [{ id: target.id, fontSize: 20 }])).toThrow()
  })

  it('deletes only the selected text source range and keeps the frame and all image bytes', () => {
    const source = '<div data-keep="x">\n  <img src="a.png">\n  <span data-mt-textbox="true">删除</span>\n  <p>保留</p>\n</div>'
    const model = createHtmlLayoutDocument(source)
    const target = model.targets.find(target => target.text === '删除')
    if (!target) throw new Error('Missing deletion test target')
    expect(removeHtmlLayoutText(model, target.id)).toBe(source.replace('  <span data-mt-textbox="true">删除</span>\n', ''))
    expect(removeHtmlLayoutText(model, model.rootTargetId ?? '')).toBe(source)
    expect(removeHtmlLayoutText(model, requireTarget(model, 'image').id)).toBe(source)
  })

  it('keeps an empty frame available after deleting its last text and allows adding another', () => {
    const source = appendHtmlLayoutText(createHtmlLayoutDocument('<div style="width:300px;height:120px"></div>'), { text: 'one' })
    const empty = removeHtmlLayoutText(createHtmlLayoutDocument(source), textTarget(source).id)
    const model = createHtmlLayoutDocument(empty)
    expect(model.rootTargetId).toBeTruthy()
    expect(textTarget(appendHtmlLayoutText(model, { text: 'two' })).text).toBe('two')
  })
})
