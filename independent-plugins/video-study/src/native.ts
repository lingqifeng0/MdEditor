import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { current, StudyError } from './common'

export interface Identity { pid: number; executable: string; started: string }
export interface ExecutableInfo { product: string; description: string; original: string; version: string }
export interface NativeBridge {
  prepare(): Promise<void>
  identify(endpoint: string, signal?: AbortSignal): Promise<Identity>
  inspect(file: string, signal?: AbortSignal): Promise<ExecutableInfo>
  focus(identity: Identity, signal?: AbortSignal): Promise<void>
  dispose(): void
}

interface Pending { finish(error?: Error, value?: unknown): void }
interface Runtime {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  resolveReady(): void
  rejectReady(error: Error): void
  timer: NodeJS.Timeout
  decoder: StringDecoder
  buffer: string
  pending: Map<number, Pending>
  stopped: boolean
}

export class NativeHelper implements NativeBridge {
  private runtime: Runtime | null = null
  private sequence = 0
  private disposed = false

  constructor(private readonly code: string) {}

  prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(new StudyError('CANCELLED', '插件已经停用。'))
    if (process.platform !== 'win32') return Promise.reject(new StudyError('UNSUPPORTED_PLATFORM', '此插件包用于 Windows。'))
    return this.start().ready
  }

  async identify(endpoint: string, signal?: AbortSignal): Promise<Identity> {
    if (!/^\\\\\.\\pipe\\[a-zA-Z0-9._-]{1,150}$/.test(endpoint)) {
      throw new StudyError('BAD_PIPE', '播放器通信地址无效。')
    }
    const value = await this.request({ operation: 'pipe', name: endpoint.slice('\\\\.\\pipe\\'.length) }, signal) as Identity
    if (!Number.isSafeInteger(value?.pid) || value.pid <= 0 || !value.executable || !value.started) {
      throw new StudyError('IDENTITY_MISMATCH', '播放器身份回复无效。')
    }
    return value
  }

  async inspect(file: string, signal?: AbortSignal): Promise<ExecutableInfo> {
    return await this.request({ operation: 'executable', path: file }, signal) as ExecutableInfo
  }

  async focus(identity: Identity, signal?: AbortSignal): Promise<void> {
    await this.request({ operation: 'focus', pid: identity.pid, executable: identity.executable, started: identity.started }, signal)
  }

  queryProcess(pid: number, signal?: AbortSignal): Promise<unknown> {
    return this.request({ operation: 'process', pid }, signal)
  }

  private start(): Runtime {
    if (this.runtime) return this.runtime
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    ready.catch(() => {})
    const child = spawn(path.join(this.code, 'native-helper.exe'), [], { windowsHide: true, stdio: 'pipe' })
    const runtime: Runtime = {
      child, ready, resolveReady, rejectReady, pending: new Map(), decoder: new StringDecoder('utf8'),
      buffer: '', stopped: false,
      timer: setTimeout(() => this.stop(runtime, new StudyError('HELPER_TIMEOUT', '播放器身份检查程序没有及时启动。')), 5000)
    }
    this.runtime = runtime
    child.stdout.on('data', (data: Buffer) => this.receive(runtime, runtime.decoder.write(data)))
    child.stderr.resume()
    child.stdin.on('error', () => this.stop(runtime, new StudyError('HELPER_FAILED', '播放器身份检查连接中断。')))
    child.once('error', () => this.stop(runtime, new StudyError('HELPER_FAILED', '无法启动插件自己的身份检查程序。')))
    child.once('exit', () => this.stop(runtime, new StudyError('HELPER_FAILED', '播放器身份检查程序已退出。')))
    return runtime
  }

  private async request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    current(signal)
    await this.prepare()
    current(signal)
    const runtime = this.runtime
    if (!runtime || runtime.stopped) throw new StudyError('HELPER_FAILED', '身份检查程序已退出，请重试。')
    if (runtime.pending.size >= 32) throw new StudyError('BUSY', '播放器身份检查繁忙，请稍后重试。')
    const id = ++this.sequence
    return await new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: unknown): void => {
        if (!runtime.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(value)
      }
      const abort = (): void => finish(new StudyError('CANCELLED', '身份检查已取消。'))
      const timer = setTimeout(() => finish(new StudyError('HELPER_TIMEOUT', '播放器身份检查超时。')), 3000)
      runtime.pending.set(id, { finish })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      runtime.child.stdin.write(JSON.stringify({ id, ...payload }) + '\n', 'utf8', error => {
        if (error) this.stop(runtime, new StudyError('HELPER_FAILED', '身份检查程序连接中断。'))
      })
    })
  }

  private receive(runtime: Runtime, text: string): void {
    if (runtime.stopped) return
    runtime.buffer += text
    if (Buffer.byteLength(runtime.buffer) > 131072) {
      this.stop(runtime, new StudyError('HELPER_FAILED', '身份检查回复过大。'))
      return
    }
    let newline: number
    while ((newline = runtime.buffer.indexOf('\n')) >= 0) {
      const line = runtime.buffer.slice(0, newline)
      runtime.buffer = runtime.buffer.slice(newline + 1)
      if (!line.trim()) continue
      try {
        const response = JSON.parse(line) as { ready?: boolean; id: number; ok: boolean; value?: unknown }
        if (response.ready) { clearTimeout(runtime.timer); runtime.resolveReady(); continue }
        if (!Number.isSafeInteger(response.id) || typeof response.ok !== 'boolean') throw new Error('invalid response')
        runtime.pending.get(response.id)?.finish(
          response.ok ? undefined : new StudyError('IDENTITY_UNAVAILABLE', '无法验证播放器的本地进程身份。'),
          response.value
        )
      } catch { this.stop(runtime, new StudyError('HELPER_FAILED', '身份检查程序返回了无效数据。')) }
    }
  }

  private stop(runtime: Runtime, error: Error): void {
    if (runtime.stopped) return
    runtime.stopped = true
    if (this.runtime === runtime) this.runtime = null
    clearTimeout(runtime.timer)
    runtime.rejectReady(error)
    for (const pending of [...runtime.pending.values()]) pending.finish(error)
    runtime.child.stdin.end()
    runtime.child.kill()
  }

  dispose(): void {
    this.disposed = true
    if (this.runtime) this.stop(this.runtime, new StudyError('CANCELLED', '身份检查已关闭。'))
  }
}
