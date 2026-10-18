import net from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { current, StudyError } from './common'

interface Pending { finish(error?: Error, value?: unknown): void }

/** A live connection is retained across clicks; it never sends quit. */
export class MpvClient {
  private readonly decoder = new StringDecoder('utf8')
  private readonly pending = new Map<number, Pending>()
  private readonly events = new Map<string, number>()
  private buffer = ''
  private sequence = 0
  private revision = 0
  private closed = false
  private fileError = ''
  private loading = false

  private constructor(private readonly socket: net.Socket) {
    socket.on('data', data => this.receive(this.decoder.write(data)))
    socket.on('error', () => this.dispose())
    socket.on('close', () => this.dispose())
    socket.on('end', () => this.dispose())
  }

  static connect(endpoint: string, signal?: AbortSignal, timeout = 150): Promise<MpvClient> {
    current(signal)
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint)
      const fail = (error: Error): void => {
        cleanup()
        socket.destroy()
        reject(error)
      }
      const abort = (): void => fail(new StudyError('CANCELLED', '播放器连接已取消。'))
      const error = (): void => fail(new StudyError('DISCONNECTED', '播放器通信连接不可用。'))
      const timer = setTimeout(() => fail(new StudyError('DISCONNECTED', '播放器连接超时。')), timeout)
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        socket.removeListener('error', error)
        socket.removeListener('connect', connected)
      }
      const connected = (): void => {
        cleanup()
        if (signal?.aborted) { socket.destroy(); reject(new StudyError('CANCELLED', '播放器连接已取消。')); return }
        resolve(new MpvClient(socket))
      }
      socket.once('error', error)
      socket.once('connect', connected)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }

  get alive(): boolean { return !this.closed && !this.socket.destroyed }
  get serial(): number { return this.revision }
  happened(event: string, after: number): boolean { return (this.events.get(event) ?? 0) > after }
  get loadError(): string { return this.fileError }
  get filePending(): boolean { return this.loading }
  beginLoad(): void { this.fileError = ''; this.loading = true }

  async command(command: unknown[], signal?: AbortSignal, timeout = 3000): Promise<unknown> {
    current(signal)
    if (!this.alive) throw new StudyError('DISCONNECTED', '播放器已经关闭，请再点一次时间戳重新连接。')
    const id = ++this.sequence
    return await new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: unknown): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(value)
      }
      const abort = (): void => finish(new StudyError('CANCELLED', '回看操作已取消。'))
      const timer = setTimeout(() => finish(new StudyError('IPC_TIMEOUT', '播放器没有及时回复。')), timeout)
      this.pending.set(id, { finish })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      this.socket.write(JSON.stringify({ command, request_id: id }) + '\n', 'utf8', error => {
        if (error) this.dispose()
      })
    })
  }

  get(property: string, signal?: AbortSignal): Promise<unknown> {
    return this.command(['get_property', property], signal)
  }

  set(property: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.command(['set_property', property, value], signal)
  }

  private receive(text: string): void {
    if (this.closed) return
    this.buffer += text
    if (Buffer.byteLength(this.buffer) > 1048576) { this.dispose(); return }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      try {
        const reply = JSON.parse(line) as { request_id?: number; error?: string; data?: unknown; event?: string; reason?: string }
        if (!reply || typeof reply !== 'object') throw new Error('invalid reply')
        if (typeof reply.event === 'string') {
          this.events.set(reply.event, ++this.revision)
          if (reply.event === 'start-file') this.loading = true
          if (reply.event === 'file-loaded' || reply.event === 'end-file') this.loading = false
          if (reply.event === 'end-file' && reply.reason === 'error') this.fileError = '播放器无法解码或打开这个视频。'
          if (reply.event === 'shutdown') this.dispose()
        }
        if (Number.isSafeInteger(reply.request_id)) {
          this.pending.get(reply.request_id!)?.finish(
            reply.error === 'success' ? undefined : new StudyError('COMMAND_ERROR', '播放器命令失败：' + String(reply.error)),
            reply.data
          )
        }
      } catch { this.dispose(); return }
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of [...this.pending.values()]) {
      pending.finish(new StudyError('DISCONNECTED', '播放器连接已断开，请再点一次时间戳。'))
    }
    this.socket.destroy()
  }
}
