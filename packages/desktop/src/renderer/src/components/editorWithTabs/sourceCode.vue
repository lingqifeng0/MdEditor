<template>
  <div
    ref="sourceCodeContainer"
    class="source-code"
    @paste.capture="handleImagePaste"
  />
</template>

<script setup lang="ts">
import { ref, shallowRef, markRaw, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { buildSourceToc, findMarkdownHeadingLine, scrollSourceEditorToLine } from '@/util/sourceModeToc'
import { storeToRefs } from 'pinia'
import type CodeMirror from 'codemirror'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import { HistoryViewport, wordCount as getWordCount } from '@muyajs/core'
import { adjustCursor } from '../../util'
import { storeNoteImage } from '@/util/noteImageStorage'
import { releaseNoteImages } from '@/util/noteImageDrafts'
import { prepareImageDirectory } from '@/util/noteImageDirectoryWorkflow'
import notice from '@/services/notification'
import { t } from '@/i18n'
import bus from '../../bus'
import { setPluginEditor, publishPluginSnapshot, offsetToIndex } from '@/plugins/runtime'
import { oneDarkThemes, railscastsThemes } from '@/config'

interface MuyaIndexCursorLike {
  anchor: CodeMirror.Position
  focus: CodeMirror.Position
}

const props = defineProps<{
  markdown?: string
  muyaIndexCursor?: unknown
  textDirection: string
}>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const sourceCodeContainer = ref<HTMLDivElement | null>(null)

const editor = shallowRef<CodeMirror.Editor | null>(null)
const commitTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const viewDestroyed = ref(false)
let historyViewport: HistoryViewport | null = null
let disposePluginEditor: (() => void) | undefined
const tabId = ref<string | null>(null)

const {
  theme,
  sourceCode,
  sourceCodeLineNumbers,
  texMathDollars,
  texMathGfm,
  texMathSingleBackslash,
  texMathDoubleBackslash
} = storeToRefs(preferencesStore)
const { currentFile: currentTab } = storeToRefs(editorStore)
let lastTocMarkdown: string | null = null
let lastTocTabId: string | null = null
let lastTocOptions: string | null = null

const sourceTocOptions = () => ({
  footnote: preferencesStore.footnote,
  texMathDollars: preferencesStore.texMathDollars,
  texMathGfm: preferencesStore.texMathGfm,
  texMathSingleBackslash: preferencesStore.texMathSingleBackslash,
  texMathDoubleBackslash: preferencesStore.texMathDoubleBackslash,
  superSubScript: preferencesStore.superSubScript,
  frontMatter: true
})

const isValidMuyaIndexCursor = (cursor: unknown): cursor is MuyaIndexCursorLike => {
  const c = cursor as MuyaIndexCursorLike | null | undefined
  return !!(c && c.anchor && c.focus)
}

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      setTextDirection(editor.value, value)
    }
  }
)

watch(sourceCodeLineNumbers, (value) => {
  editor.value?.setOption('lineNumbers', value)
})

// A fresh instance reads these at mount; the watch is for a preference changed
// while the source view is already open (#5446).
const markdownMathMode = () => ({
  name: 'markdown-math',
  texMathDollars: texMathDollars.value,
  texMathGfm: texMathGfm.value,
  texMathSingleBackslash: texMathSingleBackslash.value,
  texMathDoubleBackslash: texMathDoubleBackslash.value
})

watch([texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash], () => {
  editor.value?.setOption('mode', markdownMathMode())
})

const getMarkdownAndCursor = (cm: CodeMirror.Editor) => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')

  const markdown: string = cm.getValue()
  const convertToMuyaCursor = (cursor: CodeMirror.Position) => {
    const line = cm.getLine(cursor.line)
    const preLine = cm.getLine(cursor.line - 1)
    const nextLine = cm.getLine(cursor.line + 1)
    return adjustCursor(
      cursor,
      preLine,
      line,
      nextLine,
      (lineNumber) => {
        return cm.getLine(lineNumber)
      },
      cm.lineCount()
    )
  }

  anchor = convertToMuyaCursor(anchor) // Selection start as Muya cursor
  focus = convertToMuyaCursor(focus) // Selection end as Muya cursor

  // Normalize cursor that `anchor` is always before `focus` because
  // this is the expected behavior in Muya.
  if (anchor && focus && anchor.line > focus.line) {
    const tmpCursor = focus
    focus = anchor
    anchor = tmpCursor
  }
  return { cursor: { focus, anchor }, markdown }
}

