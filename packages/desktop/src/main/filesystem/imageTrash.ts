import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { localImagePathCandidates } from 'common/imageFilePath'
import type { ImageTrashResult } from '@shared/types/ipc'

interface TrashEntry { pathname: string; bytes: Buffer; hash: string; removed: boolean }
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export class ImageTrashLedger {
  private entries = new Map<string, TrashEntry>()
  constructor(private trashItem: (pathname: string) => Promise<void>) {}

  async remove(src: string, documentPath: string): Promise<ImageTrashResult> {
    const candidates = localImagePathCandidates(src, documentPath)
    if (!candidates.length) return { ok: true }
    for (const pathname of candidates) {
      try {
        if (!(await stat(pathname)).isFile()) continue
        const bytes = await readFile(pathname)
        await this.trashItem(pathname)
        const token = randomUUID()
        // History owns a byte snapshot: restoring never consumes the user's
        // recycle-bin item or overwrites a file created after deletion.
        this.entries.set(token, { pathname, bytes, hash: digest(bytes), removed: true })
        return { ok: true, token }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        return { ok: false, error: '无法将图片放入回收站；图片链接已保留，请检查文件是否被占用。' }
      }
    }
    return { ok: true }
  }

  async reconcile(token: string, restore: boolean): Promise<ImageTrashResult> {
    const entry = this.entries.get(token)
    if (!entry) return { ok: false, error: '图片恢复记录已失效。' }
    if (restore === !entry.removed) return { ok: true, token }
    try {
      let current: Buffer | null = null
      try { current = await readFile(entry.pathname) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (current && digest(current) !== entry.hash) return { ok: false, error: '该位置已有另一张图片，已保留新文件。' }
      if (restore) {
        if (!current) await writeFile(entry.pathname, entry.bytes, { flag: 'wx' })
      } else if (current) {
        await this.trashItem(entry.pathname)
      }
      entry.removed = !restore
      return { ok: true, token }
    } catch {
      return { ok: false, error: '未能同步图片文件，请检查文件权限或占用情况。' }
    }
  }
}
