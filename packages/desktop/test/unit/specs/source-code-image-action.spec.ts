import { afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { markRaw, ref, shallowRef } from 'vue'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { buildSourceToc, findMarkdownHeadingLine, scrollSourceEditorToLine } from '@/util/sourceModeToc'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: { clipboard: { writeText: (text: string) => void }; ipcRenderer: { send: (...args: unknown[]) => void; on: (...args: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: value => value }
  w.window.electron ??= { clipboard: { writeText: () => {} }, ipcRenderer: { send: () => {}, on: () => {} } }
})
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/i18n', () => ({ setLanguage: vi.fn(), t: (key: string) => key }))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

afterEach(() => vi.restoreAllMocks())

// `handleImageAction` lives as a <script setup> closure in sourceCode.vue
// (registered on the `image-action` bus during onMounted). The desktop unit
// runner ships no @vitejs/plugin-vue and no @vue/test-utils, so the SFC cannot
// be imported or mounted directly. Instead, compile the *real* source at
// runtime, swap its imports for injected stubs, and run setup() to grab the
// closure off the dev-mode `__returned__` bindings. This drives the actual
// product algorithm and re-reads the file every run, so it cannot drift.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/editorWithTabs/sourceCode.vue')

interface CMCursor {
  line: number
  ch: number
}

interface SetupBindings {
  editor: { value: unknown }
  handleImageAction: (payload: unknown) => void
  saveContent: (editor: unknown) => void
  tabId: { value: string | null }
  viewDestroyed: { value: boolean }
}

interface SetupModule {
  default: { setup: (props: unknown, ctx: { expose: () => void }) => SetupBindings }
}

const loadComponent = (deps: Record<string, unknown>) => {
  const src = readFileSync(vuePath, 'utf8')
  const { descriptor } = parse(src)
  const compiled = compileScript(descriptor, { id: 'test' })
  // Drop every import; bindings come from the injected `__deps` object so the
  // store/codeMirror/muya/config modules never load.
  const noImports = compiled.content
    .split('\n')
    .filter((l) => !/^\s*import\s/.test(l))
    .join('\n')
  // esbuild's transformSync trips over jsdom's TextEncoder realm, so transpile
  // the TS away with the (pure-JS) typescript compiler.
  const js = ts.transpileModule(noImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // Running the compiled setup needs the Function constructor; there is no
  // module loader to hand it the swapped-in dependency object otherwise.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, ref, shallowRef, markRaw, watch, onMounted, onBeforeUnmount, nextTick,
      useEditorStore, usePreferencesStore, storeToRefs, codeMirror,
      setCursorAtFirstLine, setTextDirection, getWordCount, adjustCursor, bus,
      oneDarkThemes, railscastsThemes, buildSourceToc, findMarkdownHeadingLine, scrollSourceEditorToLine,
      setPluginEditor, publishPluginSnapshot, offsetToIndex } = __deps
    ${js}
    return module.exports`
  ) as (deps: Record<string, unknown>, exports: object, module: object) => SetupModule
  const m = { exports: {} as Record<string, unknown> }
  const exported = factory(deps, m.exports, m)
  return exported.default
}

const makeDeps = (over: Record<string, unknown> = {}) => ({
  _defineComponent: (o: unknown) => o,
  setPluginEditor: vi.fn(() => () => {}),
  publishPluginSnapshot: vi.fn(),
  offsetToIndex: vi.fn(),
  ref,
  shallowRef,
  markRaw,
  watch: () => {},
  onMounted: () => {},
  onBeforeUnmount: () => {},
  nextTick: () => Promise.resolve(),
  useEditorStore: () => ({ listToc: [], UPDATE_TOC: () => {}, LISTEN_FOR_CONTENT_CHANGE: () => {} }),
  usePreferencesStore: () => ({}),
  storeToRefs: () => ({ theme: ref(''), sourceCode: ref(true), currentFile: ref(null) }),
  codeMirror: () => ({}),
  setCursorAtFirstLine: vi.fn(),
  setTextDirection: () => {},
  getWordCount: () => 0,
  adjustCursor: (c: unknown) => c,
  bus: { on: () => {}, off: () => {}, emit: () => {} },
  oneDarkThemes: [],
  railscastsThemes: [],
  buildSourceToc,
  findMarkdownHeadingLine,
  scrollSourceEditorToLine,
  ...over
})

describe('sourceCode live outline and dirty state', () => {
  const bootSource = (markdown: string) => {
    setActivePinia(createPinia())
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.sourceCode = true
    const tab = {
      id: 'source-tab',
      filename: 'source.md',
      pathname: '/test/source.md',
      markdown,
      trimTrailingNewline: 0,
      isSaved: true,
      lastSavedHistoryId: 7,
      history: { stack: [{ id: 7 }], lastEditIndex: 0, lastInitIndex: -1 }
    }
    store.tabs = [tab] as unknown as typeof store.tabs
    store.currentFile = store.tabs[0]
    store.tabIdToIndex = { 'source-tab': 0 }
    store.UPDATE_TOC(buildSourceToc(markdown).map((heading, index) => ({ ...heading, slug: `engine-${index}` })))
    const contentChange = vi.spyOn(store, 'LISTEN_FOR_CONTENT_CHANGE')
    const build = vi.fn(buildSourceToc)
    const cm = Object.assign(makeCM(markdown, { line: 0, ch: 0 }, { line: 0, ch: 0 }), {
      getLine: (line: number): string | undefined => cm.getValue().split('\n')[line],
      lineCount: (): number => cm.getValue().split('\n').length,
      getSelection: () => '',
      listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
      setOption: vi.fn(),
      on: vi.fn()
    })
    const mounts: Array<() => void> = []
    const watches: Array<{ sources: unknown; callback: () => void }> = []
    const component = loadComponent(makeDeps({
      useEditorStore: () => store,
      usePreferencesStore: () => preferences,
      storeToRefs,
      buildSourceToc: build,
      codeMirror: () => cm,
      onMounted: (callback: () => void) => mounts.push(callback),
      watch: (sources: unknown, callback: () => void) => watches.push({ sources, callback })
    }))
    const bindings = component.setup({ markdown, muyaIndexCursor: null, textDirection: 'ltr' }, { expose: () => {} })
    mounts.forEach(mount => mount())
    return { store, preferences, contentChange, build, cm, bindings, watches }
  }

  it('initializes the outline without making a saved document dirty or writing editor history', () => {
    const { store, contentChange, build } = bootSource('# Saved\n\n## Second')
    expect(store.listToc.map(entry => entry.content)).toEqual(['Saved', 'Second'])
    expect(store.listToc.map(entry => entry.slug)).toEqual(['engine-0', 'engine-1'])
    expect(store.currentFile?.isSaved).toBe(true)
    expect(store.currentFile?.history.stack).toEqual([{ id: 7 }])
    expect(contentChange).not.toHaveBeenCalled()
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('updates renamed and added source headings immediately while preserving identities and avoiding cursor reparses', () => {
    const { store, contentChange, build, cm, bindings } = bootSource('# Old\n\n## Other')
    cm.setValue('# Renamed\n\n## Renamed\n\n### Added')
    bindings.saveContent(cm)
    expect(store.listToc.map(entry => entry.content)).toEqual(['Renamed', 'Renamed', 'Added'])
    expect(store.listToc[0].slug).toBe('engine-0')
    expect(store.listToc[1].slug).toBe('engine-1')
    expect(store.listToc[2].slug).toMatch(/^source-heading-\d+$/)
    expect(store.currentFile?.isSaved).toBe(false)
    expect(store.currentFile?.history.stack).toEqual([{ id: 7 }])
    expect(build).toHaveBeenCalledTimes(2)
    bindings.saveContent(cm)
    expect(build).toHaveBeenCalledTimes(2)
    expect(contentChange.mock.calls.at(-1)?.[0].toc).toBeUndefined()
  })

  it('rebuilds the source outline for changed math preferences without changing Markdown or dirty state', () => {
    const markdown = '# First\n\n$$\n# Inside\n$$\n\n# Last'
    const { store, preferences, build, bindings, cm, watches } = bootSource(markdown)
    expect(store.listToc.map(entry => entry.content)).toEqual(['First', 'Last'])
    preferences.texMathDollars = false
    const optionsWatch = watches.find(entry => Array.isArray(entry.sources) && entry.sources.length === 6)
    expect(optionsWatch).toBeDefined()
    optionsWatch!.callback()
    expect(store.listToc.map(entry => entry.content)).toEqual(['First', 'Inside', 'Last'])
    expect(store.currentFile?.markdown).toBe(markdown)
    expect(store.currentFile?.isSaved).toBe(true)
    expect(store.currentFile?.history.stack).toEqual([{ id: 7 }])
    expect(build).toHaveBeenCalledTimes(2)
    bindings.saveContent(cm)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('keeps late source events after unmount from parsing or committing an outline', () => {
    const { store, contentChange, build, bindings, cm } = bootSource('# Saved')
    bindings.viewDestroyed.value = true
    cm.setValue('# Too late')
    bindings.saveContent(cm)
    expect(contentChange).not.toHaveBeenCalled()
    expect(build).toHaveBeenCalledTimes(1)
    expect(store.currentFile?.markdown).toBe('# Saved')
    expect(store.currentFile?.isSaved).toBe(true)
  })
})

interface StubCM {
  getValue: () => string
  setValue: (v: string) => void
  getCursor: (which: string) => CMCursor | null
  setSelection: ReturnType<typeof vi.fn>
}

const makeCM = (value: string, focus: CMCursor | null, anchor: CMCursor | null): StubCM => {
  let current = value
  return {
    getValue: () => current,
    setValue: (v: string) => {
      current = v
    },
    getCursor: (which: string) => (which === 'focus' ? focus : anchor),
    setSelection: vi.fn()
  }
}

const bootHandler = (cm: StubCM, deps: Record<string, unknown> = makeDeps()) => {
  const comp = loadComponent(deps)
  const ret = comp.setup(
    { markdown: '', muyaIndexCursor: null, textDirection: 'ltr' },
    { expose: () => {} }
  )
  ret.editor.value = cm
  return ret.handleImageAction
}

describe('sourceCode handleImageAction', () => {
  it('rewrites ![id](old) to ![alt](result) on the matched line', () => {
    const cm = makeCM('![abc123](old.png) tail', { line: 0, ch: 0 }, { line: 0, ch: 0 })
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('![cat](new.png) tail')
  })

  it('rewrites only the line carrying the id, leaving siblings intact', () => {
    const cm = makeCM(
      'before\n![abc123](old.png)\nafter',
      { line: 0, ch: 0 },
      { line: 0, ch: 0 }
    )
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('before\n![cat](new.png)\nafter')
  })

  it('shifts a cursor sitting after the image by the length delta', () => {
    // ![abc123](old.png) is 18 chars; ![cat](new.png) is 15 -> delta -3.
    const focus = { line: 0, ch: 20 }
    const anchor = { line: 0, ch: 20 }
    const cm = makeCM('![abc123](old.png) tail', focus, anchor)
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(focus.ch).toBe(17)
    expect(anchor.ch).toBe(17)
    expect(cm.setSelection).toHaveBeenCalledWith(anchor, focus, { scroll: true })
  })

  it('clamps a cursor inside the old image to the end of the new image text', () => {
    // New image text length = alt(3) + result(7) + 5 = 15.
    const focus = { line: 0, ch: 5 }
    const anchor = { line: 0, ch: 5 }
    const cm = makeCM('![abc123](old.png)', focus, anchor)
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(focus.ch).toBe(15)
    expect(anchor.ch).toBe(15)
  })

  it('leaves a cursor at or before the image start untouched', () => {
    const focus = { line: 0, ch: 0 }
    const anchor = { line: 0, ch: 0 }
    const cm = makeCM('![abc123](old.png) tail', focus, anchor)
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(focus.ch).toBe(0)
    expect(anchor.ch).toBe(0)
  })

  it('only adjusts pointers that sit on the rewritten line', () => {
    const focus = { line: 1, ch: 4 }
    const anchor = { line: 1, ch: 4 }
    const cm = makeCM('![abc123](old.png)\nplain text line', focus, anchor)
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    // Image is on line 0; line-1 pointers are off the edited line, so untouched.
    expect(focus.ch).toBe(4)
    expect(anchor.ch).toBe(4)
  })

  it('does nothing when the id is absent from every line', () => {
    const deps = makeDeps()
    const cm = makeCM('no images here', { line: 0, ch: 3 }, { line: 0, ch: 3 })
    bootHandler(cm, deps)({ id: 'zzz', result: 'r.png', alt: 'x' })
    expect(cm.getValue()).toBe('no images here')
    expect(cm.setSelection).not.toHaveBeenCalled()
    expect((deps.setCursorAtFirstLine as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('early-returns on the structure-deleted branch (id present, no image markup)', () => {
    // The id still appears (indexOf > 0) but the ![..](..) was deleted, so the
    // broad image regex finds no match -> early return, no selection change.
    const deps = makeDeps()
    const cm = makeCM('see abc123 ref', { line: 0, ch: 10 }, { line: 0, ch: 10 })
    bootHandler(cm, deps)({ id: 'abc123', result: 'r.png', alt: 'x' })
    expect(cm.getValue()).toBe('see abc123 ref')
    expect(cm.setSelection).not.toHaveBeenCalled()
    expect((deps.setCursorAtFirstLine as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('skips an image whose id starts at column 0 (indexOf > 0 quirk)', () => {
    // findIndex uses `line.indexOf(id) > 0` (strict), so a line that begins
    // with the id renders no rewrite. Pinning the off-by-one rather than fixing.
    const cm = makeCM('abc123](old.png)', { line: 0, ch: 0 }, { line: 0, ch: 0 })
    bootHandler(cm)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('abc123](old.png)')
  })

  it('falls back to setCursorAtFirstLine when a pointer is null after a rewrite', () => {
    const deps = makeDeps()
    const cm = makeCM('![abc123](old.png)', { line: 0, ch: 5 }, null)
    bootHandler(cm, deps)({ id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('![cat](new.png)')
    expect(cm.setSelection).not.toHaveBeenCalled()
    expect((deps.setCursorAtFirstLine as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })
})
