import { afterEach, describe, expect, it, vi } from 'vitest'
import * as blockLexer from '@muyajs/core/utils/marked/lexBlock'
import { buildSourceToc, findMarkdownHeadingLine, scrollSourceEditorToLine } from '@/util/sourceModeToc'

afterEach(() => vi.restoreAllMocks())

describe('buildSourceToc', () => {
  it('matches the top-level engine heading order while excluding nested and opaque blocks', () => {
    const markdown = [
      '# First', '', '<div>', '# html', '</div>', '',
      '> ## quote', '', '- ## list', '  ### nested', '',
      '````', '```', '# code', '````', '',
      '$$', '# math', '$$', '', 'Final', '===='
    ].join('\n')
    const toc = buildSourceToc(markdown)
    expect(toc.map(({ content, lvl, line }) => ({ content, lvl, line }))).toEqual([
      { content: 'First', lvl: 1, line: 0 },
      { content: 'Final', lvl: 1, line: 20 }
    ])
    expect(findMarkdownHeadingLine(markdown, 1)).toBe(20)
  })

  it('accounts for frontmatter, multiline setext headings and CRLF source positions', () => {
    const markdown = ['---', '# yaml', '---', '', 'First line', 'second line', '===', '', '## Last'].join('\r\n')
    expect(buildSourceToc(markdown).map(({ content, lvl, line }) => ({ content, lvl, line }))).toEqual([
      { content: 'First line second line', lvl: 1, line: 4 },
      { content: 'Last', lvl: 2, line: 8 }
    ])
    expect(findMarkdownHeadingLine(markdown, 1)).toBe(8)
  })

  it('uses the rendered inline label and the same Unicode GitHub slug as Muya', () => {
    const [heading] = buildSourceToc('# **粗体** [label](https://example.com) `code` &amp; ![cat](cat.png)')
    expect(heading.content).toBe('粗体 label code & cat')
    expect(heading.githubSlug).toBe('粗体-label-code-cat')
  })

  it.each(['- normal\n- [x] task\n- normal', '1. normal\n2. [x] task\n3. normal'])('counts mixed list source ranges only once: %s', (list) => {
    const markdown = `${list}\n\n# After mixed list`
    expect(buildSourceToc(markdown)[0].line).toBe(4)
    expect(findMarkdownHeadingLine(markdown, 0)).toBe(4)
  })

  it('preserves unique heading identities by index through rename, duplicate labels and additions', () => {
    const previous = [{ slug: 'engine-first' }, { slug: 'engine-second' }]
    const toc = buildSourceToc('# Rename\n\n## Rename\n\n### Added', previous)
    expect(toc[0].slug).toBe('engine-first')
    expect(toc[1].slug).toBe('engine-second')
    expect(toc[2].slug).toMatch(/^source-heading-\d+$/)
    expect(new Set(toc.map(entry => entry.slug)).size).toBe(3)
    expect(toc[0].githubSlug).toBe(toc[1].githubSlug)
  })

  it('repairs duplicate prior identities and never reuses a reserved generated identity', () => {
    const toc = buildSourceToc('# One\n\n## Two\n\n### Three', [{ slug: 'source-heading-1' }, { slug: 'source-heading-1' }])
    expect(toc[0].slug).toBe('source-heading-1')
    expect(new Set(toc.map(entry => entry.slug)).size).toBe(3)
  })

  it('honors disabled math and frontmatter parsing without a different navigation heading order', () => {
    const math = ['# First', '', '$$', '# Inside', '$$', '', '# Last'].join('\n')
    expect(buildSourceToc(math).map(entry => entry.content)).toEqual(['First', 'Last'])
    const options = { texMathDollars: false }
    expect(buildSourceToc(math, [], options).map(entry => entry.content)).toEqual(['First', 'Inside', 'Last'])
    expect(findMarkdownHeadingLine(math, 1, options)).toBe(3)
    expect(findMarkdownHeadingLine(math, 2, options)).toBe(6)
    expect(buildSourceToc('---\n# yaml\n---\n\n# Real', [], { frontMatter: false }).map(entry => entry.content)).toEqual(['yaml', 'Real'])
  })

  it('keeps footnote headings nested and renders superscript according to editor preferences', () => {
    const markdown = '[^note]:\n    # nested\n\n# H~2~O'
    expect(buildSourceToc(markdown, [], { footnote: true, superSubScript: true }).map(entry => entry.content)).toEqual(['H2O'])
    expect(buildSourceToc('# H~2~O', [], { superSubScript: false })[0].content).toBe('H~2~O')
  })

  it('shares one bounded lexer snapshot across repeated heading lookups and invalidates changed options', () => {
    const lex = vi.spyOn(blockLexer, 'lexBlock')
    const markdown = '# Cached one\n\n## Cached two'
    buildSourceToc(markdown)
    findMarkdownHeadingLine(markdown, 0)
    findMarkdownHeadingLine(markdown, 1)
    expect(lex).toHaveBeenCalledTimes(1)
    findMarkdownHeadingLine(markdown, 1, { texMathDollars: false })
    expect(lex).toHaveBeenCalledTimes(2)
    buildSourceToc(markdown + '\n\n### Changed', [], { texMathDollars: false })
    expect(lex).toHaveBeenCalledTimes(3)
  })
})

