import { describe, expect, it, vi } from 'vitest'
import { applyHtmlLayoutEdits, createHtmlLayoutDocument } from '@/util/htmlLayout'
import {
  isResponsiveHtmlLayoutContainer,
  prepareResponsiveHtmlLayoutPreview,
  responsiveHtmlLayoutImageRectangle,
  responsiveHtmlLayoutLength,
  serializeResponsiveHtmlLayout,
  transformResponsiveHtmlPreview
} from '@/util/htmlLayoutResponsive'
import { findHtmlLayoutImageOverlaps } from '@/util/htmlLayoutValidation'

const source = `<p class='original' style='position:relative; width:1372px; height:440px; box-sizing:border-box'>
<!-- gap -->
<img src='../assets/a &amp; b.png' alt='A &quot;quoted&quot; image' data-extra='keep > exactly' style='position:absolute; left:0px; top:0px; width:686px; height:220px; box-sizing:border-box'>
<img src=second.png style='position:absolute; left:686px; top:220px; width:686px; height:220px; box-sizing:border-box'>
</p>`

const parse = (html: string): HTMLTemplateElement => {
  const template = document.createElement('template')
  template.innerHTML = html
  return template
}

const mockRect = (element: HTMLElement, left: number, top: number, width: number, height: number) =>
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) })

const stageFor = (model: ReturnType<typeof createHtmlLayoutDocument>, width = 800): HTMLElement => {
  const stage = document.createElement('div')
  stage.innerHTML = model.previewHtml
  const root = stage.firstElementChild as HTMLElement
  const images = [...root.querySelectorAll('img')]
  const scale = width / 1372
  mockRect(root, 15, 25, width, 440 * scale)
  mockRect(images[0]!, 15 + 5 * scale, 25, 686 * scale, 220 * scale)
  mockRect(images[1]!, 15 + 686 * scale, 25 + 220 * scale, 686 * scale, 220 * scale)
  return stage
}

