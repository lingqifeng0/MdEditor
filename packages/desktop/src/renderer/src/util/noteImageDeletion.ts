import { collectMarkdownImageSources } from '@muyajs/core'
import { useEditorStore } from '@/store/editor'
import { askImageOperation, askImageRemoval } from './imageOperationDialog'
import type { IImageDeleteRequest } from '@muyajs/core'
import type { IFileState } from '@shared/types/files'

interface DeletedImage { noteId: string; src: string; token: string; remaining: number; restored: boolean; failed?: boolean }
const deletedImages: DeletedImage[] = []
let deleting = false
let synchronizing = false
let synchronizeAgain = false

const keyFor = (src: string): string => {
  try { src = decodeURIComponent(src) } catch {}
  src = src.replace(/\\/g, '/')
  return window.electron.process.platform === 'win32' ? src.toLowerCase() : src
}

export function imageReferenceCount(markdown: string, src: string): number {
  const key = keyFor(src)
  return collectMarkdownImageSources(markdown, false).filter(source => keyFor(source) === key).length
}

function forgetRestoredImages(noteId: string, sources: string[]): void {
  const keys = new Set(sources.map(keyFor))
  // A fresh edit replaces the old redo branch; its restored files must follow the new deletion choice.
  for (let index = deletedImages.length - 1; index >= 0; index--) {
    const entry = deletedImages[index]
    if (entry && entry.noteId === noteId && entry.restored && keys.has(keyFor(entry.src))) deletedImages.splice(index, 1)
  }
}

export async function deleteNoteImages(sources: string[], commit: () => boolean, isValid: () => boolean, trigger: 'toolbar' | 'keyboard' | 'confirmed' = 'toolbar', kind: 'image' | 'html' = 'image', linksOnly: string[] = []): Promise<boolean> {
  if (deleting) return false
  deleting = true
  const store = useEditorStore()
  const noteId = store.currentFile?.id
  const pathname = store.currentFile?.pathname || ''
  const removed: Array<{ src: string; token: string }> = []
  try {
    if (!noteId || !isValid()) return false
    const choice = trigger === 'confirmed' ? 'files' : await askImageRemoval(kind, new Set(sources).size)
    if (choice === 'cancel') return false
    if (store.currentFile?.id !== noteId || store.currentFile.pathname !== pathname || !isValid()) return false
    if (choice === 'links') {
      const committed = commit()
      if (committed) {
        forgetRestoredImages(noteId, sources)
        store.flushActiveEditor()
        await window.electron.images.retainDraftLinks?.({ id: noteId, pathname, sources })
      }
      return committed
    }
    for (const src of new Set(sources)) {
      const result = await window.electron.images.trash(src, pathname)
      if (!result.ok) throw new Error(result.error)
      if (result.token) removed.push({ src, token: result.token })
    }
    if (store.currentFile?.id !== noteId || store.currentFile.pathname !== pathname || !isValid() || !commit()) {
      for (const entry of removed) await window.electron.images.restoreTrash(entry.token, true)
      return false
    }
    store.flushActiveEditor()
    forgetRestoredImages(noteId, [...sources, ...linksOnly])
    if (linksOnly.length) await window.electron.images.retainDraftLinks?.({ id: noteId, pathname, sources: linksOnly })
    const markdown = store.currentFile?.markdown || ''
    for (const entry of removed) deletedImages.push({ ...entry, noteId, remaining: imageReferenceCount(markdown, entry.src), restored: false })
    return true
  } catch (error) {
    for (const entry of removed) await window.electron.images.restoreTrash(entry.token, true)
    await askImageOperation({ title: '未能删除图片', message: error instanceof Error ? error.message : '图片链接已保留。请检查本地图片文件。', confirmLabel: '知道了' })
    return false
  } finally {
    deleting = false
    synchronizeDeletedImages().catch(error => console.warn('Image history synchronization failed:', error))
  }
}

export const requestNoteImageDeletion = async(request: IImageDeleteRequest): Promise<void> => {
  await deleteNoteImages(request.sources ?? [request.src], request.commit, request.isValid, request.trigger, request.kind)
}

export const hasDeletedNoteImages = (noteIds: string[]): boolean => deletedImages.some(entry => noteIds.includes(entry.noteId))

export async function discardDeletedNoteImages(noteIds: string[], tabs: IFileState[]): Promise<void> {
  deleting = true
  try {
    for (const noteId of noteIds) {
      const entries = deletedImages.filter(entry => entry.noteId === noteId)
      if (!entries.length) continue
      const note = tabs.find(tab => tab.id === noteId)
      const markdown = note?.pathname ? await window.electron.images.readSavedMarkdown(note.pathname) : ''
      for (const entry of entries) {
        if (entry.restored || !imageReferenceCount(markdown, entry.src)) continue
        const result = await window.electron.images.restoreTrash(entry.token, true)
        if (!result.ok) throw new Error(result.error)
        entry.restored = true
      }
      for (let index = deletedImages.length - 1; index >= 0; index--) {
        if (deletedImages[index]?.noteId === noteId) deletedImages.splice(index, 1)
      }
    }
  } finally { deleting = false }
}

export async function synchronizeDeletedImages(): Promise<void> {
  if (synchronizing) { synchronizeAgain = true; return }
  if (deleting || !deletedImages.length) return
  synchronizing = true
  try {
    do {
      synchronizeAgain = false
      const store = useEditorStore()
      for (const entry of deletedImages) {
        const note = store.tabs.find(tab => tab.id === entry.noteId)
        if (!note || entry.failed) continue
        const restore = imageReferenceCount(note.markdown, entry.src) > entry.remaining
        if (restore === entry.restored) continue
        const result = await window.electron.images.restoreTrash(entry.token, restore)
        if (result.ok) entry.restored = restore
        else {
          entry.failed = true
          askImageOperation({ title: '图片文件同步未完成', message: result.error, confirmLabel: '知道了' }).catch(error => console.warn('Image history prompt failed:', error))
        }
      }
    } while (synchronizeAgain)
  } finally { synchronizing = false }
}
