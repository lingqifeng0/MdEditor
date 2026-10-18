import { shallowRef, watch } from 'vue'
import type { DocumentSnapshot, PluginPlatformState, PluginRegistration, RendererPluginRequest, TextSelection, EditTransaction, Json } from '@shared/plugin-api'
import { PluginError } from '@shared/plugin-api'
import { applyTextChanges, validateSelection } from '@shared/plugin-edits'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { sanitize, EXPORT_DOMPURIFY_CONFIG } from '@/util/dompurify'
import notification from '@/services/notification'

export interface PluginEditorAdapter {
  id(): string | null
  text(): string
  selection(): TextSelection | null
  edit(markdown: string, selection: TextSelection | null, reveal: boolean): void
  select(selection: TextSelection, reveal: boolean): void
  undo(): void
  redo(): void
}
export const platform = shallowRef<PluginPlatformState>({ apiVersion: 2, paths: { userData: '', plugins: '', data: '' }, plugins: [], registrations: [] })
export const openPluginViews = shallowRef<Array<{ registration: PluginRegistration; data: Json }>>([])
let adapter: PluginEditorAdapter | null = null
let initialized = false
let editorInitialized = false
let viewportPreserved = false
const versions = new Map<string, { markdown: string; revision: number }>()

export const isPluginViewportPreserved = (): boolean => viewportPreserved
export const setPluginViewportPreserved = (value: boolean): void => { viewportPreserved = value }
export const control = async <T = unknown>(action: string, payload?: unknown): Promise<T> => window.electron.ipcRenderer.invoke('mt::plugins::control', action, payload) as Promise<T>

export function indexToOffset(markdown: string, point: { line: number; ch: number }): number {
  const lines = markdown.split('\n')
  return lines.slice(0, Math.max(0, point.line)).reduce((sum, line) => sum + line.length + 1, 0) + Math.min(lines[point.line]?.length ?? 0, Math.max(0, point.ch))
}
export function offsetToIndex(markdown: string, offset: number): { line: number; ch: number } {
  const prefix = markdown.slice(0, offset)
  const lines = prefix.split('\n')
  return { line: lines.length - 1, ch: lines[lines.length - 1]!.length }
}

export function setPluginEditor(value: PluginEditorAdapter): () => void {
  adapter = value
  publishPluginSnapshot()
  return () => { if (adapter === value) adapter = null }
}

export function snapshots(): DocumentSnapshot[] {
  const store = useEditorStore()
  const preferences = usePreferencesStore()
  return store.tabs.map(tab => {
    const live = adapter?.id() === tab.id
    const markdown = live ? adapter!.text() : tab.markdown
    const previous = versions.get(tab.id)
    const revision = previous ? previous.revision + (previous.markdown === markdown ? 0 : 1) : 0
    versions.set(tab.id, { markdown, revision })
    return { id: tab.id, windowId: 0, path: tab.pathname || null, name: tab.filename, revision, markdown, selection: live ? adapter!.selection() : null, dirty: !tab.isSaved, mode: preferences.sourceCode ? 'source' : 'wysiwyg' }
  })
}
export function publishPluginSnapshot(): void {
  if (!editorInitialized) return
  const store = useEditorStore()
  const documents = snapshots()
  const ids = new Set(documents.map(d => d.id))
  for (const id of versions.keys()) if (!ids.has(id)) versions.delete(id)
  window.electron.ipcRenderer.send('mt::plugins::snapshot', { documents, activeId: store.currentFile?.id ?? null })
}

function checkedDocument(id: string, revision?: number): DocumentSnapshot {
  const document = snapshots().find(document => document.id === id)
  if (!document) throw new PluginError('NOT_FOUND', '笔记已关闭。')
  if (!adapter || adapter.id() !== id || useEditorStore().currentFile?.id !== id) throw new PluginError('DOCUMENT_INACTIVE', '该文档当前未显示，插件必须等它激活后再编辑。')
  if (revision !== undefined && revision !== document.revision) throw new PluginError('STALE_DOCUMENT', '笔记版本已改变，请重新读取。')
  return document
}

