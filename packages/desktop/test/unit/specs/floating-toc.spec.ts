import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import * as tocHelpers from '@/util/floatingToc'
import type { FloatingTocEntry } from '@/util/floatingToc'
import * as sourceModeToc from '@/util/sourceModeToc'
import * as tocLabels from '@/util/floatingTocLabel'
import * as tocNavigation from '@/util/tocNavigation'

const heading = (slug: string, level: number, label = slug) => ({ slug, lvl: level, content: label })
const nestedHeadings = () => [
  heading('root', 1, 'Introduction'),
  heading('branch', 2, 'First chapter'),
  heading('nested', 3, 'Details'),
  heading('leaf', 4, 'Example'),
  heading('sibling', 2, 'Second chapter'),
  heading('last', 1, 'Summary')
]
const slugs = (entries: readonly FloatingTocEntry[]) => entries.map(entry => entry.slug)

describe('floating table of contents hierarchy', () => {
  it('keeps document order, true parents and whether each heading has descendants', () => {
    const entries = tocHelpers.deriveFloatingToc(nestedHeadings())
    expect(entries.map(({ slug, parentSlug, hasChildren }) => ({ slug, parentSlug, hasChildren }))).toEqual([
      { slug: 'root', parentSlug: null, hasChildren: true },
      { slug: 'branch', parentSlug: 'root', hasChildren: true },
      { slug: 'nested', parentSlug: 'branch', hasChildren: true },
      { slug: 'leaf', parentSlug: 'nested', hasChildren: false },
      { slug: 'sibling', parentSlug: 'root', hasChildren: false },
      { slug: 'last', parentSlug: null, hasChildren: false }
    ])
  })

  it('attaches skipped heading levels to the nearest preceding lower level', () => {
    const entries = tocHelpers.deriveFloatingToc([
      heading('opening', 2), heading('deep', 5), heading('other', 3), heading('end', 1)
    ])
    expect(entries.map(entry => entry.parentSlug)).toEqual([null, 'opening', 'opening', null])
    expect([...tocHelpers.floatingTocAncestors(entries, 'deep')]).toEqual(['opening'])
  })

  it('preserves the original DOM heading index when rejecting invalid records', () => {
    const entries = tocHelpers.deriveFloatingToc([
      { slug: undefined, lvl: null },
      heading('first', 1),
      { slug: 'invalid-level', lvl: 7 },
      heading('next', 2),
      { slug: '', lvl: 3 }
    ])
    expect(entries.map(entry => ({ slug: entry.slug, index: entry.index }))).toEqual([
      { slug: 'first', index: 1 }, { slug: 'next', index: 3 }
    ])
  })

  it('keeps duplicate titles distinct through editor-provided stable block slugs', () => {
    const headings = [heading('block-a', 1, 'Repeated'), heading('block-b', 1, 'Repeated')]
    const original = tocHelpers.deriveFloatingToc(headings)
    const renamed = tocHelpers.deriveFloatingToc([headings[0], heading('block-b', 1, 'Renamed')])
    expect(slugs(original)).toEqual(['block-a', 'block-b'])
    expect(slugs(renamed)).toEqual(['block-a', 'block-b'])
    expect(original.map(entry => entry.label)).toEqual(['Repeated', 'Repeated'])
    expect(renamed[1].label).toBe('Renamed')
  })

  it('does not mutate the editor outline while deriving or filtering its hierarchy', () => {
    const headings = Object.freeze(nestedHeadings().map(item => Object.freeze(item)))
    const before = JSON.stringify(headings)
    const entries = tocHelpers.deriveFloatingToc(headings)
    tocHelpers.visibleFloatingToc(entries, new Set(['branch']))
    expect(JSON.stringify(headings)).toBe(before)
  })

  it('hides all descendants while retaining the collapsed heading and following chapters', () => {
    const entries = tocHelpers.deriveFloatingToc(nestedHeadings())
    expect(slugs(tocHelpers.visibleFloatingToc(entries, new Set(['branch'])))).toEqual([
      'root', 'branch', 'sibling', 'last'
    ])
  })

  it('preserves a nested branch collapse when its parent is opened again', () => {
    const entries = tocHelpers.deriveFloatingToc(nestedHeadings())
    const collapsed = new Set(['branch', 'nested'])
    expect(slugs(tocHelpers.visibleFloatingToc(entries, collapsed))).toEqual(['root', 'branch', 'sibling', 'last'])
    collapsed.delete('branch')
    expect(slugs(tocHelpers.visibleFloatingToc(entries, collapsed))).toEqual([
      'root', 'branch', 'nested', 'sibling', 'last'
    ])
    expect(collapsed.has('nested')).toBe(true)
  })

  it('finds the full ancestor chain even when the current heading is hidden in the directory', () => {
    const entries = tocHelpers.deriveFloatingToc(nestedHeadings())
    expect([...tocHelpers.floatingTocAncestors(entries, 'leaf')]).toEqual(['nested', 'branch', 'root'])
    expect(tocHelpers.floatingTocAncestors(entries, null).size).toBe(0)
    expect(tocHelpers.floatingTocAncestors(entries, 'missing').size).toBe(0)
  })

  it('copies all chapters with their indentation, including currently collapsed descendants', () => {
    const entries = tocHelpers.deriveFloatingToc(nestedHeadings())
    expect(tocHelpers.visibleFloatingToc(entries, new Set(['root']))).toHaveLength(2)
    expect(tocHelpers.floatingTocOutline(entries)).toBe(
      'Introduction\n    First chapter\n        Details\n            Example\n    Second chapter\nSummary'
    )
    expect(tocHelpers.floatingTocOutline([])).toBe('')
  })
})

