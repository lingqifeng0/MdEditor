const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')
const api = require('../dist/test-api.cjs')
const root = path.resolve(__dirname, '..')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, timeout = 3000) {
  const end = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= end) throw new Error('Test condition timed out')
    await delay(5)
  }
}

class FakeMpv {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint
    this.options = options
    this.commands = []
    this.clients = new Set()
    this.timers = new Set()
    this.connected = 0
    this.path = undefined
    this.duration = undefined
    this.position = 0
    this.pause = true
    this.seeking = false
    this.loadId = 0
    this.seekId = 0
    this.server = net.createServer(socket => {
      ++this.connected
      this.clients.add(socket)
      socket.on('error', () => {})
      socket.once('close', () => this.clients.delete(socket))
      let buffer = ''
      const decoder = new StringDecoder('utf8')
      socket.on('data', chunk => {
        buffer += decoder.write(chunk)
        let index
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (line.trim()) this.handle(socket, JSON.parse(line))
        }
      })
    })
  }
  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.endpoint, resolve)
    })
    return this
  }
  later(callback, milliseconds) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback() }, milliseconds)
    this.timers.add(timer)
  }
  send(socket, value) {
    if (socket.destroyed) return
    const line = Buffer.from(JSON.stringify(value) + '\n')
    if (this.options.fragment && line.length > 4) {
      // Split in the middle of a UTF-8 character without interleaving different messages.
      for (let offset = 0; offset < line.length; offset += 7) socket.write(line.subarray(offset, offset + 7))
    } else socket.write(line)
  }
  event(value) { for (const socket of this.clients) this.send(socket, value) }
  handle(socket, { command, request_id }) {
    this.commands.push(command)
    const reply = (data, error = 'success') => this.send(socket, { request_id, error, data })
    const [name, argument, value] = command
    if (name === 'get_property') {
      if (argument === 'test-timeout') return
      if (argument === 'test-disconnect') { socket.destroy(); return }
      const properties = {
        'mpv-version': 'mpv 0.40 模拟播放器',
        'command-list': [{ name: 'loadfile' }, { name: 'seek' }],
        pause: this.pause, path: this.path, duration: this.duration,
        'time-pos': this.position, seeking: this.seeking
      }
      if (this.options.badHandshake && argument === 'mpv-version') reply('Not a player')
      else if (properties[argument] === undefined) reply(undefined, 'property unavailable')
      else reply(properties[argument])
    } else if (name === 'set_property') {
      if (argument === 'pause') this.pause = value
      reply()
    } else if (name === 'loadfile') {
      const id = ++this.loadId
      this.path = argument
      this.duration = undefined
      this.position = Number(command[4]?.start ?? this.options.savedPosition ?? 0)
      this.event({ event: 'start-file' })
      reply()
      this.later(() => {
        if (id !== this.loadId) return
        if (this.options.decodeFailure) { this.event({ event:'end-file', reason:'error' }); return }
        this.duration = this.options.duration ?? 1000
        this.event({ event: 'file-loaded' })
      }, this.options.loadDelay ?? 15)
    } else if (name === 'seek') {
      const id = ++this.seekId
      this.seeking = true
      reply()
      this.later(() => {
        if (id !== this.seekId) return
        this.position = this.options.wrongPosition ? argument + 4 : argument
        this.seeking = false
        if (!this.options.noRestart) this.event({ event: 'playback-restart' })
      }, this.options.seekDelay ?? 15)
    } else reply(undefined, 'command not found')
  }
  disconnect() { for (const socket of this.clients) socket.destroy() }
  async close() {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.disconnect()
    if (this.server.listening) await new Promise(resolve => this.server.close(resolve))
  }
}