/**
 * This is to write the OLD content of the editor before switching to another tab
 * @param id
 */
const prepareTabSwitch = () => {
  if (commitTimer.value) clearTimeout(commitTimer.value)
  if (tabId.value && editor.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    editorStore.LISTEN_FOR_CONTENT_CHANGE({
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor
    })
    tabId.value = null
  }
}

interface FileChangePayloadLike {
  id: string
  markdown?: string
  muyaIndexCursor?: unknown
}

const handleFileChange = (payload: unknown) => {
  const { id, markdown: newMarkdown, muyaIndexCursor } = payload as FileChangePayloadLike
  if (!editor.value) return

  // On same-tab reload (external file change), preserve scroll across
  // setValue. Snapshot every plausible scroll element (the outer
  // .source-code div, CodeMirror's own scroller, and the nearest scrollable
  // ancestor) and restore each, since which one is actually active depends
  // on CodeMirror's height:auto + outer overflow:auto interplay. Re-apply
  // on nextTick and the next animation frame to outlast layout side-effects
  // from sibling handlers: muya editor.vue also listens for file-changed.
  // A cross-tab switch must instead commit the outgoing tab's state; the
  // fresh markdown from disk would otherwise overwrite uncommitted edits.
  const isSameTabReload = tabId.value && tabId.value === id
  const scrollTargets: Array<{ el: HTMLElement; top: number }> = []
  if (isSameTabReload) {
    const seen = new Set<HTMLElement>()
    const consider = (el: HTMLElement | null | undefined) => {
      if (el && !seen.has(el)) {
        seen.add(el)
        scrollTargets.push({ el, top: el.scrollTop })
      }
    }
    consider(sourceCodeContainer.value)
    consider(editor.value.getScrollerElement?.() as HTMLElement | null | undefined)
    let node: HTMLElement | null = sourceCodeContainer.value?.parentElement ?? null
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        consider(node)
        break
      }
      node = node.parentElement
    }
  } else {
    prepareTabSwitch()
    tabId.value = id

  }

  if (typeof newMarkdown === 'string') {
    editor.value.setValue(newMarkdown)
  }

  // t('editor.sourceCode.cursorNullComment')
  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor

    editor.value.setSelection(anchor, focus, { scroll: true }) // Scroll the focus into view.
  } else if (scrollTargets.length) {
    const restoreScroll = () => {
      for (const { el, top } of scrollTargets) el.scrollTop = top
    }
    restoreScroll()
    nextTick(restoreScroll)
    requestAnimationFrame(restoreScroll)
  } else {
    setCursorAtFirstLine(editor.value)
  }
}

const handleSelectAll = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.execCommand('selectAll')
  } else {
    const activeElement = document.activeElement as HTMLElement | null
    const nodeName = activeElement?.nodeName
    if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
      const selectable = activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (selectable && typeof selectable.select === 'function') {
        selectable.select()
      }
    }
  }
}

const changeSourceHistory = (command: 'undo' | 'redo') => {
  const cm = editor.value
  if (!sourceCode.value || !cm) return
  historyViewport?.cancel()
  const viewport = new HistoryViewport(cm.getScrollerElement(), () => { historyViewport = null })
  historyViewport = viewport
  try {
    cm.execCommand(command)
  } finally {
    viewport.settle()
  }
}

const handleUndo = () => changeSourceHistory('undo')

const handleRedo = () => changeSourceHistory('redo')

interface ImageActionPayload {
  id: string
  result: string
  alt: string
}

