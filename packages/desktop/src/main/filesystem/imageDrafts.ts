import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { localImagePathCandidates } from 'common/imageFilePath'
import type { ImageDraftReference, StoreDraftImageRequest } from '@shared/types/ipc'

interface DraftImage { pathname: string; hash: string; owners: Set<string>; keepOnSave: Set<string> }
const keyFor = (pathname: string): string => process.platform === 'win32' ? path.normalize(pathname).toLowerCase() : path.normalize(pathname)
const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

// Only exclusively created files belong to a draft; preexisting hash matches never become disposable.
export class ImageDraftLedger {
  private files = new Map<string, DraftImage>()
  private queue: Promise<unknown> = Promise.resolve()
  private saves = new Map<string, Promise<void>>()

  constructor(private trash: (pathname: string) => Promise<void>) {}

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  store(owner: string, request: StoreDraftImageRequest): Promise<string> {
    return this.run(async() => {
      if (!request.noteId || !path.isAbsolute(request.directory) || !(await stat(request.directory)).isDirectory()) throw new Error('图片目录不存在。')
      const data = request.source ? await readFile(request.source) : request.data
      if (!data?.length) throw new Error('图片内容为空。')
      const extension = path.extname(request.source || request.name || '').toLowerCase()
      if (!/^\.[a-z\d]{1,10}$/.test(extension)) throw new Error('图片文件类型无效。')
      const filename = createHash('sha1').update(data).digest('hex') + extension
      const pathname = path.join(request.directory, filename)
      const key = keyFor(pathname)
      const hash = digest(data)
      try {
        await writeFile(pathname, data, { flag: 'wx' })
        this.files.set(key, { pathname, hash, owners: new Set([owner]), keepOnSave: new Set() })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const draft = this.files.get(key)
        if (draft && draft.hash === hash && digest(await readFile(pathname)) === hash) draft.owners.add(owner)
      }
      return pathname
    })
  }

  private references(notes: ImageDraftReference[]): Set<string> {
    return new Set(notes.flatMap(note => note.sources.flatMap(src => localImagePathCandidates(src, note.pathname).map(keyFor))))
  }

  retainLinks(owner: string, note: ImageDraftReference): Promise<void> {
    return this.run(async() => {
      for (const key of this.references([note])) this.files.get(key)?.keepOnSave.add(owner)
    })
  }

  commit(note: ImageDraftReference, owner = ''): Promise<void> {
    return this.run(async() => {
      for (const key of this.references([note])) this.files.delete(key)
      for (const [key, image] of this.files) {
        if (image.keepOnSave.has(owner)) this.files.delete(key)
      }
    })
  }

  save(owner: string, note: ImageDraftReference, write: () => Promise<unknown>): Promise<void> {
    const previous = this.saves.get(owner)
    const saved = (async() => {
      if (previous) await previous.catch(() => {})
      await write()
      await this.commit(note, owner)
    })()
    this.saves.set(owner, saved)
    const clear = (): void => { if (this.saves.get(owner) === saved) this.saves.delete(owner) }
    saved.then(clear, clear)
    return saved
  }

  async release(owners: string[], retained: ImageDraftReference[], scope?: ImageDraftReference): Promise<void> {
    // A no-op text edit may look saved before its disk write and image commit finish.
    while (owners.some(owner => this.saves.has(owner))) await Promise.all(owners.map(owner => this.saves.get(owner)))
    return this.run(async() => {
      const keep = this.references(retained)
      const selected = scope ? this.references([scope]) : null
      const closing = new Set(owners)
      const removals: Array<{ key: string; image: DraftImage; bytes: Uint8Array }> = []
      const transfers: Array<{ image: DraftImage; owners: string[] }> = []
      for (const [key, image] of this.files) {
        if (selected && !selected.has(key)) continue
        if (![...image.owners].some(owner => closing.has(owner))) continue
        if (keep.has(key)) continue
        const remaining = [...image.owners].filter(owner => !closing.has(owner))
        if (remaining.length) { transfers.push({ image, owners: remaining }); continue }
        try {
          const bytes = await readFile(image.pathname)
          if (digest(bytes) !== image.hash) throw new Error(`新增图片已被其他程序修改，未自动删除：${image.pathname}`)
          removals.push({ key, image, bytes })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      const removed: typeof removals = []
      try {
        for (const item of removals) { await this.trash(item.image.pathname); removed.push(item) }
      } catch (error) {
        for (const item of removed) await writeFile(item.image.pathname, item.bytes, { flag: 'wx' })
        throw error
      }
      for (const item of removals) this.files.delete(item.key)
      for (const item of transfers) item.image.owners = new Set(item.owners)
    })
  }
}
