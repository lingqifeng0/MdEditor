import type { ImageDirectoryResult } from '@shared/types/ipc'
import { dataURLToFile } from './dataURLToFile'
import { moveImageToFolder } from './fileSystem'

type NoteImageResult = { ok: true; src: string; pathname: string } | Exclude<ImageDirectoryResult, { ok: true }> | { ok: false; errorCode: 'imageMissing' | 'copyFailed' | 'cancelled' }
type PrepareDirectory = (problem: Exclude<ImageDirectoryResult, { ok: true }>) => Promise<{ pathname: string; directory: string } | null>

export async function storeNoteImage(image: string | File, documentPath: string, preferredName: string, prepare?: PrepareDirectory, noteId = ''): Promise<NoteImageResult> {
  let directory = await window.electron.images.resolveDirectory(documentPath, preferredName)
  if (!directory.ok && !prepare) return directory
  try {
    if (typeof image === 'string') {
      if (/^https?:\/\//i.test(image)) {
        if (!directory.ok) {
          const result = await prepare?.(directory)
          if (!result) return { ok: false, errorCode: 'cancelled' }
          documentPath = result.pathname
        }
        return { ok: true, src: image, pathname: documentPath }
      }
      if (image.startsWith('data:')) {
        const file = dataURLToFile(image)
        if (!file) return { ok: false, errorCode: 'copyFailed' }
        image = file
      } else {
        if (/^file:/i.test(image)) {
          const url = new URL(image)
          image = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1')
          if (url.hostname) image = `//${url.hostname}${image}`
        }
        const base = window.path.dirname(documentPath)
        const candidates = [window.path.resolve(base, image)]
        try { candidates.push(window.path.resolve(base, decodeURIComponent(image))) } catch {}
        let existing = ''
        for (const candidate of [...new Set(candidates)]) {
          if (await window.fileUtils.isImageFile(candidate) && await window.fileUtils.isFile(candidate)) { existing = candidate; break }
        }
        if (!existing) return { ok: false, errorCode: 'imageMissing' }
        image = existing
      }
    }
    if (!directory.ok) {
      const result = await prepare?.(directory)
      if (!result) return { ok: false, errorCode: 'cancelled' }
      documentPath = result.pathname
      directory = { ok: true, directory: result.directory }
    }
    const src = await moveImageToFolder(documentPath, image, directory.directory, true, documentPath, true, noteId)
    return { ok: true, src: src.replace(/\\/g, '/'), pathname: documentPath }
  } catch {
    return { ok: false, errorCode: 'copyFailed' }
  }
}
