import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PluginError } from '@shared/plugin-api'
import { validatePluginId } from './package'

export const PLUGIN_LOG_BYTES = 128 * 1024
interface LogQueue {
  pending: Buffer
  writing?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  failure?: Error
}

const tail = (buffer: Buffer): Buffer => {
  if (buffer.length <= PLUGIN_LOG_BYTES) return buffer
  const suffix = buffer.subarray(buffer.length - PLUGIN_LOG_BYTES)
  const newline = suffix.indexOf(10)
  return newline < 0 ? Buffer.alloc(0) : suffix.subarray(newline + 1)
}

/** Bounded per-plugin logs survive disabling and restarting; logging failures never stop a plugin. */
export class PluginLogStore {
  private queues = new Map<string, LogQueue>()
  constructor(private readonly dataRoot: string, private readonly onError: (error: Error) => void) {}

  private queue(owner: string): LogQueue {
    validatePluginId(owner)
    let queue = this.queues.get(owner)
    if (!queue) { queue = { pending: Buffer.alloc(0) }; this.queues.set(owner, queue) }
    return queue
  }

  record(owner: string, level: string, message: unknown): void {
    const queue = this.queue(owner)
    const severity = ['info', 'warn', 'error'].includes(level) ? level : 'info'
    const text = String(message).slice(0, 8000).replace(/\0/g, '')
    const line = Buffer.from(`${new Date().toISOString()} [${severity}] ${text}\n`)
    queue.pending = tail(Buffer.concat([queue.pending, line]))
    this.schedule(owner, queue)
  }

  private schedule(owner: string, queue: LogQueue): void {
    if (queue.timer || queue.writing || !queue.pending.length) return
    queue.timer = setTimeout(() => { queue.timer = undefined; this.flush(owner).catch(this.onError) }, 100)
    queue.timer.unref()
  }

  flush(owner: string): Promise<void> {
    const queue = this.queue(owner)
    clearTimeout(queue.timer)
    queue.timer = undefined
    if (queue.writing) return queue.writing.then(() => this.flush(owner))
    if (!queue.pending.length) return Promise.resolve()
    const batch = queue.pending
    queue.pending = Buffer.alloc(0)
    queue.writing = this.write(owner, batch).then(() => { queue.failure = undefined }, error => {
      queue.failure = error instanceof Error ? error : new Error(String(error))
      this.onError(queue.failure)
    }).finally(() => { queue.writing = undefined; this.schedule(owner, queue) })
    return queue.writing
  }

  async flushAll(): Promise<void> { await Promise.all([...this.queues.keys()].map(owner => this.flush(owner))) }

  async read(owner: string): Promise<string> {
    await this.flush(owner)
    if (this.queue(owner).failure) throw this.queue(owner).failure
    return (await this.readTail(await this.filename(owner))).toString('utf8')
  }

  private async directory(directory: string): Promise<void> {
    try {
      const stat = await fs.lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new PluginError('PERMISSION_DENIED', '插件日志目录不能使用链接或普通文件。')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { await fs.mkdir(directory) } catch (createError) { if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError; await this.directory(directory) }
    }
  }

  private async filename(owner: string): Promise<string> {
    const id = validatePluginId(owner)
    await this.directory(this.dataRoot)
    await this.directory(path.join(this.dataRoot, id))
    const directory = path.join(this.dataRoot, id, 'logs')
    await this.directory(directory)
    const filename = path.join(directory, 'marktext.log')
    try {
      const stat = await fs.lstat(filename)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new PluginError('PERMISSION_DENIED', '插件日志文件不能使用链接。')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return filename
  }

  private async readTail(filename: string): Promise<Buffer> {
    let file: Awaited<ReturnType<typeof fs.open>>
    try { file = await fs.open(filename, 'r') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0); throw error }
    try {
      const size = (await file.stat()).size
      const start = Math.max(0, size - PLUGIN_LOG_BYTES)
      const buffer = Buffer.alloc(Math.min(size, PLUGIN_LOG_BYTES))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
      const result = buffer.subarray(0, bytesRead)
      if (!start) return result
      const newline = result.indexOf(10)
      return newline < 0 ? Buffer.alloc(0) : result.subarray(newline + 1)
    } finally { await file.close() }
  }

  private async write(owner: string, batch: Buffer): Promise<void> {
    const filename = await this.filename(owner)
    const data = tail(Buffer.concat([await this.readTail(filename), batch]))
    const temp = `${filename}.${randomUUID()}.tmp`
    try { await fs.writeFile(temp, data, { flag: 'wx' }); await fs.rename(temp, filename) } finally { await fs.unlink(temp).catch(() => {}) }
  }
}
