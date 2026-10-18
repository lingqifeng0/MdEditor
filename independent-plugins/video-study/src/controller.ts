import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { current, errorMessage, sleep, StudyError } from './common'
import { parseLink, resolveMedia, samePath } from './links'
import { MpvClient } from './ipc'
import type { Identity, NativeBridge } from './native'
import { resolvePlayer, type Settings } from './settings'

export interface Session { endpoint: string; executable: string; identity: Identity }
export interface ReplayResult { file: string; seconds: number; identity: Identity; playing: boolean }
export interface PlayerProcess {
  once(event: 'error' | 'exit', callback: (...args: unknown[]) => void): unknown
  unref(): void
}
export interface ControllerOptions {
  application: string
  data: string
  native: NativeBridge
  readSettings(): Promise<Settings>
  readSession(): Promise<unknown>
  saveSession(value: Session): Promise<void>
  log(message: string): void
  spawnPlayer?(executable: string, args: string[]): PlayerProcess
  /** Test injection prevents simulations from touching a user's real named pipe. */
  existingEndpoints?: string[]
  bootTimeout?: number
  loadTimeout?: number
  seekTimeout?: number
}

type Frontend = 'frameflow' | 'mpvnet' | 'mpv'
interface Connection extends Session { client: MpvClient; frontend: Frontend }
interface Launch { endpoint: string; executable: string; failed: boolean; at: number }
const pipePrefix = '\\\\.\\pipe\\'
const validEndpoint = (value: unknown): value is string =>
  typeof value === 'string' && /^\\\\\.\\pipe\\[a-zA-Z0-9._-]{1,150}$/.test(value)

export class ReplayController {
  private connection: Connection | null = null
  private launch: Launch | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private operation: AbortController | null = null
  private disposed = false
  private revision = 0

  constructor(private readonly options: ControllerOptions) {}

  /** Each click captures its own document. Old operations cannot issue later commands. */
  request(href: string, documentPath: string | null): Promise<ReplayResult | undefined> {
    const target = parseLink(href, documentPath)
    if (this.disposed) return Promise.reject(new StudyError('CANCELLED', '插件已停用。'))
    this.operation?.abort()
    const operation = new AbortController()
    const revision = ++this.revision
    this.operation = operation
    const run = this.tail.catch(() => {}).then(async () => {
      try {
        current(operation.signal)
        const file = await resolveMedia(target.file)
        current(operation.signal)
        const settings = await this.options.readSettings()
        current(operation.signal)
        const connection = await this.connect(settings, operation.signal)
        const result = await this.replay(connection, file, target.seconds, settings, operation.signal)
        current(operation.signal)
        return revision === this.revision ? result : undefined
      } catch (error) {
        if (operation.signal.aborted || revision !== this.revision) return undefined
        if (error instanceof StudyError && error.code === 'DISCONNECTED') this.dropConnection()
        throw error
      }
    })
    this.tail = run
    return run
  }

  cancel(): void {
    ++this.revision
    this.operation?.abort()
  }

  private dropConnection(): void {
    this.connection?.client.dispose()
    this.connection = null
  }

  async checkPlayer(settings: Settings, signal?: AbortSignal): Promise<{ file: string; version: string; frontend: Frontend }> {
    const file = await resolvePlayer(settings, this.options.application)
    current(signal)
    const info = await this.options.native.inspect(file, signal)
    const description = [info.product, info.description, info.original].join(' ').toLowerCase()
    // Metadata only selects frontend-specific arguments; compatibility is
    // verified against the selected process's live IPC, never a brand name.
    const frontend = description.includes('frameflow') ? 'frameflow'
      : /mpv[.\s-]?net/.test(description) ? 'mpvnet' : 'mpv'
    return { file, version: info.version, frontend }
  }