async function request(message: RendererPluginRequest): Promise<unknown> {
  const { method, args } = message
  if (method === 'workspace.openFile') { window.electron.ipcRenderer.send('mt::open-file', args[0] as string); return }
  if (method === 'workspace.createDocument') { useEditorStore().NEW_UNTITLED_TAB({ markdown: args[0] as string, selected: true }); return }
  if (method === 'ui.notice') { void notification.notify({ title: '插件', message: args[0] as string, type: 'info', time: 5000 }); return }
  if (method === 'ui.openView') {
    const registration = args[0] as PluginRegistration
    openPluginViews.value = openPluginViews.value.filter(view => view.registration.owner !== registration.owner || view.registration.id !== registration.id)
    openPluginViews.value = [...openPluginViews.value, { registration, data: args[1] as Json ?? null }]
    return
  }
  if (method === 'ui.closeView') { const registration = args[0] as PluginRegistration; openPluginViews.value = openPluginViews.value.filter(view => view.registration.owner !== registration.owner || view.registration.id !== registration.id); return }
  if (method === 'markdown.render') {
    const { default: markdownToHtml } = await import('@/util/markdownToHtml')
    let html = await markdownToHtml(args[0] as string)
    const document = snapshots().find(d => d.id === args[1])
    if (document) {
      const container = documentToElement(html)
      for (const code of container.querySelectorAll('pre > code')) {
        const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9)
        const registration = platform.value.registrations.find(r => r.kind === 'renderer' && r.definition.language === language)
        if (registration) {
          const rendered = await control<string>('render', { owner: registration.owner, id: registration.id, documentId: document.id, markdown: code.textContent ?? '' })
          code.parentElement!.outerHTML = sanitize(rendered, EXPORT_DOMPURIFY_CONFIG)
        }
      }
      html = container.innerHTML
    }
    return sanitize(html, EXPORT_DOMPURIFY_CONFIG)
  }
  if (method === 'editor.edit') {
    const transaction = args[0] as EditTransaction
    const document = checkedDocument(transaction.documentId, transaction.expectedRevision)
    const markdown = applyTextChanges(document.markdown, transaction)
    adapter!.edit(markdown, transaction.selection ?? document.selection, transaction.viewport === 'reveal-selection')
    publishPluginSnapshot()
    return snapshots().find(d => d.id === document.id)
  }
  if (method === 'editor.setSelection') {
    const document = checkedDocument(args[0] as string, args[1] as number)
    const selection = args[2] as TextSelection
    validateSelection(selection, document.markdown.length)
    adapter!.select(selection, args[3] === true)
    publishPluginSnapshot()
    return
  }
  if (method === 'editor.undo' || method === 'editor.redo') {
    checkedDocument(args[0] as string)
    adapter![method === 'editor.undo' ? 'undo' : 'redo']()
    publishPluginSnapshot()
    return
  }
  throw new PluginError('INVALID_ARGUMENT', '编辑器未定义此方法。')
}

function documentToElement(html: string): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = sanitize(html, EXPORT_DOMPURIFY_CONFIG)
  return container
}

export async function initializePluginPlatform(editor = false): Promise<void> {
  if (!initialized) {
    initialized = true
    window.electron.ipcRenderer.on('mt::plugins::state', (_event, state) => {
      platform.value = state
      openPluginViews.value = openPluginViews.value.filter(view => state.registrations.some(r => r.kind === 'view' && r.owner === view.registration.owner && r.id === view.registration.id))
    })
    window.electron.ipcRenderer.on('mt::plugins::request', (_event, message) => {
      request(message).then(value => window.electron.ipcRenderer.send('mt::plugins::response', { id: message.id, value }), error => window.electron.ipcRenderer.send('mt::plugins::response', { id: message.id, error: { code: error?.code ?? 'PLUGIN_FAILED', message: String(error?.message ?? error) } }))
    })
    platform.value = await control<PluginPlatformState>('state')
  }
  if (editor && !editorInitialized) {
    editorInitialized = true
    const store = useEditorStore()
    watch(() => [store.currentFile?.id, store.tabs.map(t => [t.id, t.markdown, t.pathname, t.isSaved])], publishPluginSnapshot, { deep: true, flush: 'sync' })
    publishPluginSnapshot()
  }
}

export const hasPluginLinkHandlers = (): boolean => platform.value.registrations.some(r => r.kind === 'link')

export async function dispatchPluginLink(href: string): Promise<boolean> {
  if (!platform.value.registrations.some(r => r.kind === 'link')) return false
  publishPluginSnapshot()
  const document = snapshots().find(d => d.id === useEditorStore().currentFile?.id) ?? null
  return control<boolean>('link', { href, document })
}