// marktext #3580: in Source Code mode, clicking a TOC entry must scroll the
// CodeMirror editor to the heading's line. This resolves a TOC index to a line.
describe('findMarkdownHeadingLine', () => {
  const doc = [
    '# First', // 0
    '', // 1
    'text', // 2
    '', // 3
    '## Second', // 4
    '', // 5
    'Setext', // 6
    '------', // 7  (setext h2 underline for line 6)
    '', // 8
    '### Third', // 9
  ].join('\n')

  it('finds the line of the N-th heading (ATX + setext, in order)', () => {
    expect(findMarkdownHeadingLine(doc, 0)).toBe(0) // # First
    expect(findMarkdownHeadingLine(doc, 1)).toBe(4) // ## Second
    expect(findMarkdownHeadingLine(doc, 2)).toBe(6) // Setext (setext heading)
    expect(findMarkdownHeadingLine(doc, 3)).toBe(9) // ### Third
  })

  it('returns -1 for an out-of-range index', () => {
    expect(findMarkdownHeadingLine(doc, 4)).toBe(-1)
    expect(findMarkdownHeadingLine(doc, -1)).toBe(-1)
  })

  it('ignores `#` and `---` inside fenced code blocks', () => {
    const fenced = [
      '# Real', // 0
      '', // 1
      '```', // 2
      '# not a heading', // 3
      'fake setext', // 4
      '---', // 5
      '```', // 6
      '', // 7
      '## AlsoReal', // 8
    ].join('\n')
    expect(findMarkdownHeadingLine(fenced, 0)).toBe(0)
    expect(findMarkdownHeadingLine(fenced, 1)).toBe(8)
  })

  it('keeps raw HTML image layouts opaque to ATX and setext heading detection', () => {
    const html = [
      '# First',
      '',
      '<div class="gallery">',
      '# inner text',
      'Fake setext',
      '---',
      '<h2>Raw heading</h2>',
      '</div>',
      '',
      '# Second'
    ].join('\n')
    expect(findMarkdownHeadingLine(html, 0)).toBe(0)
    expect(findMarkdownHeadingLine(html, 1)).toBe(9)
    expect(findMarkdownHeadingLine(html, 2)).toBe(-1)
  })

  it.each([
    ['<pre>', '</pre>'],
    ['<script>', '</script>'],
    ['<style>', '</style>'],
    ['<textarea>', '</textarea>'],
    ['<!--', '-->'],
    ['<?process', '?>'],
    ['<!DOCTYPE', '>'],
    ['<![CDATA[', ']]>']
  ])('ignores headings across blank lines until the %s block closes', (opening, closing) => {
    const html = [opening, '# hidden', '', '## still hidden', closing, '', '# Real'].join('\n')
    expect(findMarkdownHeadingLine(html, 0)).toBe(6)
    expect(findMarkdownHeadingLine(html, 1)).toBe(-1)
  })

  it('ends ordinary block HTML at a blank line instead of waiting for its closing tag', () => {
    const html = ['<div>', '# hidden', '', '# Real', '</div>', '', '## After'].join('\n')
    expect(findMarkdownHeadingLine(html, 0)).toBe(3)
    expect(findMarkdownHeadingLine(html, 1)).toBe(6)
  })

  it('recognizes a block tag that interrupts a paragraph', () => {
    const html = ['Paragraph', '<section>', '# hidden', '</section>', '', '# Real'].join('\n')
    expect(findMarkdownHeadingLine(html, 0)).toBe(5)
  })

  it('treats standalone custom tags as HTML blocks without treating inline HTML as a block', () => {
    const standalone = ['<custom data-label="image group">', '# hidden', '</custom>', '', '# Real'].join('\n')
    expect(findMarkdownHeadingLine(standalone, 0)).toBe(4)
    expect(findMarkdownHeadingLine('<span>inline text</span>\n# Real', 0)).toBe(1)
    expect(findMarkdownHeadingLine('Paragraph with <img src="one.png">\n# Real', 0)).toBe(1)
  })

  it('does not let a standalone inline tag interrupt an existing paragraph', () => {
    expect(findMarkdownHeadingLine('Paragraph\n<span>\n## Real', 0)).toBe(2)
  })

  it('keeps headings hidden in an unfinished raw block and allows headings after a one-line comment', () => {
    expect(findMarkdownHeadingLine('<pre>\n# hidden\n\n## hidden', 0)).toBe(-1)
    expect(findMarkdownHeadingLine('<!-- note -->\n# Real', 0)).toBe(1)
  })
})