describe('floating directory scroll position', () => {
  it('keeps the first chapter active before reaching a heading and uses the viewport-relative clearance', () => {
    const positions = [{ slug: 'first', top: 180 }, { slug: 'second', top: 500 }]
    expect(tocHelpers.findFloatingTocActive(positions, 80)).toBe('first')
    expect(tocHelpers.findFloatingTocActive(positions, 475)).toBe('second')
    expect(tocHelpers.findFloatingTocActive(positions, 474)).toBe('first')
  })

  it('uses the latest measured positions after paragraphs or images move headings', () => {
    const before = [{ slug: 'first', top: -10 }, { slug: 'second', top: 20 }]
    const after = [{ slug: 'first', top: -10 }, { slug: 'second', top: 320 }]
    expect(tocHelpers.findFloatingTocActive(before, 0)).toBe('second')
    expect(tocHelpers.findFloatingTocActive(after, 0)).toBe('first')
  })

  it('marks the final chapter at the document bottom even if its heading cannot reach the top', () => {
    const positions = [{ slug: 'first', top: -100 }, { slug: 'last', top: 260 }]
    expect(tocHelpers.findFloatingTocActive(positions, 0, false)).toBe('first')
    expect(tocHelpers.findFloatingTocActive(positions, 0, true)).toBe('last')
    expect(tocHelpers.findFloatingTocActive([], 0, true)).toBeNull()
  })

  it('resolves document-relative heading positions without viewport layout reads', () => {
    const positions = [{ slug: 'first', top: 180 }, { slug: 'second', top: 500 }]
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 0)).toBe('first')
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 475)).toBe('second')
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 474)).toBe('first')
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 200, true)).toBe('second')
    expect(tocHelpers.findFloatingTocActiveAtScroll([], 0)).toBeNull()
  })

  it('resolves the active heading from a large cached outline without changing boundary behavior', () => {
    const positions = Array.from({ length: 10000 }, (_, index) => ({ slug: `heading-${index}`, top: index * 120 }))
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 0)).toBe('heading-0')
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 599974)).toBe('heading-4999')
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 1200000)).toBe('heading-9999')
    expect(tocHelpers.findFloatingTocActiveAtScroll(positions, 1200000, true)).toBe('heading-9999')
  })
})

interface SetupModule<T> {
  default: { setup: (props: unknown, context: { expose: () => void }) => T }
}

