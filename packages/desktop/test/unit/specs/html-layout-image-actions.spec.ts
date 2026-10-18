import { describe, it, expect } from 'vitest'
import { createHtmlLayoutDocument, appendHtmlLayoutImage, removeHtmlLayoutImage } from '@/util/htmlLayout'
import { placeHtmlLayoutImage } from '@/util/htmlLayoutBounds'
import { deriveFloatingToc, searchFloatingToc, revealFloatingTocMatches, visibleFloatingToc } from '@/util/floatingToc'
import { MarkdownToState } from '@muyajs/core/state/markdownToState'

describe('HTML image draft actions', () => {
  const assertSingleGroup = (source: string, count: number) => {
    const parsed = new MarkdownToState().generate(`before\n\n${source}\n\nafter`)
    const html = parsed.filter(block => block.name === 'html-block')
    expect(html).toHaveLength(1)
    const group = new DOMParser().parseFromString(html[0].text ?? '', 'text/html').querySelector('div')
    expect(group?.querySelectorAll('img')).toHaveLength(count)
    expect(parsed).toHaveLength(3)
  }
  it.each(['\n', '\r\n'])('keeps an appended image inside one Markdown HTML block on reopening with %j line endings', newline => {
    const source = `<div style="width:400px;height:300px">${newline}<img src="a.png">${newline}  </div>`
    const result = appendHtmlLayoutImage(createHtmlLayoutDocument(source), { src: 'assets/new.png', alt: '', style: 'width:50%;height:50%;' })
    expect(result).not.toMatch(/\n[ \t\r]*\n/)
    expect(result).toContain(`${newline}  <img`)
    assertSingleGroup(result, 2)
  })
  it.each(['a.png', 'b.png', 'c.png'])('removing the standalone image %s preserves one complete HTML block', src => {
    const source = '<div>\n  <img src="a.png">\n  <img src="b.png">\n  <img src="c.png">\n</div>'
    const model = createHtmlLayoutDocument(source)
    const target = model.targets.find(target => target.src === src)!
    const result = removeHtmlLayoutImage(model, target.id)
    expect(result).not.toContain('\n\n')
    assertSingleGroup(result, 2)
  })
  it('keeps a replacement inside the frame after all standalone image lines are deleted', () => {
    let model = createHtmlLayoutDocument('<div>\n<img src="a.png">\n</div>')
    model = createHtmlLayoutDocument(removeHtmlLayoutImage(model, model.targets.find(target => target.kind === 'image')!.id))
    const result = appendHtmlLayoutImage(model, { src: 'assets/new.png', alt: '', style: 'width:50%;height:50%;' })
    assertSingleGroup(result, 1)
  })
  it('removes only the selected image and preserves text, source attributes and all sibling bytes', () => {
    const source = '<div data-note="original"><p>Keep <b>text</b></p><a href="link"><img src="a.png"></a>\n<img src="b.png"/></div>'
    const model = createHtmlLayoutDocument(source)
    const image = model.targets.find(target => target.src === 'a.png')!
    expect(removeHtmlLayoutImage(model, image.id)).toBe(source.replace('<img src="a.png">', ''))
    expect(removeHtmlLayoutImage(model, model.rootTargetId!)).toBe(source)
  })
  it('keeps the frame editable after removing its last image and allows adding another', () => {
    const model = createHtmlLayoutDocument('<div style="width:400px;height:300px"><img src="a.png"></div>')
    const empty = createHtmlLayoutDocument(removeHtmlLayoutImage(model, model.targets.find(target => target.kind === 'image')!.id))
    expect(empty.rootTargetId).toBeTruthy()
    const result = appendHtmlLayoutImage(empty, { src: 'assets/a&".png', alt: '<script>', style: 'width:50%;height:50%;' })
    const dom = new DOMParser().parseFromString(result, 'text/html')
    expect(dom.querySelector('img')?.getAttribute('src')).toBe('assets/a&".png')
    expect(dom.querySelector('img')?.alt).toBe('<script>')
    expect(dom.querySelector('script')).toBeNull()
  })
  it('fits portrait, landscape and small images in both axes without stretching', () => {
    for (const requested of [{ width: 2000, height: 500 }, { width: 100, height: 3000 }, { width: 40, height: 20 }]) {
      const box = placeHtmlLayoutImage(requested, { width: 600, height: 200 }, [])
      expect(box.width).toBeLessThanOrEqual(600)
      expect(box.height).toBeLessThanOrEqual(200)
      expect(box.width / box.height).toBeCloseTo(requested.width / requested.height)
      expect(box.width).toBeLessThanOrEqual(requested.width)
    }
  })
  it('places in free space or fits within the frame when the canvas is full', () => {
    const box = placeHtmlLayoutImage({ width: 400, height: 200 }, { width: 600, height: 200 }, [{ left: 0, top: 0, width: 400, height: 200 }])
    expect(box).toEqual({ left: 400, top: 0, width: 200, height: 100 })
    expect(placeHtmlLayoutImage({ width: 1000, height: 500 }, { width: 600, height: 200 }, [{ left: 0, top: 0, width: 600, height: 200 }])).toEqual({ left: 0, top: 0, width: 400, height: 200 })
  })
})

describe('TOC heading search', () => {
  const entries = deriveFloatingToc([{ slug: 'root', lvl: 1, content: '项目' }, { slug: 'a', lvl: 2, content: '1. 电阻结构' }, { slug: 'b', lvl: 3, content: 'MOSFET ＡＢＣ' }, { slug: 'c', lvl: 1, content: '其他电阻' }])
  it('matches Chinese and normalized Latin text while ignoring empty queries', () => {
    expect([...searchFloatingToc(entries, ' 电阻 ')]).toEqual(['a', 'c'])
    expect([...searchFloatingToc(entries, 'abc')]).toEqual(['b'])
    expect(searchFloatingToc(entries, '  ').size).toBe(0)
  })
  it('temporarily expands ancestors of matching nested headings without changing saved collapses', () => {
    const collapsed = new Set(['root', 'a'])
    const revealed = revealFloatingTocMatches(entries, collapsed, searchFloatingToc(entries, 'mosfet'))
    expect(visibleFloatingToc(entries, revealed).map(entry => entry.slug)).toContain('b')
    expect([...collapsed]).toEqual(['root', 'a'])
  })
})
