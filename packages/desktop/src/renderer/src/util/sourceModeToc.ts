import type CodeMirror from 'codemirror'
import { lexBlock } from '@muyajs/core/utils/marked/lexBlock'
import { tokenizer, tokensToPlainText } from '@muyajs/core/inlineRenderer/lexer'
import { generateGithubSlug } from '@muyajs/core/utils/slug'
import { getTocHeadingScrollTop } from './tocNavigation'

/** The CodeMirror surface `scrollSourceEditorToLine` needs. */
type ISourceEditor = Pick<CodeMirror.Editor, 'setCursor' | 'heightAtLine'>

export interface SourceTocOptions {
  footnote?: boolean
  texMathDollars?: boolean
  texMathGfm?: boolean
  texMathSingleBackslash?: boolean
  texMathDoubleBackslash?: boolean
  superSubScript?: boolean
  frontMatter?: boolean
}

export interface SourceTocEntry {
  slug: string
  githubSlug: string
  content: string
  lvl: number
  line: number
}

interface SourceHeading {
  content: string
  source: string
  lvl: number
  line: number
}

let sourceHeadingSequence = 0
let cachedHeadings: { markdown: string; settings: string; headings: SourceHeading[] } | null = null

const sourceHeadings = (markdown: string, options: SourceTocOptions): SourceHeading[] => {
  const settings = {
    footnote: options.footnote ?? false,
    texMathDollars: options.texMathDollars ?? true,
    texMathGfm: options.texMathGfm ?? false,
    texMathSingleBackslash: options.texMathSingleBackslash ?? false,
    texMathDoubleBackslash: options.texMathDoubleBackslash ?? false,
    superSubScript: options.superSubScript ?? false,
    frontMatter: options.frontMatter ?? true
  }
  const key = JSON.stringify(settings)
  if (cachedHeadings?.markdown === markdown && cachedHeadings.settings === key) return cachedHeadings.headings
  const headings: SourceHeading[] = []
  let line = 0
  let previousListRaw: string | null = null
  for (const token of lexBlock(markdown.replace(/\r\n?/g, '\n'), settings)) {
    if (token.type === 'heading') {
      const content = tokensToPlainText(tokenizer(token.text, { hasBeginRules: false, options: settings })).trim()
      headings.push({ content, source: token.text, lvl: token.depth, line })
    }
    // Muya splits mixed task/list kinds into siblings that share the original list's raw range.
    if (token.type !== 'list' || token.raw !== previousListRaw) line += (token.raw.match(/\n/g) ?? []).length
    previousListRaw = token.type === 'list' ? token.raw : null
  }
  // One snapshot serves every heading lookup during a scroll without retaining previous documents.
  cachedHeadings = { markdown, settings: key, headings }
  return headings
}

export function buildSourceToc(
  markdown: string,
  previous: ReadonlyArray<{ slug?: unknown }> = [],
  options: SourceTocOptions = {}
): SourceTocEntry[] {
  const used = new Set<string>()
  const reserved = new Set(previous.flatMap(entry => typeof entry.slug === 'string' && entry.slug ? [entry.slug] : []))
  return sourceHeadings(markdown, options).map((heading, index) => {
    const previousSlug = previous[index]?.slug
    let slug = typeof previousSlug === 'string' && previousSlug && !used.has(previousSlug) ? previousSlug : ''
    if (!slug) {
      do { slug = `source-heading-${++sourceHeadingSequence}` } while (reserved.has(slug) || used.has(slug))
    }
    used.add(slug)
    const { content, lvl, line } = heading
    return { content, lvl, line, slug, githubSlug: generateGithubSlug(content) }
  })
}

/**
 * Scroll the Source Code editor so `line` sits at the TOP of the viewport,
 * animated.
 *
 * The editor runs CodeMirror with `viewportMargin: Infinity`, so CodeMirror
 * renders the whole document at full height and its own `.CodeMirror-scroll`
 * never scrolls — the OUTER `.source-code` container (`scrollContainer`) is the
 * scrollable element. So neither `cm.scrollTo` nor `cm.scrollIntoView` moves
 * anything; we scroll the container directly to the line's local Y, which puts
 * the line at the top (CodeMirror's `scrollIntoView` only scrolled minimally,
 * leaving the heading at the bottom edge with no animation). `setCursor` gets
 * `scroll: false` so its native caret-into-view scroll doesn't fight the
 * animation.
 */
export function scrollSourceEditorToLine(
  editor: ISourceEditor,
  line: number,
  scrollContainer: HTMLElement | null | undefined
): void {
  // `ch` is a positional filler: CodeMirror ignores it when `pos` is an object.
  editor.setCursor({ line, ch: 0 }, undefined, { scroll: false })

  if (!scrollContainer) return
  // CodeMirror's local height excludes the wrapper margin. Measure the full
  // rendered line so source and document headings share the same visible gap.
  const element = scrollContainer.querySelectorAll('.CodeMirror-code .CodeMirror-line')[line]
  const top = element ? getTocHeadingScrollTop(scrollContainer, element) : editor.heightAtLine(line, 'local')
  scrollContainer.scrollTo({ top, behavior: 'smooth' })
}

/**
 * Find the 0-based line number of the `headingIndex`-th markdown heading
 * (ATX `# foo` or setext `foo\n===`) in document order, skipping fenced code
 * blocks and raw HTML blocks. Returns -1 when not found.
 *
 * Used by Source Code mode to resolve a TOC entry (whose order matches the
 * document heading order muya builds the TOC from) to a CodeMirror line.
 */
export function findMarkdownHeadingLine(markdown: string, headingIndex: number, options: SourceTocOptions = {}): number {
  return sourceHeadings(markdown, options)[headingIndex]?.line ?? -1
}

/** Raw inline Markdown for the same top-level heading order used by both editor modes. */
export function getMarkdownHeadingSource(markdown: string, headingIndex: number, options: SourceTocOptions = {}): string {
  return sourceHeadings(markdown, options)[headingIndex]?.source ?? ''
}