describe('responsive free HTML image groups', () => {
  it.each([480, 360, 240])('validates logical touching edges at width %s without painted rounding noise', width => {
    const html = '<div style="position:relative; width:480px; height:240px; border:4px solid red; box-sizing:border-box"><img src=a.png style="position:absolute; left:16px; top:16px; width:110px; height:72px"><img src=b.png style="position:absolute; left:126px; top:16px; width:110px; height:72px"></div>'
    const stage = document.createElement('div')
    stage.innerHTML = transformResponsiveHtmlPreview(html)
    document.body.append(stage)
    try {
      const root = stage.firstElementChild as HTMLElement
      mockRect(root, 60, 240, width, width / 2)
      const images = [...root.querySelectorAll('img')]
      for (const [index, image] of images.entries()) {
        const scale = width / 480
        mockRect(image, 60 + (index ? 130 : 20) * scale - 1 / 96, 240 + 20 * scale - 1 / 96, 110 * scale - 1 / 96, 72 * scale - 1 / 96)
      }
      const boxes = images.map(image => responsiveHtmlLayoutImageRectangle(image))
      expect(boxes.every(box => box !== undefined)).toBe(true)
      expect(Math.abs(boxes[0]!.left + boxes[0]!.width - boxes[1]!.left)).toBeLessThan(0.001)
      expect(boxes[0]!.width).toBeCloseTo(110 * width / 480, 3)
      expect(findHtmlLayoutImageOverlaps(boxes.map((rectangle, index) => ({ id: `${index}`, label: `${index}`, rectangle: rectangle! })))).toEqual([])
      images[1]!.style.setProperty('left', `calc(${images[1]!.style.left.replace(/^calc\((.*)\)$/, '$1')} - 0.1px)`, 'important')
      const painted = images[1]!.getBoundingClientRect()
      mockRect(images[1]!, painted.left - 0.1, painted.top, painted.width, painted.height)
      const moved = responsiveHtmlLayoutImageRectangle(images[1]!)
      expect(findHtmlLayoutImageOverlaps([{ id: '0', label: '0', rectangle: boxes[0]! }, { id: '1', label: '1', rectangle: moved! }])).toHaveLength(1)
    } finally { stage.remove() }
  })

  it('still rejects real fractional overlaps in logical responsive geometry', () => {
    const html = '<div style="position:relative; width:400px; height:200px; box-sizing:border-box"><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:50px"><img src=b.png style="position:absolute; left:99.9px; top:0px; width:100px; height:50px"></div>'
    const stage = document.createElement('div')
    stage.innerHTML = transformResponsiveHtmlPreview(html)
    document.body.append(stage)
    try {
      mockRect(stage.firstElementChild as HTMLElement, 10, 20, 400, 200)
      const images = [...stage.querySelectorAll('img')]
      mockRect(images[0]!, 10, 20, 100, 50)
      mockRect(images[1]!, 109.9, 20, 100, 50)
      const boxes = images.map(image => responsiveHtmlLayoutImageRectangle(image))
      expect(findHtmlLayoutImageOverlaps(boxes.map((rectangle, index) => ({ id: `${index}`, label: `${index}`, rectangle: rectangle! })))).toHaveLength(1)
      images[0]!.style.setProperty('width', 'var(--unknown)', 'important')
      expect(responsiveHtmlLayoutImageRectangle(images[0]!)).toBeUndefined()
    } finally { stage.remove() }
  })

  it('falls back to actual rectangles when CSS constraints invalidate declared geometry', () => {
    const stage = document.createElement('div')
    stage.innerHTML = transformResponsiveHtmlPreview('<div style="position:relative; width:400px; height:200px; box-sizing:border-box"><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:50px"></div>')
    document.body.append(stage)
    try {
      mockRect(stage.firstElementChild as HTMLElement, 10, 20, 400, 200)
      const image = stage.querySelector('img')!
      mockRect(image, 10, 20, 120, 50)
      expect(responsiveHtmlLayoutImageRectangle(image)).toBeUndefined()
    } finally { stage.remove() }
  })

  it.each([
    ['min-width', '100.02px'],
    ['max-height', '49.98px'],
    ['padding', '60px'],
    ['border', '60px solid red']
  ])('rejects a declared geometry approximation constrained by %s', (property, value) => {
    const stage = document.createElement('div')
    stage.innerHTML = transformResponsiveHtmlPreview('<div style="position:relative; width:400px; height:200px; box-sizing:border-box"><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:50px"></div>')
    document.body.append(stage)
    try {
      mockRect(stage.firstElementChild as HTMLElement, 10, 20, 400, 200)
      const image = stage.querySelector('img')!
      mockRect(image, 10, 20, 100.02, 50)
      image.style.setProperty(property, value, 'important')
      expect(responsiveHtmlLayoutImageRectangle(image)).toBeUndefined()
    } finally { stage.remove() }
  })

  it('renders legacy fixed groups as one ratio-preserving canvas without changing source', () => {
    const model = createHtmlLayoutDocument(source)
    const preview = parse(prepareResponsiveHtmlLayoutPreview(model))
    const root = preview.content.firstElementChild as HTMLElement
    expect(root.style.width).toBe('100%')
    expect(root.style.maxWidth).toBe('1372px')
    expect(root.style.height).toBe('auto')
    expect(root.style.aspectRatio).toBe('1372 / 440')
    expect(root.getAttribute(model.markerAttribute)).toBe(model.rootTargetId)
    const images = [...root.querySelectorAll('img')]
    expect(images.map(image => [image.style.left, image.style.top, image.style.width, image.style.height])).toEqual([
      ['0%', '0%', '50%', '50%'], ['50%', '50%', '50%', '50%']
    ])
    expect(images[0]!.getAttribute(model.markerAttribute)).toBe(model.targets[0]!.id)
    expect(isResponsiveHtmlLayoutContainer(root)).toBe(true)
    expect(model.source).toBe(source)
    expect(model.previewHtml).toContain('width:1372px')
  })

  it('folds translation chains and margins into the saved image border-box positions', () => {
    const preview = parse(transformResponsiveHtmlPreview('<div style="position:relative; width:400px; height:200px; box-sizing:border-box"><img src=a.png style="position:absolute; left:20px; top:30px; width:100px; height:50px; margin:3px; transform:translate(4px, 5px) translateX(2px)"></div>'))
    const image = preview.content.querySelector('img')!
    expect(image.style.left).toBe('7.25%')
    expect(image.style.top).toBe('19%')
    expect(image.style.width).toBe('25%')
    expect(image.style.height).toBe('25%')
    expect(image.style.margin).toBe('0px')
    expect(image.style.transform).toBe('none')
  })

  it('includes content-box padding and borders in the design dimensions', () => {
    const preview = parse(transformResponsiveHtmlPreview('<div style="position:relative; width:400px; height:200px; padding:20px; border:2px solid red"><img src=a.png style="position:absolute; left:20px; top:10px; width:100px; height:50px"></div>'))
    const root = preview.content.firstElementChild as HTMLElement
    expect(root.style.maxWidth).toBe('444px')
    expect(root.style.aspectRatio).toBe('444 / 244')
    expect(root.style.padding).toBe('0px')
    expect(root.style.borderLeftWidth).toBe('2px')
    const expected = document.createElement('img')
    expected.style.left = responsiveHtmlLayoutLength(22, 444, 4, 2)
    expected.style.width = responsiveHtmlLayoutLength(100, 444, 4)
    expect(root.querySelector('img')!.style.left).toBe(expected.style.left)
    expect(root.querySelector('img')!.style.width).toBe(expected.style.width)
  })

  it('corrects padding-box percentages at every displayed scale', () => {
    const width = 444
    const left = 22
    for (const scale of [1, 0.8, 0.25]) {
      const paddingBox = width * scale - 4
      const percentageOffset = (left / width) * paddingBox + (left / width * 4 - 2)
      expect(2 + percentageOffset).toBeCloseTo(left * scale, 10)
      const percentageSize = (100 / width) * paddingBox + 100 / width * 4
      expect(percentageSize).toBeCloseTo(100 * scale, 10)
    }
    expect(() => responsiveHtmlLayoutLength(1, 0)).toThrow('Invalid responsive HTML geometry.')
  })

  it('includes positive image overflow in one canvas while retaining the original display-width cap', () => {
    const html = '<div style="position:relative; width:400px; height:200px; box-sizing:border-box"><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:50px; box-sizing:border-box"><img src=b.png style="position:absolute; left:400px; top:200px; width:100px; height:50px; box-sizing:border-box"></div>'
    const model = createHtmlLayoutDocument(html)
    const root = parse(prepareResponsiveHtmlLayoutPreview(model)).content.firstElementChild as HTMLElement
    const images = [...root.querySelectorAll('img')]
    expect(root.style.width).toBe('100%')
    expect(root.style.maxWidth).toBe('400px')
    expect(root.style.aspectRatio).toBe('500 / 250')
    expect(images.map(image => [image.style.left, image.style.top, image.style.width, image.style.height])).toEqual([
      ['0%', '0%', '20%', '20%'], ['80%', '80%', '20%', '20%']
    ])
    expect(model.source).toBe(html)
    expect(serializeResponsiveHtmlLayout(model, document.createElement('div'), html)).toBe(html)
  })

  it('shifts negative image overflow to one shared origin without changing pairwise geometry', () => {
    const html = '<div style="position:relative; width:400px; height:200px; box-sizing:border-box"><img src=a.png style="position:absolute; left:-100px; top:-50px; width:100px; height:50px; box-sizing:border-box"><img src=b.png style="position:absolute; left:200px; top:100px; width:100px; height:50px; box-sizing:border-box"></div>'
    const root = parse(transformResponsiveHtmlPreview(html)).content.firstElementChild as HTMLElement
    const images = [...root.querySelectorAll('img')]
    expect(root.style.maxWidth).toBe('400px')
    expect(root.style.aspectRatio).toBe('500 / 250')
    expect(images.map(image => [image.style.left, image.style.top, image.style.width, image.style.height])).toEqual([
      ['0%', '0%', '20%', '20%'], ['60%', '60%', '20%', '20%']
    ])
    const displayWidth = 300
    const sharedScale = displayWidth / 500
    expect((parseFloat(images[1]!.style.left) - parseFloat(images[0]!.style.left)) * displayWidth / 100).toBe(300 * sharedScale)
    expect(parseFloat(images[0]!.style.width) * displayWidth / 100).toBe(100 * sharedScale)
  })

  it.each([
    '<div style="position:relative; width:1372px; height:440px"><img src=a.png><img src=b.png></div>',
    '<div style="position:relative; width:1372px; height:440px"><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:100px"><p>Caption</p></div>',
    '<div style="position:relative; width:1372px; height:440px"><p><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:100px"></p></div>',
    '<div style="position:relative; width:1372px; height:440px"><img src=a.png style="position:absolute; left:0px; top:0px; width:100px; height:100px; transform:rotate(15deg)"></div>'
  ])('preserves unsupported flow, nested and transformed source without guessing geometry', html => {
    expect(transformResponsiveHtmlPreview(html)).toBe(html)
  })

  it('keeps existing responsive groups byte-identical on the render path', () => {
    const responsive = transformResponsiveHtmlPreview(source)
    expect(transformResponsiveHtmlPreview(responsive)).toBe(responsive)
  })

  it('keeps no-op application byte-identical even when the preview has been normalized', () => {
    const model = createHtmlLayoutDocument(source)
    const stage = document.createElement('div')
    stage.innerHTML = prepareResponsiveHtmlLayoutPreview(model)
    expect(serializeResponsiveHtmlLayout(model, stage, source)).toBe(source)
  })

  it('saves current measured geometry, retains the original design cap, and patches only style attributes', () => {
    const model = createHtmlLayoutDocument(source, src => `file:///resolved/${src}`)
    const stage = stageFor(model, 480)
    const draft = applyHtmlLayoutEdits(model, [{ id: model.targets[0]!.id, left: 5 }])
    const saved = serializeResponsiveHtmlLayout(model, stage, draft)
    const root = parse(saved).content.firstElementChild as HTMLElement
    expect(root.style.width).toBe('100%')
    expect(root.style.maxWidth).toBe('1372px')
    expect(root.style.aspectRatio).toBe(`480 / ${Number((440 * 480 / 1372).toFixed(10))}`)
    expect(root.querySelector('img')!.style.left).toBe(`${Number((5 / 1372 * 100).toFixed(10))}%`)
    expect(root.style.getPropertyPriority('width')).toBe('important')
    expect(saved).toContain("class='original'")
    expect(saved).toContain("src='../assets/a &amp; b.png'")
    expect(saved).toContain("alt='A &quot;quoted&quot; image'")
    expect(saved).toContain("data-extra='keep > exactly'")
    expect(saved).toContain('src=second.png')
    expect(saved).toContain('<!-- gap -->')
    expect(saved).not.toContain('file:///resolved')
    expect(saved).not.toContain(model.markerAttribute)
    expect(serializeResponsiveHtmlLayout(model, stage, saved)).toBe(saved)
  })

  it('preserves the earlier max-width after editing an already-responsive group in a narrow viewport', () => {
    const responsive = transformResponsiveHtmlPreview(source)
    const model = createHtmlLayoutDocument(responsive)
    const stage = stageFor(model, 480)
    const draft = applyHtmlLayoutEdits(model, [{ id: model.targets[0]!.id, width: 220, height: 110 }])
    const saved = serializeResponsiveHtmlLayout(model, stage, draft)
    expect(parse(saved).content.firstElementChild?.getAttribute('style')).toContain('max-width: 1372px !important')
  })

  it('does not convert an untouched nested group when only neighboring text is edited', () => {
    const nested = `<section>${source}<div>Caption</div></section>`
    const model = createHtmlLayoutDocument(nested)
    const stage = document.createElement('div')
    stage.innerHTML = model.previewHtml
    const root = stage.querySelector('p')!
    mockRect(root, 0, 0, 800, 440 * 800 / 1372)
    for (const image of root.querySelectorAll('img')) mockRect(image, 0, 0, 100, 100)
    const text = model.targets.find(target => target.kind === 'text')!
    const draft = applyHtmlLayoutEdits(model, [{ id: text.id, text: 'Changed' }])
    expect(serializeResponsiveHtmlLayout(model, stage, draft)).toBe(draft)
    expect(draft).toContain(source)
  })
})
