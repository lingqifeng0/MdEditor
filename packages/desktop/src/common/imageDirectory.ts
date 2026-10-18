import path from 'node:path'
import { stat } from 'node:fs/promises'
import type { ImageDirectoryResult } from '@shared/types/ipc'

export const resolveNoteImageDirectory = async(documentPath: string, _preferredName = 'assets'): Promise<ImageDirectoryResult> => {
  if (typeof documentPath !== 'string' || !path.isAbsolute(documentPath)) return { ok: false, errorCode: 'unsaved' }
  const stem = path.basename(documentPath, path.extname(documentPath))
  const parent = path.dirname(documentPath)
  const normalize = (name: string): string => process.platform === 'win32' ? name.toLowerCase() : name
  if (!stem || normalize(path.basename(parent)) !== normalize(stem)) return { ok: false, errorCode: 'wrongParent', stem }
  try {
    if (!(await stat(documentPath)).isFile()) return { ok: false, errorCode: 'unsaved' }
  } catch {
    return { ok: false, errorCode: 'unsaved' }
  }
  const directory = path.join(parent, 'assets')
  try {
    if ((await stat(directory)).isDirectory()) return { ok: true, directory }
  } catch {}
  return { ok: false, errorCode: 'missingDirectory', stem }
}
