import { describe, expect, it } from 'vitest'
import {
  createHtmlLayoutDocument,
  applyHtmlLayoutEdits,
  reorderHtmlLayoutTarget
} from '@/util/htmlLayout'
import type { HtmlLayoutDocument } from '@/util/htmlLayout'
import { snapHtmlLayoutImage } from '@/util/htmlLayoutSnapping'

const targetId = (model: HtmlLayoutDocument, index = 0): string => {
  const target = model.targets[index]
  if (!target) throw new Error('Missing test target')
  return target.id
}

const rootTargetId = (model: HtmlLayoutDocument): string => {
  if (!model.rootTargetId) throw new Error('Missing root test target')
  return model.rootTargetId
}

const containerTarget = (model: HtmlLayoutDocument, tagName: string) => {
  const target = model.targets.find(target => target.kind === 'container' && target.tagName === tagName)
  if (!target) throw new Error('Missing container test target')
  return target
}

const previewTarget = (model: HtmlLayoutDocument, index = 0): HTMLElement => {
  const template = document.createElement('template')
  template.innerHTML = model.previewHtml
  const element = template.content.querySelector<HTMLElement>(`[${model.markerAttribute}="${targetId(model, index)}"]`)
  if (!element) throw new Error('Missing preview target')
  return element
}