async function fixture(t, options = {}) {
  const runtime = path.join(root, '.runtime')
  await fs.mkdir(runtime, { recursive: true })
  const directory = await fs.mkdtemp(path.join(runtime, 'test-'))
  const application = path.join(directory, 'MarkText')
  const playerDirectory = path.join(directory, '播放器')
  const noteDirectory = path.join(directory, '笔记')
  const mediaDirectory = path.join(directory, '视频')
  for (const dir of [application, playerDirectory, noteDirectory, mediaDirectory]) await fs.mkdir(dir)
  const executable = path.join(playerDirectory, options.executableName ?? (options.frameflow ? 'FrameFlow.exe' : options.mpvnet ? 'mpvnet.exe' : 'mpv.exe'))
  const first = path.join(mediaDirectory, '课程 一 #%25.mp4')
  const second = path.join(mediaDirectory, '课程 二.mp4')
  const document = path.join(noteDirectory, '学习.md')
  for (const file of [executable, first, second, document]) await fs.writeFile(file, 'TEST ONLY - never executed')
  const data = path.join(directory, 'plugin-data')
  let session = null
  let spawns = 0
  let disposed = 0
  let prepares = 0
  let focusCalls = 0
  let settings = api.normalizeSettings({ playerPath: executable, autoPlay: true, bringToFront: false, ...options.settings })
  const servers = []
  const launches = []
  const log = []
  const native = {
    async prepare() { ++prepares },
    async identify(endpoint) {
      return {
        pid: options.badPid ? 0 : process.pid,
        executable: options.wrongIdentity ? path.join(directory, 'unrelated.exe') : executable,
        started: '2026-10-10T00:00:00.000Z'
      }
    },
    async inspect() {
      return options.frameflow
        ? { product: 'FrameFlow', description: 'FrameFlow 视频播放器', original: 'FrameFlow.exe', version: '7.1.2.1027' }
        : options.mpvnet ? { product: 'mpv.net', description: 'mpv.net', original: 'mpvnet.exe', version: 'test' }
          : { product: 'mpv', description: 'mpv', original: 'mpv.exe', version: 'test' }
    },
    async focus() { ++focusCalls; if (options.focusError) throw new Error('No foreground permission') },
    dispose() { ++disposed }
  }
  if (options.wrongPlayer) native.inspect = async () => ({ product:'Wrong', description:'Wrong', original:'Wrong', version:'test' })
  const spawnPlayer = (file, args) => {
    ++spawns
    launches.push({ file, args })
    const endpoint = args.find(argument => argument.startsWith('--input-ipc-server=')).slice('--input-ipc-server='.length)
    const server = new FakeMpv(endpoint, options)
    servers.push(server)
    const process = new EventEmitter()
    process.unref = () => {}
    server.start().catch(error => process.emit('error', error))
    return process
  }
  const controllerOptions = {
    application, data, native, spawnPlayer, existingEndpoints: [],
    readSettings: async () => settings,
    readSession: async () => session,
    saveSession: async value => { session = value },
    log: value => log.push(value),
    bootTimeout: 800, loadTimeout: 1000, seekTimeout: 350
  }
  const controller = new api.ReplayController(controllerOptions)
  const href = (file = first, seconds = 83.25) =>
    path.relative(noteDirectory, file).split(path.sep).map(encodeURIComponent).join('/') + '#t=' + seconds.toFixed(3)
  t.after(async () => {
    controller.dispose()
    for (const server of servers) await server.close()
    // Test fixtures are kept inside .runtime for inspection; no user media is deleted.
  })
  return {
    directory, application, executable, first, second, document, data, native, controllerOptions,
    controller, servers, launches, href, log,
    get session() { return session }, set session(value) { session = value },
    get settings() { return settings }, set settings(value) { settings = value },
    get spawns() { return spawns }, get disposed() { return disposed },
    get prepares() { return prepares }, get focusCalls() { return focusCalls }
  }
}

function endpoint() { return '\\\\.\\pipe\\video-study-test-' + randomUUID() }
module.exports = { api, root, fixture, FakeMpv, delay, until, endpoint }