  private async connect(settings: Settings, signal: AbortSignal): Promise<Connection> {
    const executable = await resolvePlayer(settings, this.options.application)
    current(signal)
    if (this.connection?.client.alive && samePath(this.connection.executable, executable)) return this.connection
    this.dropConnection()
    const { frontend } = await this.checkPlayer(settings, signal)
    current(signal)
    const endpoints: string[] = []
    const stored = await this.options.readSession()
    current(signal)
    if (stored && typeof stored === 'object') {
      const session = stored as Partial<Session>
      if (validEndpoint(session.endpoint) && samePath(session.executable, executable)) endpoints.push(session.endpoint)
    }
    if (this.launch && !this.launch.failed && samePath(this.launch.executable, executable)) endpoints.unshift(this.launch.endpoint)
    endpoints.push(...(this.options.existingEndpoints ??
      (frontend === 'frameflow' ? [pipePrefix + 'FrameFlow', pipePrefix + 'mpvnet-modern'] :
        frontend === 'mpvnet' ? [pipePrefix + 'mpvnet-modern'] : [])))
    for (const endpoint of new Set(endpoints)) {
      const connected = await this.tryConnect(endpoint, executable, frontend, signal)
      if (connected) return connected
    }

    if (!this.launch || this.launch.failed || !samePath(this.launch.executable, executable) ||
        Date.now() - this.launch.at > (this.options.bootTimeout ?? 20000)) {
      const hash = createHash('sha256').update(this.options.data).digest('hex').slice(0, 12)
      const launch: Launch = {
        endpoint: pipePrefix + 'marktext-video-study-' + hash + '-' + randomUUID(),
        executable, failed: false, at: Date.now()
      }
      const args = [
        '--idle=yes', '--pause=yes', '--resume-playback=no', '--save-position-on-quit=no',
        '--input-ipc-server=' + launch.endpoint
      ]
      if (frontend !== 'mpv') args.unshift('--process-instance=multi')
      current(signal)
      const process = (this.options.spawnPlayer ?? this.spawnPlayer)(executable, args)
      process.once('error', () => { launch.failed = true })
      process.once('exit', () => { launch.failed = true })
      process.unref()
      this.launch = launch
    }
    const launch = this.launch
    const deadline = launch.at + (this.options.bootTimeout ?? 20000)
    while (Date.now() < deadline) {
      current(signal)
      if (launch.failed) throw new StudyError('START_FAILED', '播放器启动失败，请检查播放器路径。')
      const connected = await this.tryConnect(launch.endpoint, executable, frontend, signal)
      if (connected) return connected
      await sleep(30, signal)
    }
    throw new StudyError('START_TIMEOUT', '播放器没有建立兼容的本地通信连接，请确认所选程序支持 mpv JSON IPC。')
  }

  private spawnPlayer(executable: string, args: string[]): PlayerProcess {
    return spawn(executable, args, {
      cwd: path.dirname(executable), windowsHide: true, detached: true, stdio: 'ignore'
    }) as PlayerProcess
  }

  private async tryConnect(endpoint: string, executable: string, frontend: Frontend, signal: AbortSignal): Promise<Connection | null> {
    let client: MpvClient | null = null
    try {
      client = await MpvClient.connect(endpoint, signal, 120)
      const identity = await this.options.native.identify(endpoint, signal)
      current(signal)
      if (!samePath(identity.executable, executable) || !Number.isSafeInteger(identity.pid) ||
          identity.pid <= 0 || !identity.started) {
        throw new StudyError('IDENTITY_MISMATCH', '此通信连接不属于所选播放器。')
      }
      const version = await client.get('mpv-version', signal)
      const commands = await client.get('command-list', signal)
      if (typeof version !== 'string' || !version.toLowerCase().includes('mpv') ||
          !Array.isArray(commands) || !['loadfile', 'seek'].every(name =>
            commands.some(command => command && typeof command === 'object' && command.name === name))) {
        throw new StudyError('WRONG_IPC', '连接没有提供 mpv 的文件加载和定位接口。')
      }
      if (typeof await client.get('pause', signal) !== 'boolean') {
        throw new StudyError('WRONG_IPC', '播放器没有提供可验证的播放状态。')
      }
      const connection = { endpoint, executable, identity, client, frontend }
      current(signal)
      this.connection = connection
      try { await this.options.saveSession({ endpoint, executable, identity }) } catch (error) {
        this.options.log('连接可用，保存会话失败：' + errorMessage(error))
      }
      current(signal)
      return connection
    } catch (error) {
      client?.dispose()
      if (this.connection?.client === client) this.connection = null
      current(signal)
      if (!(error instanceof StudyError && error.code === 'DISCONNECTED')) {
        this.options.log('忽略不可用的播放器连接：' + errorMessage(error))
      }
      return null
    }
  }