const handleImageAction = (payload: unknown) => {
  const cm = editor.value
  if (!cm) return

  const { id, result, alt } = payload as ImageActionPayload
  const value: string = cm.getValue()
  const focus = cm.getCursor('focus')
  const anchor = cm.getCursor('anchor')
  const lines: string[] = value.split('\n')
  const index = lines.findIndex((line: string) => line.indexOf(id) > 0)

  if (index > -1) {
    const oldLine = lines[index]
    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
    const newValue = lines.join('\n')
    cm.setValue(newValue)
    const match = /(!\[.*\]\(.*\))/.exec(oldLine)
    if (!match) {
      // t('editor.sourceCode.imageStructureDeletedComment')
      return
    }
    const range = {
      start: match.index,
      end: match.index + match[1].length
    }
    const delta = alt.length + result.length + 5 - match[1].length

    const adjustPointer = (pointer: CodeMirror.Position) => {
      if (!pointer) {
        return
      }
      if (pointer.line !== index) {
        return
      }
      if (pointer.ch <= range.start) {
        // do nothing.
      } else if (pointer.ch > range.start && pointer.ch < range.end) {
        pointer.ch = range.start + alt.length + result.length + 5
      } else {
        pointer.ch += delta
      }
    }

    adjustPointer(focus)
    adjustPointer(anchor)
    if (focus && anchor) {
      cm.setSelection(anchor, focus, { scroll: true })
    } else {
      setCursorAtFirstLine(cm)
    }
  }
}

// `cursorActivity` fires per drag step, so key the dedup on the ranges rather
// than on `getSelection()`, which copies the whole selection.
let lastSelectionKey = ''

const selectionKey = (cm: CodeMirror.Editor): string =>
  cm
    .listSelections()
    .map(({ anchor, head }) => `${anchor.line}:${anchor.ch}-${head.line}:${head.ch}`)
    .join(',')

const updateSelectionWordCount = (cm: CodeMirror.Editor) => {
  const key = selectionKey(cm)
  if (key === lastSelectionKey && editorStore.selectionWordCount != null) return
  lastSelectionKey = key

  const selectedText = cm.getSelection()
  const hasSelection = selectedText.trim().length > 0
  if (!hasSelection && editorStore.selectionWordCount == null) return

  editorStore.SET_SELECTION_WORD_COUNT(hasSelection ? getWordCount(selectedText) : null)
}

const saveContent = (cm: CodeMirror.Editor) => {
  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(cm)
  // Attention: the cursor may be `{focus: null, anchor: null}` when press `backspace`
  const wordCount = getWordCount(newMarkdown)
  // See "beforeDestroy" note
  if (!viewDestroyed.value) {
    if (tabId.value) {
      const options = sourceTocOptions()
      const settings = JSON.stringify(options)
      const toc = lastTocMarkdown !== newMarkdown || lastTocTabId !== tabId.value || lastTocOptions !== settings
        ? buildSourceToc(newMarkdown, lastTocTabId === tabId.value ? editorStore.listToc : [], options)
        : undefined
      lastTocMarkdown = newMarkdown
      lastTocTabId = tabId.value
      lastTocOptions = settings
      editorStore.LISTEN_FOR_CONTENT_CHANGE({
        id: tabId.value,
        markdown: newMarkdown,
        wordCount,
        muyaIndexCursor: cursor,
        toc
      })
    } else {
      // This may occur during tab switching but should not occur otherwise.
      console.warn('LISTEN_FOR_CONTENT_CHANGE: Cannot commit changes because not tab id was set!')
    }
  }
}

watch([
  () => preferencesStore.footnote,
  () => preferencesStore.texMathDollars,
  () => preferencesStore.texMathGfm,
  () => preferencesStore.texMathSingleBackslash,
  () => preferencesStore.texMathDoubleBackslash,
  () => preferencesStore.superSubScript
], () => {
  if (editor.value && tabId.value && !viewDestroyed.value) saveContent(editor.value)
})