// The unit runner cannot import Vue SFCs, so execute their actual compiled setup with mocked host boundaries.
const loadSetup = <T>(relativePath: string, dependencies: Record<string, unknown>): SetupModule<T>['default'] => {
  const here = dirname(fileURLToPath(import.meta.url))
  const filename = resolve(here, '../../../src/renderer/src/components/floatingToc', relativePath)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileScript(descriptor, {
    id: 'floating-toc-test',
    fs: { fileExists: existsSync, readFile: path => readFileSync(path, 'utf8') }
  })
  const script = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function('require', 'exports', 'module', `${script}\nreturn module.exports`) as (
    require: (id: string) => unknown, exports: object, module: object
  ) => SetupModule<T>
  const module = { exports: {} }
  return factory(id => {
    if (!(id in dependencies)) throw new Error(`Unexpected floating directory dependency: ${id}`)
    return dependencies[id]
  }, module.exports, module).default
}

interface ToggleBindings {
  floatingTocEnabled: Vue.Ref<boolean>
  toggle: () => void
}

interface PanelBindings {
  collapsed: Vue.Ref<Set<string>>
  activeSlug: Vue.Ref<string | null>
  parentSlug: Vue.ComputedRef<string | null>
  grandparentSlug: Vue.ComputedRef<string | null>
  hovered: Vue.Ref<boolean>
  expanded: Vue.ComputedRef<boolean>
  visibleEntries: Vue.ComputedRef<FloatingTocEntry[]>
  copied: Vue.Ref<boolean>
  toggleBranch: (slug: string) => void
  expandAll: () => void
  collapseAll: () => void
  navigate: (slug: string) => void
  togglePin: () => void
  copyOutline: () => void
}

const scopes: Vue.EffectScope[] = []
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const bootControls = (enabled = false) => {
  const preferences = Vue.reactive({ floatingTocEnabled: enabled, floatingTocPinned: false, sourceCode: false })
  const editor = Vue.reactive({
    listToc: nestedHeadings(),
    currentFile: { id: 'note-a', markdown: '# Introduction\n\nOriginal content.', isSaved: true }
  })
  const save = vi.fn(({ type, value }: { type: 'floatingTocEnabled' | 'floatingTocPinned'; value: boolean }) => {
    preferences[type] = value
  })
  const emit = vi.fn()
  const copy = vi.fn()
  vi.stubGlobal('electron', { clipboard: { writeText: copy } })
  const preferencesStore = { ...Vue.toRefs(preferences), SET_SINGLE_PREFERENCE: save }
  const dependencies = {
    vue: { ...Vue, onMounted: () => {}, onBeforeUnmount: (cleanup: () => void) => { cleanups.push(cleanup) } },
    pinia: { storeToRefs: (store: unknown) => store === preferencesStore ? Vue.toRefs(preferences) : Vue.toRefs(editor) },
    'vue-i18n': { useI18n: () => ({ t: (key: string) => key }) },
    '@/store/preferences': { usePreferencesStore: () => preferencesStore },
    '@/store/editor': { useEditorStore: () => editor },
    '@/bus': { __esModule: true, default: { emit } },
    '@/util/tocNavigation': tocNavigation,
    '@/util/sourceModeToc': sourceModeToc,
    '@/util/floatingToc': tocHelpers,
    '@/util/floatingTocLabel': tocLabels
  }
  const scope = Vue.effectScope()
  scopes.push(scope)
  const toggle = scope.run(() => loadSetup<ToggleBindings>('toggle.vue', dependencies).setup({}, { expose: () => {} }))
  const panel = scope.run(() => loadSetup<PanelBindings>('index.vue', dependencies).setup({}, { expose: () => {} }))
  if (!toggle || !panel) throw new Error('Floating directory controls did not initialize')
  return { toggle, panel, preferences, editor, save, emit, copy }
}