describe('HTML layout source and preview mapping', () => {
  it('marks a complete wrapper as an editable group while rich inline decoration selects its text object', () => {
    const source = '<div style="padding:40px; border:2px solid blue"><img src="../assets/picture.png"><p><strong>Caption</strong></p></div>'
    const model = createHtmlLayoutDocument(source)
    const preview = document.createElement('template')
    preview.innerHTML = model.previewHtml
    const markers = [...preview.content.querySelectorAll(`[${model.markerAttribute}]`)]
    expect(markers.map(element => element.getAttribute(model.markerAttribute)).sort()).toEqual(model.targets.map(target => target.id).sort())
    expect(preview.content.querySelector('div')?.getAttribute(model.markerAttribute)).toBe(model.rootTargetId)
    expect(model.targets.find(target => target.id === model.rootTargetId)?.kind).toBe('container')
    expect(preview.content.querySelector('strong')?.closest(`[${model.markerAttribute}]`)?.getAttribute(model.markerAttribute)).toBe(targetId(model, 1))
    expect(model.rootContainer).toBe(true)
    expect(model.source).toBe(source)
  })

  it('keeps visible leaf object order and appends complete enclosing groups', () => {
    const model = createHtmlLayoutDocument('<section><div><p>Hello</p><p><strong>Rich</strong> text</p><p><span>Leaf</span></p><img src="a.png"></div></section>')
    expect(model.targets.filter(target => target.kind !== 'container').map(target => [target.kind, target.tagName, target.textEditable])).toEqual([
      ['text', 'p', true], ['text', 'p', false], ['text', 'span', true], ['image', 'img', false]
    ])
    expect(model.targets.slice(0, 4).map(target => target.path)).toEqual([[0, 0, 0], [0, 0, 1], [0, 0, 2, 0], [0, 0, 3]])
    expect(model.targets.slice(4).map(target => [target.kind, target.tagName, target.textEditable])).toEqual([
      ['container', 'section', false], ['container', 'div', false]
    ])
    expect(model.rootTargetId).toBe(targetId(model, 4))
    expect(model.rootContainer).toBe(true)
  })

  it('excludes hidden and executable elements, including their descendants', () => {
    const source = '<div><script>const x="<img src=bad>"</script><style>.x{content:"<p>bad</p>"}</style><textarea><img src=bad></textarea><div hidden><p>hidden</p></div><p style="display:none">gone</p><span style="opacity:0">transparent</span><img src=good.png><p>Visible</p></div>'
    const model = createHtmlLayoutDocument(source)
    expect(model.targets.filter(target => target.kind !== 'container').map(target => target.label)).toEqual(['good.png', 'Visible'])
  })

  it('retains precise source targets through browser-created table containers', () => {
    const model = createHtmlLayoutDocument('<table><tr><td>Cell</td><td>Other</td></tr></table>')
    expect(model.targets[0]?.path).toEqual([0, 0, 0, 0])
    expect(model.targets.find(target => target.id === model.rootTargetId)?.tagName).toBe('table')
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), text: 'Changed' }])).toBe('<table><tr><td>Changed</td><td>Other</td></tr></table>')
  })

  it.each(['\n', '\r\n\r\n'])('exposes a source-backed image paragraph as its complete outer frame with separator %j', separator => {
    const images = [
      '<img src="images/page-002-f2.png" alt="First &amp; image" width="180" />',
      '<img src="images/page-002-f3.png" alt="Second" width="221" />',
      '<img src="images/page-002-f4.png" alt="Third" width="168" />'
    ]
    const children = `${separator}${images.join(separator)}${separator}`
    const source = `<p data-note='keep'>${children}</p>`
    const model = createHtmlLayoutDocument(source, src => `file:///preview/${src}`)
    expect(model.targets.map(target => target.kind)).toEqual(['image', 'image', 'image', 'container'])
    expect(model.targets.slice(0, 3).map(target => target.path)).toEqual([[0, 0], [0, 1], [0, 2]])
    expect(model.rootTargetId).toBe(targetId(model, 3))
    expect(containerTarget(model, 'p').textEditable).toBe(false)
    expect(model.rootContainer).toBe(true)
    const preview = previewTarget(model, 3)
    expect(preview.tagName).toBe('P')
    expect([...preview.querySelectorAll('img')].map(image => image.parentElement)).toEqual([preview, preview, preview])
    const result = applyHtmlLayoutEdits(model, [{ id: rootTargetId(model), height: 120 }], { minimumHeight: 120 })
    expect(result).toContain("data-note='keep'")
    expect(result).toContain(`>${children}</p>`)
    expect(result).not.toContain('file:///preview/')
    expect(result).not.toContain(model.markerAttribute)
    const savedPreview = previewTarget(createHtmlLayoutDocument(result), 3)
    expect(savedPreview.style.height).toBe('120px')
    expect([...savedPreview.querySelectorAll('img')].map(image => image.getAttribute('width'))).toEqual(['180', '221', '168'])
    expect(applyHtmlLayoutEdits(model, [])).toBe(source)
  })

  it('keeps image paragraph spans and ordinary text paragraphs intact when selecting a group', () => {
    const children = '\n<span style="color:#cc0000" data-keep="same"><img src="../one.png" width="180" /></span>\n<img src="../two.png" width="221" />\n'
    const model = createHtmlLayoutDocument(`<p class=images>${children}</p>`)
    expect(containerTarget(model, 'p').id).toBe(rootTargetId(model))
    expect(applyHtmlLayoutEdits(model, [{ id: rootTargetId(model), height: 160 }])).toContain(`>${children}</p>`)
    const ordinary = createHtmlLayoutDocument('<section><p>Plain text</p><p><strong>Rich</strong> text</p></section>')
    expect(ordinary.targets.slice(0, 2).map(target => [target.kind, target.tagName, target.textEditable])).toEqual([
      ['text', 'p', true], ['text', 'p', false]
    ])
    expect(ordinary.targets.filter(target => target.kind === 'container').map(target => target.tagName)).toEqual(['section'])
    expect(createHtmlLayoutDocument('<p>Plain text</p>').rootTargetId).toBeUndefined()
  })

  it('rejects an image paragraph group when HTML parsing moved its source children outside the paragraph', () => {
    const source = '<p><img src=keep.png><div>Moved block</div></p>'
    const model = createHtmlLayoutDocument(source)
    expect(model.targets.some(target => target.kind === 'container' && target.tagName === 'p')).toBe(false)
    expect(model.rootTargetId).toBeUndefined()
    expect(model.source).toBe(source)
  })

  it('resolves images only for preview and keeps relative source spelling on save', () => {
    const source = '<DIV class=figure><img SRC="../图/a.png?x=1&amp;y=2" alt=Diagram></DIV>'
    const model = createHtmlLayoutDocument(source, src => `file:///notes/${src}`)
    expect(model.targets[0]?.src).toBe('../图/a.png?x=1&y=2')
    expect(previewTarget(model).getAttribute('src')).toBe('file:///notes/../图/a.png?x=1&y=2')
    const saved = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 320 }])
    expect(saved).toContain('SRC="../图/a.png?x=1&amp;y=2" alt=Diagram')
    expect(saved).not.toContain('file:///')
    expect(saved).not.toContain(model.markerAttribute)
  })

  it('does not collide with a user marker attribute or persist preview markers', () => {
    const source = '<p data-mt-html-layout="original">Text</p>'
    const model = createHtmlLayoutDocument(source)
    expect(model.markerAttribute).not.toBe('data-mt-html-layout')
    expect(applyHtmlLayoutEdits(model, [])).toBe(source)
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 100 }])).toContain('data-mt-html-layout="original"')
  })

  it('keeps user layout metadata separate from generated selection markers', () => {
    const source = '<div data-mt-html-layout="legacy-root" data-html-layout-target="other"><img src="../keep.png" data-html-layout-id="user-image"></div>'
    const model = createHtmlLayoutDocument(source)
    const template = document.createElement('template')
    template.innerHTML = model.previewHtml
    expect(template.content.querySelector('div')?.getAttribute(model.markerAttribute)).toBe(model.rootTargetId)
    expect(previewTarget(model).getAttribute(model.markerAttribute)).toBe(targetId(model))
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 100 }])
    expect(result).toContain('data-mt-html-layout="legacy-root" data-html-layout-target="other"')
    expect(result).toContain('src="../keep.png" data-html-layout-id="user-image"')
  })

  it('does not expose incomplete containers or table groups whose source children were foster-parented', () => {
    const incomplete = createHtmlLayoutDocument('<div class=unfinished><img src=keep.png>')
    expect(incomplete.targets.map(target => target.kind)).toEqual(['image'])
    expect(incomplete.rootTargetId).toBeUndefined()
    const moved = createHtmlLayoutDocument('<table><div><img src=keep.png></div><tr><td>Cell</td></tr></table>')
    expect(moved.targets.filter(target => target.kind === 'container').map(target => target.tagName)).toEqual(['div'])
    expect(moved.rootTargetId).toBeUndefined()
  })

  it('leaves comments and unquoted image src syntax unchanged', () => {
    const source = '<!-- <p>Ignore</p> -->\r\n<img src=a.png/>'
    const model = createHtmlLayoutDocument(source)
    expect(model.targets).toHaveLength(1)
    expect(previewTarget(model).getAttribute('src')).toBe('a.png/')
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 100 }])).toBe('<!-- <p>Ignore</p> -->\r\n<img style="width: 100px; min-width: 0; max-width: none; box-sizing: border-box;" src=a.png/>')
  })
})

