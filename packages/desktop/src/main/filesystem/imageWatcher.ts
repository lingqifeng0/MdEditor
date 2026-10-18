import chokidar, { type FSWatcher } from 'chokidar'
import { localImagePathCandidates } from 'common/imageFilePath'

/** Watches only images referenced by the active note, including currently missing files. */
export class LocalImageWatcher {
  private watcher: FSWatcher | null = null
  private key = ''
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private settleReady: (() => void) | null = null

  constructor(private readonly invalidate: () => void) {}

  async update(sources: readonly string[], documentPath: string): Promise<void> {
    const files = [...new Set(sources.flatMap(src => localImagePathCandidates(src, documentPath)))].sort()
    const key = JSON.stringify(files)
    if (key === this.key) return
    this.key = key
    const generation = ++this.generation
    const previous = this.watcher
    this.watcher = null
    this.settleReady?.()
    this.settleReady = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await previous?.close()
    if (generation !== this.generation || !files.length) return
    const watcher = chokidar.watch(files, {
      ignoreInitial: true,
      depth: 0,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    this.watcher = watcher
    const changed = (): void => {
      if (generation !== this.generation) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        if (generation === this.generation) this.invalidate()
      }, 80)
    }
    watcher.on('add', changed).on('change', changed).on('unlink', changed).on('error', () => {})
    await new Promise<void>(resolve => {
      const ready = (): void => {
        watcher.removeListener('ready', ready)
        watcher.removeListener('error', ready)
        if (this.settleReady === ready) this.settleReady = null
        resolve()
      }
      this.settleReady = ready
      watcher.once('ready', ready)
      watcher.once('error', ready)
    })
  }

  async close(): Promise<void> {
    ++this.generation
    this.key = ''
    this.settleReady?.()
    this.settleReady = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const watcher = this.watcher
    this.watcher = null
    await watcher?.close()
  }
}
