import { tokenizer, tokensToPlainText } from '@muyajs/core/inlineRenderer/lexer'
import type { Token } from '@muyajs/core/inlineRenderer/types'
import type { SourceTocOptions } from './sourceModeToc'

export interface FloatingTocTextRun {
  text: string
  color?: string
}

/** Keep inline heading colors as text runs; no source HTML or other styles reach the directory DOM. */
export function floatingTocLabel(source: string, label: string, options: SourceTocOptions = {}): FloatingTocTextRun[] {
  const tokens = tokenizer(source, {
    hasBeginRules: false,
    options: {
      footnote: options.footnote ?? false,
      texMathDollars: options.texMathDollars ?? true,
      texMathGfm: options.texMathGfm ?? false,
      texMathSingleBackslash: options.texMathSingleBackslash ?? false,
      texMathDoubleBackslash: options.texMathDoubleBackslash ?? false,
      superSubScript: options.superSubScript ?? false
    }
  })
  const runs: FloatingTocTextRun[] = []
  const style = document.createElement('span').style
  const append = (text: string, color?: string): void => {
    if (!text) return
    const last = runs[runs.length - 1]
    if (last && last.color === color) last.text += text
    else runs.push(color ? { text, color } : { text })
  }
  const walk = (items: Token[], inherited?: string): void => {
    for (const token of items) {
      let color = inherited
      if (token.type === 'html_tag') {
        style.cssText = token.attrs.style ?? ''
        if (!style.color && token.tag.toLowerCase() === 'font') style.color = token.attrs.color ?? ''
        // Inheritance keywords must keep the enclosing run's color after the HTML wrappers are flattened.
        if (style.color && !/^(inherit|unset|revert|revert-layer|currentcolor)$/i.test(style.color)) color = style.color
      }
      if ('children' in token && Array.isArray(token.children)) walk(token.children, color)
      else append(tokensToPlainText([token]), color)
    }
  }
  walk(tokens)
  if (runs.length) {
    runs[0].text = runs[0].text.trimStart()
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd()
  }
  // A transient editor/source mismatch must never replace the heading text or its navigation identity.
  return runs.map(run => run.text).join('') === label ? runs.filter(run => run.text) : [{ text: label }]
}