describe('HTML layout edits', () => {
  it('preserves measured fractional CSS sizes and positioned origins through source round trips', () => {
    const source = '<div><img src="images/图 空格.png" width="90" data-author="keep"></div>'
    const model = createHtmlLayoutDocument(source)
    const geometry = { width: 90.47917175292969, height: 80.32291412353516, left: 120.65626525878906, top: 55.01042175292969 }
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), position: 'absolute', ...geometry }])
    const image = previewTarget(createHtmlLayoutDocument(result))
    for (const dimension of ['width', 'height', 'left', 'top'] as const) {
      expect(parseFloat(image.style.getPropertyValue(dimension))).toBe(geometry[dimension])
    }
    expect(image.getAttribute('src')).toBe('images/图 空格.png')
    expect(image.getAttribute('width')).toBe('90')
    expect(image.getAttribute('data-author')).toBe('keep')
  })

  it('keeps fractional edge contact and bottom alignment after serializing snapped translations', () => {
    const source = '<div style="position:relative;width:580px;height:280px"><img src="first.png" style="position:absolute;left:20px;top:20px"><img src="second.png" style="position:absolute;left:320px;top:95px"></div>'
    const model = createHtmlLayoutDocument(source)
    const first = { left: 20, top: 20, width: 90.47917175292969, height: 80.32291412353516 }
    const second = { left: 320, top: 95, width: 110.76042175292969, height: 105.16667175292969 }
    const snapped = snapHtmlLayoutImage({ ...second, left: first.left + first.width + 4, top: first.top + first.height - second.height + 5 },
      { left: 0, top: -100, width: 580, height: 380 }, [{ id: 'first', rectangle: first }])
    const result = applyHtmlLayoutEdits(model, [
      { id: targetId(model), width: first.width, height: first.height },
      {
        id: targetId(model, 1),
        width: second.width,
        height: second.height,
        offsetX: snapped.rectangle.left - second.left,
        offsetY: snapped.rectangle.top - second.top
      }
    ])
    const saved = createHtmlLayoutDocument(result)
    const firstImage = previewTarget(saved)
    const secondImage = previewTarget(saved, 1)
    const translation = /translate\(([-+\d.e]+)px, ([-+\d.e]+)px\)/.exec(secondImage.style.transform)
    expect(translation).not.toBeNull()
    const savedLeft = parseFloat(secondImage.style.left) + Number(translation?.[1])
    const savedTop = parseFloat(secondImage.style.top) + Number(translation?.[2])
    expect(savedLeft - (parseFloat(firstImage.style.left) + parseFloat(firstImage.style.width))).toBeCloseTo(0, 9)
    expect(savedTop + parseFloat(secondImage.style.height) - parseFloat(firstImage.style.top) - parseFloat(firstImage.style.height)).toBeCloseTo(0, 9)
  })

  it('changes only selected style declarations while preserving unknown CSS and attributes', () => {
    const source = '<div data-x=\'untouched\'><IMG class = "photo" style=\'background:url("a&amp;b;c.png"); --custom: "quoted;value"; x-widget:yes; width:10px!important\' src=\'../images/a.png\'><p>Unchanged &amp; text</p></div>'
    const model = createHtmlLayoutDocument(source)
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 200, height: 150 }])
    expect(result).toBe(source.replace("width:10px!important'", "width:10px!important; width: 200px !important; min-width: 0; max-width: none; height: 150px; min-height: 0; max-height: none; box-sizing: border-box;'"))
  })

  it('supports unquoted and valueless style attributes without consuming their neighbors', () => {
    for (const source of ['<p style=width:10px data-note="keep">Text</p>', '<p style   data-note="keep">Text</p>']) {
      const model = createHtmlLayoutDocument(source)
      const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 20 }])
      expect(result).toContain(' data-note="keep">Text</p>')
      expect(previewTarget(createHtmlLayoutDocument(result)).style.width).toBe('20px')
    }
  })

  it('preserves an existing transform and uses total offsets from the baseline', () => {
    const source = '<img style="transform:rotate(3deg) scale(0.8) !important" src="../a.png">'
    const model = createHtmlLayoutDocument(source)
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), offsetX: -12.5, offsetY: 30 }])
    // jsdom keeps the first duplicate !important; native Chromium correctly uses the last.
    expect(result).toContain('transform: translate(-12.5px, 30px) rotate(3deg) scale(0.8) !important;')
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), offsetX: 0, offsetY: 0 }])).toBe(source)
  })

  it('escapes only the chosen plain-text block and leaves other entities intact', () => {
    const source = '<div><p id=first>Hello &amp; goodbye</p>\n<p id=other>Leave &copy; intact</p></div>'
    const model = createHtmlLayoutDocument(source)
    expect(model.targets[0]?.text).toBe('Hello & goodbye')
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), text: 'New <b> & > text' }])).toBe('<div><p id=first>New &lt;b&gt; &amp; &gt; text</p>\n<p id=other>Leave &copy; intact</p></div>')
  })

  it('refuses text replacement in rich markup and comment-bearing blocks', () => {
    for (const source of ['<p>Hello <em>world</em></p>', '<p>Hello<!--keep--> world</p>', '<p>Missing closing tag']) {
      const model = createHtmlLayoutDocument(source)
      expect(model.targets[0]?.textEditable).toBe(false)
      expect(() => applyHtmlLayoutEdits(model, [{ id: targetId(model), text: 'replacement' }])).toThrow()
      expect(model.source).toBe(source)
    }
  })

  it('does not erase neighboring source elements when the browser implicitly closes a paragraph', () => {
    const source = '<p>First<div>Keep this box</div></p><img src=keep.png>'
    const model = createHtmlLayoutDocument(source)
    expect(model.targets[0]?.text).toBe('First')
    expect(model.targets[0]?.textEditable).toBe(false)
    expect(() => applyHtmlLayoutEdits(model, [{ id: targetId(model), text: 'Changed' }])).toThrow()
    expect(model.source).toBe(source)
  })

  it('combines edits for multiple source offsets and repeated target ids safely', () => {
    const model = createHtmlLayoutDocument('<div><img src=a.png><p>Text</p><img src=b.png></div>')
    const result = applyHtmlLayoutEdits(model, [
      { id: targetId(model), width: 10 }, { id: targetId(model), width: 40, height: 30 },
      { id: targetId(model, 1), width: 200, text: 'Changed' },
      { id: targetId(model, 2), offsetY: 12 }
    ])
    expect(result).toBe('<div><img style="width: 40px; min-width: 0; max-width: none; height: 30px; min-height: 0; max-height: none; box-sizing: border-box;" src=a.png><p style="width: 200px; min-width: 0; max-width: none; box-sizing: border-box;">Changed</p><img style="transform: translate(0px, 12px);" src=b.png></div>')
  })

  it('returns the original source for cancellation and unchanged values', () => {
    const source = '<P  ID = "a" style="width: 100px; min-width: 0; max-width: none; box-sizing: border-box">&#65;</P>'
    const model = createHtmlLayoutDocument(source)
    expect(applyHtmlLayoutEdits(model, [])).toBe(source)
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 100, text: 'A' }])).toBe(source)
  })

  it('gives leaf inline text a real resize box while preserving explicit layout displays', () => {
    for (const [source, expected] of [
      ['<span>Text</span>', 'inline-block'],
      ['<label style="display:inline">Text</label>', 'inline-block'],
      ['<span style="display:flex">Text</span>', 'flex']
    ]) {
      const model = createHtmlLayoutDocument(source ?? '')
      const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 200, height: 40 }])
      const element = previewTarget(createHtmlLayoutDocument(result))
      expect(element.style.display).toBe(expected)
      expect(element.style.width).toBe('200px')
    }
  })

  it('uses the requested outer dimensions for a padded and bordered text box', () => {
    const source = '<p data-keep="same" style="width:300px; padding:20px; border:10px solid red; box-sizing:content-box !important">Keep text &amp; entities</p>'
    const model = createHtmlLayoutDocument(source)
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 380, height: 120 }])
    expect(result).toBe(source.replace('content-box !important"', 'content-box !important; width: 380px; min-width: 0; max-width: none; height: 120px; min-height: 0; max-height: none; box-sizing: border-box !important;"'))
    expect(result).toContain('padding:20px; border:10px solid red;')
    expect(result).toContain('>Keep text &amp; entities</p>')
    const ordinary = createHtmlLayoutDocument(source.replace(' !important', ''))
    const element = previewTarget(createHtmlLayoutDocument(applyHtmlLayoutEdits(ordinary, [{ id: targetId(ordinary), width: 380 }])))
    expect(element.style.width).toBe('380px')
    expect(element.style.boxSizing).toBe('border-box')
  })

  it.each(['img', 'p'])('releases only the resized dimensions of a constrained %s while retaining its original CSS', tag => {
    const originalStyle = 'width:640px!important; height:480px!important; min-width:640px!important; max-width:700px!important; min-height:480px!important; max-height:500px!important; padding:8px; background:url("a&amp;b.png")'
    const source = `<${tag} data-keep="yes" style='${originalStyle}'${tag === 'img' ? ' src="../keep.png">' : '>Keep &amp; text</p>'}`
    const model = createHtmlLayoutDocument(source)
    const widthOnly = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 320 }])
    expect(widthOnly).toContain(originalStyle)
    expect(widthOnly).toContain('width: 320px !important; min-width: 0 !important; max-width: none !important; box-sizing: border-box;')
    expect(widthOnly).not.toContain('min-height: 0')
    expect(widthOnly).not.toContain('max-height: none')
    const heightOnly = applyHtmlLayoutEdits(model, [{ id: targetId(model), height: 240 }])
    expect(heightOnly).toContain(originalStyle)
    expect(heightOnly).toContain('height: 240px !important; min-height: 0 !important; max-height: none !important; box-sizing: border-box;')
    expect(heightOnly).not.toContain('min-width: 0')
    expect(heightOnly).not.toContain('max-width: none')
    const both = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 320, height: 240 }])
    expect(both).toContain(originalStyle)
    expect(both).toContain('height: 240px !important; min-height: 0 !important; max-height: none !important;')
    expect(both).toContain('data-keep="yes"')
    expect(both).toContain(tag === 'img' ? 'src="../keep.png"' : '>Keep &amp; text</p>')
    const moved = applyHtmlLayoutEdits(model, [{ id: targetId(model), offsetX: 10 }])
    expect(moved).not.toContain('min-width: 0')
    expect(moved).not.toContain('max-width: none')
    expect(moved).not.toContain('min-height: 0')
    expect(moved).not.toContain('max-height: none')
    if (tag === 'p') {
      expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), text: 'Edited' }])).toBe(source.replace('Keep &amp; text', 'Edited'))
    }
  })

  it('shrinks a complete picture group without changing any child source or image sizes', () => {
    const children = '\r\n<!-- preserve --><img SRC="../one.png" style="width:120px;height:80px" data-x=keep><p>Caption &amp; details</p><img src=../two.png>\r\n'
    const style = 'height:800px!important; min-height:800px!important; max-height:900px!important; padding:10px 20px 300px !important; border:2px solid blue; --custom:yes'
    const source = `<div id="all-pictures" data-extra=keep style='${style}'>${children}</div>`
    const model = createHtmlLayoutDocument(source)
    const id = rootTargetId(model)
    const resized = applyHtmlLayoutEdits(model, [{ id, height: 180 }], { minimumHeight: 180 })
    expect(resized).toContain(style)
    expect(resized).toContain('height: 180px !important; min-height: 0 !important; max-height: none !important; padding-bottom: 0 !important;')
    expect(resized).toContain('min-height: 180px !important;')
    expect(resized).not.toContain('min-height: 800px')
    expect(resized).not.toContain('padding-top: 0')
    expect(resized).toContain(`>${children}</div>`)
    expect(resized).toContain('id="all-pictures" data-extra=keep')
    expect(() => applyHtmlLayoutEdits(model, [{ id, text: 'Erase children' }])).toThrow('Only plain text blocks can be edited.')
    expect(applyHtmlLayoutEdits(model, [])).toBe(source)
  })

  it('clears group top padding only when explicitly requested and leaves padding intact for moving or width-only edits', () => {
    const source = '<section style="padding-top:100px!important;padding-bottom:200px!important"><img src=keep.png></section>'
    const model = createHtmlLayoutDocument(source)
    const id = rootTargetId(model)
    const top = applyHtmlLayoutEdits(model, [{ id, height: 120, clearPaddingTop: true }])
    expect(top).toContain('padding-top: 0 !important;')
    expect(top).toContain('padding-bottom: 0 !important;')
    const width = applyHtmlLayoutEdits(model, [{ id, width: 240 }])
    expect(width).not.toContain('padding-top: 0')
    expect(width).not.toContain('padding-bottom: 0')
    const moved = applyHtmlLayoutEdits(model, [{ id, offsetY: 20 }])
    expect(moved).not.toContain('padding-top: 0')
    expect(moved).not.toContain('padding-bottom: 0')
    expect(applyHtmlLayoutEdits(model, [{ id: targetId(model), height: 80, clearPaddingTop: true }])).not.toContain('padding-top: 0')
  })

  it.each(['div', 'section', 'p'])('retains author padding when locking a %s frame for contained image edits', tag => {
    const children = '\r\n<!-- retain child source --><img SRC="../one.png" width="120" data-note=keep>\r\n<img src=../two.png>\r\n'
    const originalStyle = 'width:420px; height:280px; padding:20px 24px 80px !important; border:2px solid blue; --custom:yes'
    const source = `<${tag} id="all-images" style='${originalStyle}' data-keep=yes>${children}</${tag}>`
    const model = createHtmlLayoutDocument(source)
    const id = rootTargetId(model)
    const locked = applyHtmlLayoutEdits(model, [
      { id, width: 420, height: 280, preservePaddingBottom: true },
      { id: targetId(model), width: 100, height: 70 }
    ], { minimumHeight: 280 })
    expect(locked).toContain(originalStyle)
    expect(locked).not.toContain('padding-bottom: 0')
    expect(locked).not.toContain('padding-top: 0')
    expect(locked).toContain('id="all-images"')
    expect(locked).toContain(' data-keep=yes>')
    expect(locked).toContain('SRC="../one.png" width="120" data-note=keep>')
    expect(locked).toContain('\r\n<img src=../two.png>\r\n')
    expect(locked).not.toContain('preservePaddingBottom')
    const rebuilt = createHtmlLayoutDocument(locked)
    const rootIndex = rebuilt.targets.findIndex(target => target.id === rebuilt.rootTargetId)
    const root = previewTarget(rebuilt, rootIndex)
    expect(root.style.paddingTop).toBe('20px')
    expect(root.style.paddingRight).toBe('24px')
    expect(root.style.paddingBottom).toBe('80px')
    expect(root.style.paddingLeft).toBe('24px')
    expect(root.style.height).toBe('280px')
    expect(applyHtmlLayoutEdits(model, [])).toBe(source)
  })

  it('allows an explicit container trim to replace a prior image-frame padding preservation request', () => {
    const children = '<img src="../keep.png" alt="Keep image" width="120" />'
    const source = `<div style="height:400px; padding:12px 20px 160px">${children}</div>`
    const model = createHtmlLayoutDocument(source)
    const id = rootTargetId(model)
    const trimmed = applyHtmlLayoutEdits(model, [
      { id, height: 400, preservePaddingBottom: true },
      { id, height: 180, preservePaddingBottom: false }
    ], { minimumHeight: 180 })
    expect(trimmed).toContain('padding:12px 20px 160px')
    expect(trimmed).toContain('padding-bottom: 0;')
    expect(trimmed).not.toContain('padding-top: 0')
    expect(trimmed).toContain(`>${children}</div>`)
    const rebuilt = createHtmlLayoutDocument(trimmed)
    const root = previewTarget(rebuilt, rebuilt.targets.findIndex(target => target.id === rebuilt.rootTargetId))
    expect(root.style.paddingTop).toBe('12px')
    expect(root.style.paddingRight).toBe('20px')
    expect(root.getAttribute('style')).toContain('padding-bottom: 0;')
    expect(root.style.paddingLeft).toBe('20px')
    expect(root.style.height).toBe('180px')
  })

  it('retains shorthand padding priority when trimming a previously locked image frame', () => {
    const source = '<section style="height:400px; padding:12px 20px 160px !important"><img src="../keep.png" /></section>'
    const model = createHtmlLayoutDocument(source)
    const id = rootTargetId(model)
    const locked = applyHtmlLayoutEdits(model, [{ id, height: 400, preservePaddingBottom: true }])
    expect(locked).toContain('padding:12px 20px 160px !important')
    expect(locked).not.toContain('padding-bottom: 0')
    const rebuilt = createHtmlLayoutDocument(locked)
    const trimmed = applyHtmlLayoutEdits(rebuilt, [{ id: rootTargetId(rebuilt), height: 180, preservePaddingBottom: false }])
    expect(trimmed).toContain('padding:12px 20px 160px !important')
    expect(trimmed).toContain('padding-bottom: 0 !important;')
    expect(trimmed).not.toContain('padding-top: 0')
    expect(trimmed).toContain('<img src="../keep.png" />')
  })

  it('saves fixed visual positions for a translated image paragraph without changing image attributes or original style text', () => {
    const secondStyle = 'width: 254px; min-width: 0; max-width: none; height: 48px; min-height: 0; max-height: none; box-sizing: border-box; transform: translate(1px, -1px);'
    const thirdStyle = 'width: 133px; min-width: 0; max-width: none; height: 192px; min-height: 0; max-height: none; box-sizing: border-box; transform: translate(395px, -251px);'
    const source = `<p>\n<img src="images/page-004-f1.png" alt="电感器件介绍：图组 1" width="391" />\n<img style="${secondStyle}" src="images/page-004-f2.png" alt="电感器件介绍：图组 2" width="212" />\n<img style="${thirdStyle}" src="images/page-004-f3.png" alt="电感器件介绍：图组 3" width="140" />\n</p>`
    const model = createHtmlLayoutDocument(source, src => `file:///preview/${src}`)
    const result = applyHtmlLayoutEdits(model, [
      { id: rootTargetId(model), position: 'relative', width: 650, height: 260 },
      { id: targetId(model), position: 'absolute', left: 0, top: 0, width: 391, height: 240, resetTransform: true },
      { id: targetId(model, 1), position: 'absolute', left: 392, top: -1, width: 254, height: 48, resetTransform: true },
      { id: targetId(model, 2), position: 'absolute', left: 395, top: 0, width: 133, height: 192, resetTransform: true }
    ], { minimumHeight: 260 })
    expect(result).toContain(secondStyle)
    expect(result).toContain(thirdStyle)
    for (const [index, width] of [[1, 391], [2, 212], [3, 140]]) {
      expect(result).toContain(`src="images/page-004-f${index}.png" alt="电感器件介绍：图组 ${index}" width="${width}" />`)
    }
    expect(result).not.toContain('file:///preview/')
    expect(result).not.toContain(model.markerAttribute)
    expect(result.endsWith('\n</p>')).toBe(true)
    const rebuilt = createHtmlLayoutDocument(result)
    expect(rebuilt.targets.map(target => target.kind)).toEqual(['image', 'image', 'image', 'container'])
    expect(previewTarget(rebuilt, 3).style.position).toBe('relative')
    for (const index of [0, 1, 2]) {
      expect(previewTarget(rebuilt, index).style.position).toBe('absolute')
      expect(previewTarget(rebuilt, index).style.transform).toBe('none')
    }
    expect(previewTarget(rebuilt, 1).style.top).toBe('-1px')
    expect(previewTarget(rebuilt, 2).style.left).toBe('395px')
    const moved = applyHtmlLayoutEdits(rebuilt, [{ id: targetId(rebuilt, 2), offsetX: 9, offsetY: 6 }])
    expect(previewTarget(createHtmlLayoutDocument(moved), 2).style.transform).toBe('translate(9px, 6px)')
    expect(model.source).toBe(source)
  })

  it('resets a transform only when explicitly requested and applies movement after the reset', () => {
    const source = '<img style="transform:translate(20px,30px) !important;left:1px!important;top:2px!important" src="../keep.png" />'
    const model = createHtmlLayoutDocument(source)
    const reset = applyHtmlLayoutEdits(model, [{ id: targetId(model), position: 'absolute', left: -12.5, top: -3.25, resetTransform: true, offsetX: 5, offsetY: 8 }])
    expect(reset).toContain('transform:translate(20px,30px) !important;left:1px!important;top:2px!important')
    expect(reset).toContain('left: -12.5px !important; top: -3.25px !important; transform: none !important; transform: translate(5px, 8px) !important;')
    expect(reset).toContain('src="../keep.png" />')
    const ordinary = applyHtmlLayoutEdits(model, [{ id: targetId(model), left: 40, top: 50 }])
    expect(ordinary).not.toContain('transform: none')
    expect(ordinary).not.toContain('position:')
    expect(applyHtmlLayoutEdits(model, [])).toBe(source)
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite fixed position %s without changing the source', coordinate => {
    const source = '<p>\n<img src="../keep.png" width="180" />\n</p>'
    const model = createHtmlLayoutDocument(source)
    expect(() => applyHtmlLayoutEdits(model, [{ id: targetId(model), position: 'absolute', left: coordinate }])).toThrow('Invalid layout size or offset.')
    expect(() => applyHtmlLayoutEdits(model, [{ id: targetId(model), position: 'absolute', top: coordinate }])).toThrow('Invalid layout size or offset.')
    expect(model.source).toBe(source)
  })

  it('reserves root group movement in document flow from the baseline margin without changing child geometry', () => {
    const children = '<img src="../a.png" style="width:100px;height:80px"><p>Keep</p>'
    const source = `<div style="margin:10px 20px 30px!important;transform:rotate(2deg)!important">${children}</div>`
    const model = createHtmlLayoutDocument(source)
    const id = rootTargetId(model)
    const moved = applyHtmlLayoutEdits(model, [{ id, offsetY: 40 }])
    expect(moved).toContain('margin:10px 20px 30px!important;transform:rotate(2deg)!important')
    expect(moved).toContain('transform: translate(0px, 40px) rotate(2deg) !important;')
    expect(moved).toContain('margin-bottom: max(0px, 40px, calc(30px + 40px)) !important;')
    expect(moved).toContain(`>${children}</div>`)
    const up = applyHtmlLayoutEdits(model, [{ id, offsetY: -15 }])
    expect(up).toContain('margin-bottom: max(0px, -15px, calc(30px + -15px)) !important;')
    expect(applyHtmlLayoutEdits(model, [{ id, offsetY: 0 }])).toBe(source)
    const resized = applyHtmlLayoutEdits(model, [{ id, height: 180 }])
    expect(resized).not.toContain('margin-bottom: max(')
    const inner = createHtmlLayoutDocument(`<section>${source}</section>`)
    const nestedId = containerTarget(inner, 'div').id
    expect(applyHtmlLayoutEdits(inner, [{ id: nestedId, offsetY: 40 }])).not.toContain('margin-bottom: max(')
  })

  it('uses a valid zero baseline for nonnumeric root margins while preserving percentage values', () => {
    for (const [margin, expected] of [['auto', '0px'], ['5%', '5%'], ['-200px', '-200px']]) {
      const model = createHtmlLayoutDocument(`<section style="margin-bottom:${margin}"><img src=keep.png></section>`)
      const result = applyHtmlLayoutEdits(model, [{ id: rootTargetId(model), offsetY: 20 }])
      expect(result).toContain(`margin-bottom:${margin}`)
      expect(result).toContain(`margin-bottom: max(0px, 20px, calc(${expected} + 20px));`)
    }
  })

  it.each([0, -2, NaN, Infinity])('rejects invalid width %s without changing the snapshot', width => {
    const model = createHtmlLayoutDocument('<img src=keep.png>')
    expect(() => applyHtmlLayoutEdits(model, [{ id: targetId(model), width }])).toThrow()
    expect(model.source).toBe('<img src=keep.png>')
  })

  it('rejects an unavailable target and nonfinite movement', () => {
    const model = createHtmlLayoutDocument('<p>Keep</p>')
    expect(() => applyHtmlLayoutEdits(model, [{ id: 'not-present', width: 10 }])).toThrow()
    expect(() => applyHtmlLayoutEdits(model, [{ id: targetId(model), offsetX: NaN }])).toThrow()
  })
})

