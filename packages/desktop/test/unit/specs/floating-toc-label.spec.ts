import { describe, expect, it } from 'vitest'
import { floatingTocLabel } from '@/util/floatingTocLabel'
import { buildSourceToc, getMarkdownHeadingSource } from '@/util/sourceModeToc'

describe('floating directory heading colors', () => {
  it('preserves whole-heading and partial colors through nested Markdown and HTML', () => {
    expect(floatingTocLabel('<span style="color:#e53935">提问：**什么是差分**</span>', '提问：什么是差分')).toEqual([
      { text: '提问：什么是差分', color: 'rgb(229, 57, 53)' }
    ])
    expect(floatingTocLabel('状态与<span style="color:blue">电压<em style="color:red">判读</em></span>', '状态与电压判读')).toEqual([
      { text: '状态与' }, { text: '电压', color: 'blue' }, { text: '判读', color: 'red' }
    ])
  })

  it('supports legacy font color and enclosing color inheritance without losing text', () => {
    expect(floatingTocLabel('<font color="#2468ac">A <span style="color:inherit">B</span></font> &amp; C', 'A B & C')).toEqual([
      { text: 'A B', color: 'rgb(36, 104, 172)' }, { text: ' & C' }
    ])
  })

  it('allows only the CSS text color, ignoring source event handlers, layout and invalid colors', () => {
    const runs = floatingTocLabel('<span onclick="alert(1)" style="color:red;position:fixed;background:url(https://invalid.example/x)">Safe</span>', 'Safe')
    expect(runs).toEqual([{ text: 'Safe', color: 'red' }])
    expect(floatingTocLabel('<span style="color:url(javascript:alert(1))">Safe</span>', 'Safe')).toEqual([{ text: 'Safe' }])
    expect(document.querySelector('[onclick]')).toBeNull()
  })

  it('falls back to the current visible label when source and editor snapshots differ', () => {
    expect(floatingTocLabel('<span style="color:red">Previous</span>', 'Current')).toEqual([{ text: 'Current' }])
    expect(floatingTocLabel('', '<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>' }])
  })

  it('uses the same top-level ATX and setext order as navigation, skipping quoted and fenced headings', () => {
    const markdown = '# <span style="color:blue">Root</span>\n\n> ## Quoted\n\n```md\n## Fenced\n```\n\n<span style="color:red">Second</span>\n---\n'
    const headings = buildSourceToc(markdown)
    expect(headings.map(heading => heading.content)).toEqual(['Root', 'Second'])
    expect(getMarkdownHeadingSource(markdown, 1)).toBe('<span style="color:red">Second</span>')
    expect(getMarkdownHeadingSource(markdown, 2)).toBe('')
    expect(Object.keys(headings[0]).sort()).toEqual(['content', 'githubSlug', 'line', 'lvl', 'slug'])
  })
})