const listenChange = (cm: CodeMirror.Editor) => {
  cm.on('changes', saveContent)
  cm.on('cursorActivity', (instance: CodeMirror.Editor) => {
    saveContent(instance)
    updateSelectionWordCount(instance)
  })
}

const flushSourceEditor = () => {
  if (editor.value) saveContent(editor.value)
}

const handleImagePaste = async (event: ClipboardEvent): Promise<void> => {
  const cm = editor.value
  if (!cm || !preferencesStore.imageStrictRelativeDirectory) return
  const file = [...(event.clipboardData?.files ?? [])].find(file => file.type.startsWith('image/'))
  const text = event.clipboardData?.getData('text/plain').trim() ?? ''
  const path = /^(?:file:|[a-z]:[\\/]|\\\\|\/).*\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(text) ? text : ''
  if (!file && !path) return
  event.preventDefault()
  event.stopPropagation()
  const note = editorStore.currentFile
  const original = cm.getValue()
  const ranges = cm.listSelections()
  if (!note) return
  const result = await storeNoteImage(file ?? path, note.pathname ?? '', preferencesStore.imageRelativeDirectoryName, problem => prepareImageDirectory(problem, note.id), note.id)
  if (viewDestroyed.value || editor.value !== cm || editorStore.currentFile?.id !== note?.id || cm.getValue() !== original) {
    if (result.ok) await releaseNoteImages([note.id], editorStore.tabs, { id: note.id, pathname: result.pathname, sources: [result.src] })
    return
  }
  if (!result.ok) {
    if (result.errorCode === 'cancelled') return
    notice.notify({ title: t('preferences.image.folderSetting.strictMode'), type: 'warning', message: t(`imageStorage.${result.errorCode}`, { name: 'stem' in result ? result.stem : '' }) })
    return
  }
  const src = result.src.replace(/\\/g, '/').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/#/g, '%23')
  const viewport = sourceCodeContainer.value
  const top = viewport?.scrollTop ?? 0
  cm.setSelections(ranges, undefined, { scroll: false })
  cm.replaceSelection(`![](${src})`, 'end', '+input')
  if (viewport) viewport.scrollTop = top
}

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
const handleScrollToHeader = (slug: unknown) => {
  if (!editor.value) return
  const index = editorStore.listToc.findIndex(item => item.slug === slug)
  if (index < 0) return
  const line = findMarkdownHeadingLine(editor.value.getValue(), index, sourceTocOptions())
  if (line < 0) return
  // `.source-code` is the scroll container (CodeMirror renders full-height with
  // viewportMargin: Infinity, so its own scroller never scrolls).
  scrollSourceEditorToLine(editor.value, line, sourceCodeContainer.value)
}