describe('HTML layout sibling order and enclosing height', () => {
  it('exchanges complete neighboring targets while retaining intervening whitespace and comments', () => {
    const first = '<img  SRC="../a.png" alt="first">'
    const second = '<p class=second>Text &amp; details</p>'
    const gap = '\r\n<!-- keep gap -->\r\n'
    const source = `<div>${first}${gap}${second}</div>`
    const model = createHtmlLayoutDocument(source)
    expect(model.targets.slice(0, 2).map(target => [target.canMovePrevious, target.canMoveNext])).toEqual([[false, true], [true, false]])
    const expected = `<div>${second}${gap}${first}</div>`
    expect(reorderHtmlLayoutTarget(model, targetId(model), 'next')).toBe(expected)
    expect(reorderHtmlLayoutTarget(model, targetId(model, 1), 'previous')).toBe(expected)
  })

  it('does not cross uneditable elements, parent boundaries or incomplete source ranges', () => {
    for (const source of ['<div><p>One</p><hr><p>Two</p></div>', '<div><div><p>One</p></div><p>Two</p></div>', '<p>One<p>Two</p>']) {
      const model = createHtmlLayoutDocument(source)
      expect(model.targets[0]?.canMoveNext).toBe(false)
      expect(reorderHtmlLayoutTarget(model, targetId(model), 'next')).toBe(source)
    }
  })

  it('reorders adjacent complete picture groups as whole source fragments', () => {
    const first = '<section data-group=first><img src="../one.png"><p>One</p></section>'
    const second = '<figure class=second><img src="../two.png"><figcaption>Two</figcaption></figure>'
    const gap = '\n<!-- keep between -->\n'
    const source = `<article>${first}${gap}${second}</article>`
    const model = createHtmlLayoutDocument(source)
    const firstGroup = containerTarget(model, 'section')
    expect(firstGroup.canMoveNext).toBe(true)
    expect(reorderHtmlLayoutTarget(model, firstGroup.id, 'next')).toBe(`<article>${second}${gap}${first}</article>`)
    expect(reorderHtmlLayoutTarget(model, targetId(model), 'next')).not.toContain('<img src="../two.png"><p>One</p>')
  })

  it('returns unchanged source for unavailable or boundary reorder requests', () => {
    const model = createHtmlLayoutDocument('<div><p>Text</p></div>')
    expect(reorderHtmlLayoutTarget(model, targetId(model), 'previous')).toBe(model.source)
    expect(reorderHtmlLayoutTarget(model, 'gone', 'next')).toBe(model.source)
  })

  it('grows a single enclosing container to keep moved content clear of following Markdown', () => {
    const model = createHtmlLayoutDocument('<section class=layout><img src=a.png></section>')
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), offsetY: 80 }], { minimumHeight: 240 })
    expect(result).toBe('<section style="min-height: 240px; box-sizing: border-box;" class=layout><img style="transform: translate(0px, 80px);" src=a.png></section>')
  })

  it('retains a larger original minimum height and preserves nonpixel constraints', () => {
    for (const [style, expected] of [['min-height:300px', ''], ['min-height:20rem', 'min-height: max(20rem, 200px);']]) {
      const model = createHtmlLayoutDocument(`<div style="${style}"><img src=a.png></div>`)
      const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 100 }], { minimumHeight: 200 })
      expect(result).toContain(`style="${style}`)
      if (expected) expect(result).toContain(expected)
      else expect(result).not.toContain('min-height: 200px')
    }
  })

  it('merges size and enclosing-height edits when the root is also the selected text block', () => {
    const model = createHtmlLayoutDocument('<div style=width:100px data-x=keep>Text</div>')
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), width: 200 }], { minimumHeight: 90 })
    const element = previewTarget(createHtmlLayoutDocument(result))
    expect(element.style.width).toBe('200px')
    expect(element.style.minHeight).toBe('90px')
    expect(result).toContain(' data-x=keep>Text</div>')
  })

  it('does not restore a resized root text block\'s old minimum height when adding enclosing clearance', () => {
    const source = '<div data-keep=yes style="height:480px; min-height:480px !important; max-height:500px !important">Text</div>'
    const model = createHtmlLayoutDocument(source)
    const result = applyHtmlLayoutEdits(model, [{ id: targetId(model), height: 240 }], { minimumHeight: 240 })
    expect(result).toContain('min-height:480px !important; max-height:500px !important')
    expect(result).toContain('min-height: 0 !important; max-height: none !important;')
    expect(result).toContain('min-height: 240px !important;')
    expect(result).not.toContain('min-height: 480px')
    expect(result).toContain('data-keep=yes')
  })

  it('does not wrap multiple roots or modify container height for text-only or no-op edits', () => {
    const multiple = createHtmlLayoutDocument('<p>Text</p><img src=a.png>')
    expect(multiple.rootContainer).toBe(false)
    const changed = applyHtmlLayoutEdits(multiple, [{ id: targetId(multiple, 1), width: 80 }], { minimumHeight: 200 })
    expect(changed).not.toContain('min-height')
    const plain = createHtmlLayoutDocument('<div>Text</div>')
    expect(applyHtmlLayoutEdits(plain, [{ id: targetId(plain), text: 'Changed' }], { minimumHeight: 200 })).toBe('<div>Changed</div>')
    expect(applyHtmlLayoutEdits(plain, [{ id: targetId(plain), offsetX: 0, offsetY: 0 }], { minimumHeight: 200 })).toBe(plain.source)
  })
})