describe('floating directory controls', () => {
  it('tracks only the real parent and grandparent as the current heading changes', () => {
    const { panel, editor } = bootControls(true)
    editor.listToc = Array.from({ length: 6 }, (_, index) => heading(`h${index + 1}`, index + 1))
    panel.activeSlug.value = 'h6'
    expect(panel.parentSlug.value).toBe('h5')
    expect(panel.grandparentSlug.value).toBe('h4')
    panel.activeSlug.value = 'h4'
    expect(panel.parentSlug.value).toBe('h3')
    expect(panel.grandparentSlug.value).toBe('h2')
    panel.activeSlug.value = 'h1'
    expect(panel.parentSlug.value).toBeNull()
    expect(panel.grandparentSlug.value).toBeNull()
    panel.activeSlug.value = 'missing'
    expect(panel.parentSlug.value).toBeNull()
    expect(panel.grandparentSlug.value).toBeNull()
  })

  it('uses existing ancestor relationships when heading levels are skipped or removed', async() => {
    const { panel, editor } = bootControls(true)
    editor.listToc = [heading('h1', 1), heading('h3', 3), heading('h6', 6)]
    panel.activeSlug.value = 'h6'
    expect(panel.parentSlug.value).toBe('h3')
    expect(panel.grandparentSlug.value).toBe('h1')
    editor.listToc = [heading('h6', 6)]
    await Vue.nextTick()
    expect(panel.parentSlug.value).toBeNull()
    expect(panel.grandparentSlug.value).toBeNull()
  })

  it('reads saved settings without writing any preference or document content on opening', () => {
    const { toggle, preferences, editor, save, emit, copy } = bootControls(true)
    expect(toggle.floatingTocEnabled.value).toBe(true)
    expect(preferences.floatingTocEnabled).toBe(true)
    expect(editor.currentFile.isSaved).toBe(true)
    expect(save).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
  })

  it('saves each switch change through the correct preference and follows broadcasts without resaving', async() => {
    const { toggle, preferences, save } = bootControls()
    toggle.toggle()
    expect(save).toHaveBeenLastCalledWith({ type: 'floatingTocEnabled', value: true })
    toggle.toggle()
    expect(save).toHaveBeenLastCalledWith({ type: 'floatingTocEnabled', value: false })
    preferences.floatingTocEnabled = true
    await Vue.nextTick()
    expect(toggle.floatingTocEnabled.value).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('pins independently of hover and preserves both the document and its saved state', () => {
    const { panel, editor, preferences, save } = bootControls(true)
    const before = JSON.stringify(editor.currentFile)
    panel.hovered.value = true
    expect(panel.expanded.value).toBe(true)
    panel.togglePin()
    expect(save).toHaveBeenCalledExactlyOnceWith({ type: 'floatingTocPinned', value: true })
    panel.hovered.value = false
    expect(panel.expanded.value).toBe(true)
    panel.togglePin()
    expect(preferences.floatingTocPinned).toBe(false)
    expect(panel.expanded.value).toBe(false)
    expect(JSON.stringify(editor.currentFile)).toBe(before)
  })

  it('folds directory branches and navigates using stable slugs without editing the note', () => {
    const { panel, editor, save, emit } = bootControls(true)
    const before = JSON.stringify(editor.currentFile)
    panel.toggleBranch('nested')
    panel.toggleBranch('branch')
    panel.toggleBranch('branch')
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'branch', 'nested', 'sibling', 'last'])
    panel.navigate('sibling')
    expect(emit).toHaveBeenCalledExactlyOnceWith('scroll-to-header', 'sibling')
    expect(save).not.toHaveBeenCalled()
    expect(JSON.stringify(editor.currentFile)).toBe(before)
  })

  it('copies the whole outline without revealing collapsed branches or changing document content', () => {
    vi.useFakeTimers()
    const { panel, editor, save, copy } = bootControls(true)
    const before = JSON.stringify(editor.currentFile)
    panel.toggleBranch('root')
    panel.copyOutline()
    expect(copy).toHaveBeenCalledExactlyOnceWith(
      'Introduction\n    First chapter\n        Details\n            Example\n    Second chapter\nSummary'
    )
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'last'])
    expect(panel.copied.value).toBe(true)
    vi.advanceTimersByTime(1500)
    expect(panel.copied.value).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(JSON.stringify(editor.currentFile)).toBe(before)
  })

  it('collapses every branch in the actual panel setup while leaving only document-level entries visible', () => {
    const { panel } = bootControls(true)
    panel.collapseAll()
    expect([...panel.collapsed.value]).toEqual(['root', 'branch', 'nested'])
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'last'])
    panel.toggleBranch('root')
    expect([...panel.collapsed.value]).toEqual(['branch', 'nested'])
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'branch', 'sibling', 'last'])
    panel.toggleBranch('branch')
    expect(panel.collapsed.value.has('nested')).toBe(true)
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'branch', 'nested', 'sibling', 'last'])
  })

  it('expands all headings and clears every nested collapse after mixed branch operations', () => {
    const { panel } = bootControls(true)
    panel.toggleBranch('nested')
    panel.collapseAll()
    panel.toggleBranch('root')
    panel.expandAll()
    expect(panel.collapsed.value.size).toBe(0)
    expect(slugs(panel.visibleEntries.value)).toEqual(nestedHeadings().map(entry => entry.slug))
    panel.expandAll()
    expect(panel.collapsed.value.size).toBe(0)
    expect(slugs(panel.visibleEntries.value)).toEqual(nestedHeadings().map(entry => entry.slug))
  })

  it('keeps the full copy, saved content and live editor caret unchanged during bulk folding', () => {
    vi.useFakeTimers()
    const { panel, editor, save, emit, copy } = bootControls(true)
    const paragraph = document.createElement('p')
    paragraph.tabIndex = 0
    paragraph.textContent = 'Original editor text'
    document.body.appendChild(paragraph)
    paragraph.focus()
    const text = paragraph.firstChild!
    const selection = window.getSelection()!
    const range = document.createRange()
    range.setStart(text, 3)
    range.setEnd(text, 8)
    selection.removeAllRanges()
    selection.addRange(range)
    cleanups.push(() => { selection.removeAllRanges(); paragraph.remove() })
    const before = JSON.stringify(editor.currentFile)
    const outlineBefore = JSON.stringify(editor.listToc)

    panel.collapseAll()
    panel.copyOutline()
    expect(copy).toHaveBeenCalledExactlyOnceWith(
      'Introduction\n    First chapter\n        Details\n            Example\n    Second chapter\nSummary'
    )
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'last'])
    panel.expandAll()
    panel.collapseAll()

    expect(JSON.stringify(editor.currentFile)).toBe(before)
    expect(editor.currentFile.isSaved).toBe(true)
    expect(JSON.stringify(editor.listToc)).toBe(outlineBefore)
    expect(save).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(paragraph)
    expect(selection.anchorNode).toBe(text)
    expect(selection.anchorOffset).toBe(3)
    expect(selection.focusNode).toBe(text)
    expect(selection.focusOffset).toBe(8)
    expect(selection.toString()).toBe('ginal')
  })

  it('recomputes bulk branch membership after live headings are added or replaced', async() => {
    const { panel, editor } = bootControls(true)
    panel.collapseAll()
    editor.listToc = [
      ...nestedHeadings(), heading('new-root', 1), heading('new-branch', 2), heading('new-leaf', 3)
    ]
    await Vue.nextTick()
    panel.collapseAll()
    expect([...panel.collapsed.value]).toEqual(['root', 'branch', 'nested', 'new-root', 'new-branch'])
    expect(slugs(panel.visibleEntries.value)).toEqual(['root', 'last', 'new-root'])
    panel.expandAll()
    expect(slugs(panel.visibleEntries.value)).toEqual(editor.listToc.map(entry => entry.slug))

    editor.listToc = [heading('replacement', 2), heading('replacement-deep', 5)]
    await Vue.nextTick()
    panel.collapseAll()
    expect([...panel.collapsed.value]).toEqual(['replacement'])
    expect(slugs(panel.visibleEntries.value)).toEqual(['replacement'])
    panel.expandAll()
    expect(slugs(panel.visibleEntries.value)).toEqual(['replacement', 'replacement-deep'])
  })
})
