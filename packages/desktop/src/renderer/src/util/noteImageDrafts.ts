import { collectMarkdownImageSources } from '@muyajs/core'
import type { IFileState } from '@shared/types/files'
import type { ImageDraftReference } from '@shared/types/ipc'
import { askImageOperation } from './imageOperationDialog'

const references = (note: IFileState, markdown = note.markdown): ImageDraftReference => ({ id: note.id, pathname: note.pathname || '', sources: collectMarkdownImageSources(markdown) })
const draftNotes = new Set<string>()
export const trackNoteImageDraft = (noteId: string): void => { if (noteId) draftNotes.add(noteId) }
export const hasNoteImageDrafts = (noteIds: string[]): boolean => noteIds.some(id => draftNotes.has(id))

export function commitNoteImages(note: IFileState, markdown: string): void {
  window.electron.images?.commitDraft?.(references(note, markdown)).catch(error => console.error('Unable to commit saved image files:', error))
}

export async function releaseNoteImages(noteIds: string[], tabs: IFileState[], scope?: ImageDraftReference): Promise<void> {
  if (!hasNoteImageDrafts(noteIds) || !window.electron.images?.releaseDrafts) return
  const closing = new Set(scope ? [] : noteIds)
  try {
    await window.electron.images.releaseDrafts({ noteIds, retained: tabs.filter(tab => !closing.has(tab.id)).map(tab => references(tab)), scope })
  } catch (error) {
    await askImageOperation({ title: '新增图片清理未完成', message: error instanceof Error ? error.message : '未能清理未保存的新增图片。笔记暂时保留，请检查图片文件后重试。', confirmLabel: '知道了' })
    throw error
  }
}