// marktext #3580 follow-up: clicking a TOC entry in Source Code mode must put
// the heading at the TOP of the viewport (not the bottom, as CodeMirror's
// minimal `scrollIntoView` did) and animate the scroll. Because CodeMirror runs
// with viewportMargin: Infinity (full-height render), the OUTER `.source-code`
// container is the scrollable element — that is what gets scrolled.
type SourceEditor = Parameters<typeof scrollSourceEditorToLine>[0]

describe('scrollSourceEditorToLine', () => {
  const makeEditor = () => {
    const setCursor = vi.fn()
    const heightAtLine = vi.fn(() => 480)
    const editor: SourceEditor = { setCursor, heightAtLine }
    return { editor, setCursor, heightAtLine }
  }

  it('smooth-scrolls the container so the line sits at the top', () => {
    const { editor, setCursor, heightAtLine } = makeEditor()
    const containerScrollTo = vi.fn()
    const container = document.createElement('div')
    container.scrollTo = containerScrollTo

    scrollSourceEditorToLine(editor, 12, container)

    // line top resolved as a local Y coordinate
    expect(heightAtLine).toHaveBeenCalledWith(12, 'local')
    // the OUTER container is scrolled so that Y sits at the top, animated
    expect(containerScrollTo).toHaveBeenCalledWith({ top: 480, behavior: 'smooth' })
    // caret moved without its native scroll fighting the animation
    expect(setCursor).toHaveBeenCalledWith({ line: 12, ch: 0 }, undefined, { scroll: false })
  })

  it('still places the caret but does not throw when no container is given', () => {
    const { editor, setCursor, heightAtLine } = makeEditor()
    scrollSourceEditorToLine(editor, 5, null)
    expect(setCursor).toHaveBeenCalledWith({ line: 5, ch: 0 }, undefined, { scroll: false })
    expect(heightAtLine).not.toHaveBeenCalled()
  })

  it.each([80, 108])('includes wrapper margins and viewport chrome at top %s when revealing a rendered heading', (viewportTop) => {
    const { editor, heightAtLine } = makeEditor()
    const container = document.createElement('div')
    container.innerHTML = '<div class="CodeMirror-code"><pre class="CodeMirror-line"># First</pre><pre class="CodeMirror-line"># Target</pre></div>'
    container.scrollTop = 160
    const heading = container.querySelectorAll('.CodeMirror-line')[1]
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: viewportTop } as DOMRect)
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ top: 514 } as DOMRect)
    const scroll = vi.fn()
    container.scrollTo = scroll

    scrollSourceEditorToLine(editor, 1, container)

    expect(scroll).toHaveBeenCalledWith({ top: 160 + 514 - viewportTop - 24, behavior: 'smooth' })
    expect(heightAtLine).not.toHaveBeenCalled()
  })
})