onMounted(() => {
  if (!currentTab.value) return
  const { id } = currentTab.value
  // reset currentTab scrollTop position because the codeMirror scroll position is completely different from the muya scroll position
  // reset blocks as well because the blocks are only valid in muya
  // reset cursor because this is a direct "key-cursor", not a muyaIndexCursor, which is {focus: number, anchor: number}
  currentTab.value.scrollTop = 0
  currentTab.value.blocks = undefined
  currentTab.value.cursor = undefined

  const { markdown, muyaIndexCursor, textDirection } = props
  const container = sourceCodeContainer.value
  const codeMirrorConfig: Record<string, unknown> = {
    value: markdown,
    lineNumbers: sourceCodeLineNumbers.value,
    autofocus: true,
    lineWrapping: true,
    styleActiveLine: true,
    direction: textDirection,
    viewportMargin: Infinity
  }

  if (railscastsThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  bus.on('file-loaded', handleFileChange)
  bus.on('file-changed', handleFileChange)
  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('image-action', handleImageAction)
  bus.on('scroll-to-header', handleScrollToHeader)
  bus.on('flush-active-editor', flushSourceEditor)

  // CodeMirror's line tree relies on object identity and must not be proxied by Vue.
  const codeMirrorInstance = markRaw(codeMirror(container, codeMirrorConfig))

  // See src/renderer/src/codeMirror/markdownMathMode.ts.
  codeMirrorInstance.setOption('mode', markdownMathMode())

  codeMirrorInstance.on('contextmenu', (_cm: CodeMirror.Editor, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  })

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor
    codeMirrorInstance.setSelection(anchor, focus, { scroll: true })
  } else {
    setCursorAtFirstLine(codeMirrorInstance)
  }

  editor.value = codeMirrorInstance
  tabId.value = id
  disposePluginEditor = setPluginEditor({
    id: () => currentTab.value?.id ?? null,
    text: () => codeMirrorInstance.getValue(),
    selection: () => ({ anchor: codeMirrorInstance.indexFromPos(codeMirrorInstance.getCursor('anchor')), head: codeMirrorInstance.indexFromPos(codeMirrorInstance.getCursor('head')) }),
    edit: (markdown, selection, reveal) => {
      historyViewport?.cancel()
      const viewport = reveal ? null : new HistoryViewport(codeMirrorInstance.getScrollerElement(), () => { historyViewport = null })
      historyViewport = viewport
      codeMirrorInstance.operation(() => {
        codeMirrorInstance.replaceRange(markdown, { line: 0, ch: 0 }, codeMirrorInstance.posFromIndex(codeMirrorInstance.getValue().length), '+plugin')
        if (selection) codeMirrorInstance.setSelection(offsetToIndex(markdown, Math.min(selection.anchor, markdown.length)), offsetToIndex(markdown, Math.min(selection.head, markdown.length)), { scroll: reveal })
      })
      viewport?.settle()
      flushSourceEditor()
    },
    select: (selection, reveal) => codeMirrorInstance.setSelection(codeMirrorInstance.posFromIndex(selection.anchor), codeMirrorInstance.posFromIndex(selection.head), { scroll: reveal }),
    undo: handleUndo,
    redo: handleRedo
  })
  codeMirrorInstance.on('cursorActivity', publishPluginSnapshot)
  codeMirrorInstance.on('change', publishPluginSnapshot)
  const sourceMarkdown = codeMirrorInstance.getValue()
  lastTocMarkdown = sourceMarkdown
  lastTocTabId = id
  lastTocOptions = JSON.stringify(sourceTocOptions())
  editorStore.UPDATE_TOC(buildSourceToc(sourceMarkdown, editorStore.listToc, sourceTocOptions()))
  updateSelectionWordCount(codeMirrorInstance)

  listenChange(codeMirrorInstance)
})

onBeforeUnmount(() => {
  disposePluginEditor?.()
  historyViewport?.cancel()
  viewDestroyed.value = true
  if (commitTimer.value) clearTimeout(commitTimer.value)

  bus.off('file-loaded', handleFileChange)
  bus.off('file-changed', handleFileChange)
  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('image-action', handleImageAction)
  editorStore.SET_SELECTION_WORD_COUNT(null)
  lastSelectionKey = ''
  bus.off('scroll-to-header', handleScrollToHeader)
  bus.off('flush-active-editor', flushSourceEditor)

  if (editor.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    bus.emit('file-changed', {
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor,
      renderCursor: true
    })
  }
})
</script>

<style>
.source-code {
  height: calc(100vh - var(--titleBarHeight));
  box-sizing: border-box;
  overflow: auto;
}
.source-code .CodeMirror {
  height: auto;
  margin: 50px auto;
  max-width: var(--editorAreaWidth);
  background: transparent;
}
.source-code .CodeMirror-gutters {
  border-right: none;
  background-color: transparent;
}
.source-code .CodeMirror-activeline-background,
.source-code .CodeMirror-activeline-gutter {
  background: var(--floatHoverColor);
}
/* Fade the delimiters against the formula. Dimming the inherited colour rather
   than naming one is what carries across every theme; 0.65 is the lowest value
   still clearing 3:1 in all of them, with one-dark at 3.67 setting the floor. */
.source-code .CodeMirror .cm-formatting-math {
  opacity: 0.65;
}
</style>