  private async property(client: MpvClient, name: string, signal: AbortSignal): Promise<unknown> {
    try { return await client.get(name, signal) } catch (error) {
      if (error instanceof StudyError && error.code === 'COMMAND_ERROR') return undefined
      throw error
    }
  }

  private async replay(connection: Connection, file: string, seconds: number, settings: Settings, signal: AbortSignal): Promise<ReplayResult> {
    const client = connection.client
    current(signal)
    const alreadyLoaded = samePath(await this.property(client, 'path', signal), file)
    await client.set('pause', true, signal)
    if (!alreadyLoaded) {
      const after = client.serial
      client.beginLoad()
      // FrameFlow's on_preloaded hook gives an explicit per-file start priority
      // over saved progress, including when reusing an already-open window.
      const load = connection.frontend === 'frameflow'
        ? ['loadfile', file, 'replace', -1, { start: seconds.toFixed(3), 'resume-playback': 'no' }]
        : ['loadfile', file, 'replace']
      await client.command(load, signal)
      const deadline = Date.now() + (this.options.loadTimeout ?? 15000)
      let loaded = false
      while (Date.now() < deadline) {
        current(signal)
        if (client.loadError) throw new StudyError('LOAD_FAILED', client.loadError)
        if (client.happened('file-loaded', after) && samePath(await this.property(client, 'path', signal), file)) {
          loaded = true
          break
        }
        await sleep(15, signal)
      }
      if (!loaded) throw new StudyError('LOAD_TIMEOUT', '播放器尚未确认视频加载完成，请重试。')
    }
    if (client.filePending) {
      const deadline = Date.now() + (this.options.loadTimeout ?? 15000)
      while (client.filePending && Date.now() < deadline) {
        current(signal)
        if (client.loadError) throw new StudyError('LOAD_FAILED', client.loadError)
        await sleep(15, signal)
      }
      if (client.filePending || !samePath(await this.property(client, 'path', signal), file)) {
        throw new StudyError('LOAD_TIMEOUT', '播放器尚未完成该视频的加载。')
      }
    }
    const duration = await this.property(client, 'duration', signal)
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      throw new StudyError('BAD_DURATION', '播放器无法读取本地视频时长。')
    }
    if (seconds >= duration) throw new StudyError('OUT_OF_RANGE', '时间戳超过视频时长，请核对笔记链接。')
    current(signal)
    const after = client.serial
    await client.command(['seek', seconds, 'absolute+exact'], signal)
    const deadline = Date.now() + (this.options.seekTimeout ?? 7000)
    let landed = false
    while (Date.now() < deadline) {
      current(signal)
      const position = await this.property(client, 'time-pos', signal)
      const seeking = await this.property(client, 'seeking', signal)
      if (client.happened('playback-restart', after) && seeking === false &&
          typeof position === 'number' && Math.abs(position - seconds) <= 0.2 &&
          samePath(await this.property(client, 'path', signal), file)) {
        landed = true
        break
      }
      if (client.loadError) throw new StudyError('LOAD_FAILED', client.loadError)
      await sleep(15, signal)
    }
    if (!landed) throw new StudyError('SEEK_TIMEOUT', '播放器未确认到达目标时间，请再点一次时间戳。')
    current(signal)
    await client.set('pause', !settings.autoPlay, signal)
    if (await client.get('pause', signal) !== !settings.autoPlay) {
      throw new StudyError('STATE_MISMATCH', '播放器没有采用所设置的播放状态。')
    }
    if (settings.bringToFront) {
      try { await this.options.native.focus(connection.identity, signal) } catch (error) {
        current(signal)
        this.options.log('视频已定位，显示播放器窗口失败：' + errorMessage(error))
      }
    }
    current(signal)
    return { file, seconds, identity: connection.identity, playing: settings.autoPlay }
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
    this.dropConnection()
    this.options.native.dispose()
  }
}
