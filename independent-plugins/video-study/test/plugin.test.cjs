const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const { api, root, fixture, FakeMpv, delay, until, endpoint } = require('./helpers.cjs')

test('Chinese, spaces, # and % paths are decoded once against the original note', () => {
  const doc = 'E:/课程/笔记/学习.md'
  const target = api.parseLink('<../视频/' + encodeURIComponent('课程 一 #%25.mp4') + '#t=83.250>', doc)
  assert.equal(target.file, path.resolve('E:/课程/视频/课程 一 #%25.mp4'))
  assert.equal(target.seconds, 83.25)
  assert.equal(api.displayTime(target.seconds), '00:01:23.250')
  assert.notEqual(target.file, api.parseLink('../视频/课程.mp4#t=83', 'E:/另一个目录/学习.md').file)
})

test('malformed and nonlocal timestamps fail before application launch', () => {
  for (const link of [
    '../a.mp4#t=-1', '../a.mp4#t=NaN', '../a.mp4#t=1.2345', '../a.mp4#t=1e3', '../a.mp4#t=9999999',
    'C:/a.mp4#t=1', '//server/a.mp4#t=1', '../a.exe#t=1', '../%ZZ.mp4#t=1', '../a.mp4?x=1#t=1'
  ]) assert.throws(() => api.parseLink(link, 'E:/notes/学习.md'), api.StudyError, link)
  assert.throws(() => api.parseLink('../a.mp4#t=1', null), { code:'NOTE_UNSAVED' })
  assert.equal(api.ownsLink('https://example.com/a.mp4#t=1'), false)
  assert.equal(api.ownsLink('../image.png#t=1'), false)
  assert.equal(api.ownsLink('../a.mp4#t=bad'), true)
  assert.equal(api.ownsLink('../a.mp4'), false)
})

test('player settings migrate conservatively and remain relative after relocation', () => {
  const migrated = api.normalizeSettings({ player: { base:'marktextExecutableDir', path:'../mpv/mpv.exe' }, afterSeek:'pause' })
  assert.equal(migrated.playerPath, '../mpv/mpv.exe')
  assert.equal(migrated.autoPlay, false)
  assert.equal(api.portablePlayerPath('C:/App/mpv/mpv.exe', 'C:/App/MarkText'), '../mpv/mpv.exe')
  assert.equal(path.resolve('D:/迁移/MarkText', migrated.playerPath), path.resolve('D:/迁移/mpv/mpv.exe'))
  assert.equal(api.portablePlayerPath('E:/mpv/mpv.exe', 'C:/App/MarkText'), 'E:/mpv/mpv.exe')
  assert.throws(() => api.normalizeSettings({ autoPlay:'yes' }), { code:'BAD_SETTINGS' })
  assert.throws(() => api.normalizeSettings({ player:{ base:'unknown', path:'mpv.exe' } }), { code:'BAD_SETTINGS' })
})

test('cold click starts one simulated player; same-file seek reuses its connection', async t => {
  const f = await fixture(t, { fragment:true })
  const first = await f.controller.request(f.href(), f.document)
  assert.equal(first.seconds, 83.25)
  assert.equal(first.file, f.first)
  assert.equal(f.spawns, 1)
  const server = f.servers[0]
  const connections = server.connected
  await f.controller.request(f.href(f.first, 200.125), f.document)
  assert.equal(f.spawns, 1)
  assert.equal(server.connected, connections)
  assert.equal(server.commands.filter(command => command[0] === 'loadfile').length, 1)
  assert.deepEqual(server.commands.filter(command => command[0] === 'seek').at(-1), ['seek', 200.125, 'absolute+exact'])
  assert.equal(server.pause, false)
  assert.equal(f.session.executable, f.executable)
})

test('switching video loads the new file and honors paused replay', async t => {
  const f = await fixture(t)
  await f.controller.request(f.href(), f.document)
  f.settings = { ...f.settings, autoPlay:false }
  const result = await f.controller.request(f.href(f.second, 5), f.document)
  assert.equal(result.file, f.second)
  assert.equal(result.playing, false)
  assert.equal(f.servers[0].path, f.second)
  assert.equal(f.servers[0].pause, true)
  assert.equal(f.servers[0].commands.filter(command => command[0] === 'loadfile').length, 2)
})

test('latest click wins even when it arrives while the same file is loading', async t => {
  const f = await fixture(t, { loadDelay:100, seekDelay:30 })
  const old = f.controller.request(f.href(f.first, 10), f.document)
  await until(() => f.servers[0]?.commands.some(command => command[0] === 'loadfile'))
  const latest = f.controller.request(f.href(f.first, 300), f.document)
  assert.equal(await old, undefined)
  assert.equal((await latest).seconds, 300)
  assert.equal(f.servers[0].position, 300)
  assert.equal(f.spawns, 1)
  assert.equal(f.servers[0].commands.filter(command => command[0] === 'loadfile').length, 1)
  assert.deepEqual(f.servers[0].commands.filter(command => command[0] === 'seek'), [['seek', 300, 'absolute+exact']])
})

test('a canceled seek cannot resume or focus before the latest seek finishes', async t => {
  const f = await fixture(t, { seekDelay:100, settings:{ bringToFront:true } })
  const old = f.controller.request(f.href(f.first, 15), f.document)
  await until(() => f.servers[0]?.commands.some(command => command[0] === 'seek'))
  const latest = f.controller.request(f.href(f.second, 80), f.document)
  assert.equal(await old, undefined)
  assert.equal((await latest).file, f.second)
  assert.equal(f.focusCalls, 1)
  assert.equal(f.servers[0].position, 80)
  assert.equal(f.servers[0].commands.filter(command => command[0] === 'set_property' && command[1] === 'pause' && command[2] === false).length, 1)
})

test('saved session reconnects without launching; dead player is replaced on the next click', async t => {
  const f = await fixture(t)
  const server = await new FakeMpv(endpoint()).start()
  f.servers.push(server)
  f.session = { endpoint:server.endpoint, executable:f.executable }
  await f.controller.request(f.href(), f.document)
  assert.equal(f.spawns, 0)
  await server.close()
  await delay(20)
  await f.controller.request(f.href(f.second, 90), f.document)
  assert.equal(f.spawns, 1)
  assert.equal(f.servers.at(-1).path, f.second)
})

test('missing media and invalid executable never start or command a player', async t => {
  const f = await fixture(t)
  await assert.rejects(f.controller.request(f.href(path.join(f.directory, 'missing.mp4')), f.document), { code:'MEDIA_MISSING' })
  f.settings = { ...f.settings, playerPath:'' }
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'PLAYER_NOT_SET' })
  f.settings = { ...f.settings, playerPath:'wrong.exe' }
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'WRONG_PLAYER' })
  f.settings = { ...f.settings, playerPath:'missing/mpv.exe' }
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'PLAYER_MISSING' })
  assert.equal(f.spawns, 0)
})

test('an executable renamed to mpv is rejected by its version metadata', async t => {
  const f = await fixture(t, { wrongPlayer:true })
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'WRONG_PLAYER' })
  assert.equal(f.spawns, 0)
})

test('wrong pipe executable is never sent a player command', async t => {
  const f = await fixture(t, { wrongIdentity:true })
  const server = await new FakeMpv(endpoint()).start()
  f.servers.push(server)
  f.session = { endpoint:server.endpoint, executable:f.executable }
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'START_TIMEOUT' })
  assert.equal(server.commands.length, 0)
  assert.ok(f.servers.every(server => server.commands.length === 0))
})

test('out-of-range timestamps are not clamped to an unrelated point', async t => {
  const f = await fixture(t, { duration:50 })
  await assert.rejects(f.controller.request(f.href(f.first, 100), f.document), { code:'OUT_OF_RANGE' })
  assert.equal(f.servers[0].commands.some(command => command[0] === 'seek'), false)
})

test('seek acknowledgement without actual position confirmation is not reported as success', async t => {
  const f = await fixture(t, { wrongPosition:true })
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'SEEK_TIMEOUT' })
  assert.equal(f.servers[0].pause, true)
})

test('decode failure and absent playback-restart produce actionable errors', async t => {
  const first = await fixture(t, { decodeFailure:true })
  await assert.rejects(first.controller.request(first.href(), first.document), { code:'LOAD_FAILED' })
  const second = await fixture(t, { noRestart:true })
  await assert.rejects(second.controller.request(second.href(), second.document), { code:'SEEK_TIMEOUT' })
})

test('mpv.net launch uses multi-instance arguments; disabling retains the server/player', async t => {
  const f = await fixture(t, { mpvnet:true })
  await f.controller.request(f.href(), f.document)
  assert.ok(f.launches[0].args.includes('--process-instance=multi'))
  assert.ok(f.launches[0].args.includes('--pause=yes'))
  assert.ok(f.launches[0].args.includes('--save-position-on-quit=no'))
  f.controller.dispose()
  assert.equal(f.servers[0].server.listening, true)
  assert.equal(f.servers[0].commands.some(command => command[0] === 'quit'), false)
  await assert.rejects(f.controller.request(f.href(), f.document), { code:'CANCELLED' })
})

test('disable during a load cancels later seek/play commands', async t => {
  const f = await fixture(t, { loadDelay:100 })
  const pending = f.controller.request(f.href(), f.document)
  await until(() => f.servers[0]?.commands.some(command => command[0] === 'loadfile'))
  f.controller.dispose()
  assert.equal(await pending, undefined)
  await delay(110)
  assert.equal(f.servers[0].commands.some(command => command[0] === 'seek'), false)
  assert.equal(f.servers[0].server.listening, true)
})

test('JSON IPC supports fragmented Unicode, concurrent IDs, cancellation and timeout', async t => {
  const server = await new FakeMpv(endpoint(), { fragment:true }).start()
  t.after(() => server.close())
  const client = await api.MpvClient.connect(server.endpoint)
  t.after(() => client.dispose())
  const [version, pause] = await Promise.all([client.get('mpv-version'), client.get('pause')])
  assert.match(version, /模拟播放器/)
  assert.equal(pause, true)
  const operation = new AbortController()
  const waiting = client.command(['get_property', 'test-timeout'], operation.signal)
  operation.abort()
  await assert.rejects(waiting, { code:'CANCELLED' })
  await assert.rejects(client.command(['get_property', 'test-timeout'], undefined, 30), { code:'IPC_TIMEOUT' })
  assert.equal(await client.get('pause'), true)
  await assert.rejects(client.get('test-disconnect'), { code:'DISCONNECTED' })
})

test('Windows native helper checks real pipe owner/PID and reads player metadata without playback', async t => {
  const native = new api.NativeHelper(path.join(root, 'dist/package'))
  t.after(() => native.dispose())
  const server = await new FakeMpv(endpoint()).start()
  t.after(() => server.close())
  await native.prepare()
  const identity = await native.identify(server.endpoint)
  assert.equal(identity.pid, process.pid)
  assert.ok(api.samePath(identity.executable, process.execPath))
  assert.ok(identity.started)
  assert.equal((await native.queryProcess(process.pid)).pid, process.pid)
  const player = 'C:/App/mpvnet-modern/mpvnet.exe'
  if (await fs.stat(player).then(() => true, () => false)) {
    const info = await native.inspect(player)
    assert.match(info.product.toLowerCase(), /mpv/)
    assert.ok(info.version)
  }
  await assert.rejects(native.identify('http://127.0.0.1:8888'), { code:'BAD_PIPE' })
})

test('public SDK registration returns link ownership immediately and settings never launch playback', async t => {
  const f = await fixture(t)
  const lifecycle = new AbortController()
  let handler, viewHandler
  const registrations = []
  const resources = []
  const events = {}
  const notices = []
  const store = {}
  let values = {}
  const ctx = {
    signal:lifecycle.signal, manifest:require('../manifest.json'),
    app:{ apiVersion:2, version:'0.31.0-toolbar.v8.31', platform:'win32',
      paths:{ application:f.application, code:path.join(root, 'dist/package'), data:f.data, userData:f.directory } },
    register(resource) { resources.push(resource); return { dispose:resource } },
    ui:{
      async registerView(view, handler) { registrations.push(view); viewHandler = handler },
      async registerButton(button) { registrations.push(button) },
      async openView() {}, async notice(message) { notices.push(message) }
    },
    settings:{
      async register(value) { registrations.push(value) },
      async read() { return values },
      async save(value) { values = value; events['settings-changed']?.({ values }) }
    },
    commands:{ async register() { throw new Error('Do not add an editor command menu') } },
    links:{ async register(callback) {
      // Match the host's permission filtering, which the initial fixture omitted.
      handler = context => callback({ ...context, document:ctx.manifest.permissions.includes('editor.read') ? context.document : null })
    } },
    events:{ async on(name, callback) { events[name] = callback } },
    desktop:{ async chooseFile() { return [f.executable] } },
    storage:{ async get(key) { return store[key] ?? null }, async set(key, value) { store[key] = value } },
    workspace:{ async getActiveDocument() { throw new Error('Must not read a new active document') } },
    log:{ info() {}, warn() {}, error() {} }
  }
  const controller = await api.setup(ctx, f.native, { spawnPlayer:f.controllerOptions.spawnPlayer, existingEndpoints:[], bootTimeout:800, loadTimeout:1000, seekTimeout:350 })
  t.after(() => controller.dispose())
  assert.equal(f.spawns, 0)
  assert.equal(f.prepares, 1)
  assert.ok(ctx.manifest.permissions.includes('editor.read'), 'Relative links require the host to send the source document')
  assert.equal(registrations.some(value => value.commandId), false, 'No toolbar button should obscure the note')
  assert.equal((await viewHandler({ action:'read' }, { windowId:7 })).settings.playerPath, '')
  const choice = await viewHandler({ action:'choose' }, { windowId:7 })
  assert.equal(choice.playerPath, '../播放器/mpv.exe')
  await viewHandler({ action:'save', playerPath:choice.playerPath, autoPlay:false, bringToFront:false }, { windowId:7 })
  await viewHandler({ action:'check', ...values }, { windowId:7 })
  assert.equal(f.spawns, 0)
  await assert.rejects(viewHandler({ action:'save', playerPath:5 }, { windowId:7 }))
  const event = {
    href:f.href(f.first, 55), windowId:7, document:{ path:f.document },
    modifiers:{ ctrl:false, alt:false, shift:false, meta:false }
  }
  const start = performance.now()
  assert.equal(handler(event), true)
  assert.ok(performance.now() - start < 100, 'Ownership must not wait for loading')
  event.document.path = path.join(f.directory, 'new-tab.md')
  await until(() => notices.some(message => message.includes('00:00:55')))
  assert.equal(f.servers[0].path, f.first)
  assert.equal(handler({ ...event, href:'https://example.com' }), false)
  assert.equal(handler({ ...event, href:'../a.mp4#t=-2' }), true)
  await until(() => notices.some(message => message.includes('时间戳需要')))
  lifecycle.abort()
  for (const resource of resources) await resource()
  assert.equal(f.servers[0].server.listening, true)
})

test('all 73 timestamp targets in the four current notes resolve with the new parser', async t => {
  const workspace = path.resolve(root, '../..')
  const file = path.join(workspace, 'trent硬件基础/视频学习笔记测试/最新结果-03-06/_校验/目录整理与链接校验.json')
  if (!await fs.stat(file).then(() => true, () => false)) { t.skip('Project-specific notes are not included in the portable source archive'); return }
  const report = JSON.parse(await fs.readFile(file, 'utf8'))
  let count = 0
  for (const row of report.rows) {
    const text = await fs.readFile(row.markdown_path, 'utf8')
    for (const stamp of row.timestamps) {
      assert.ok(text.includes(stamp.url))
      const target = api.parseLink(stamp.url, row.markdown_path)
      assert.ok(api.samePath(await api.resolveMedia(target.file), row.video_path))
      assert.equal(Math.round(target.seconds * 1000), stamp.at_ms)
      assert.ok(target.seconds * 1000 < row.duration_ms)
      ++count
    }
  }
  assert.equal(count, 73)
})

test('v8.31 actual ZIP reader and manifest validator accept the new .mtplug', async t => {
  const host = process.env.MARKTEXT_SDK_SOURCE
  if (!host) { t.skip('Set MARKTEXT_SDK_SOURCE to verify with the host validator'); return }
  const tools = path.resolve(host, '../validation/tools')
  const { readZip } = require(path.join(tools, 'package.cjs'))
  const { manifestFromFiles, validateManifest } = require(path.join(tools, 'manifest.cjs'))
  const localManifest = require('../manifest.json')
  const files = readZip(await fs.readFile(path.join(root, 'dist/' + localManifest.id + '-' + localManifest.version + '.mtplug')))
  const manifest = manifestFromFiles(files)
  assert.equal(manifest.apiVersion, 2)
  assert.equal(manifest.formatVersion, 2)
  assert.equal(manifest.id, 'local.video-study')
  assert.ok(manifest.permissions.includes('editor.read'))
  assert.ok(files.has('native-helper.exe'))
  assert.ok(files.has('settings.html'))
  assert.throws(() => validateManifest({ ...manifest, apiVersion:1 }), { code:'INCOMPATIBLE_API' })
  assert.doesNotMatch(files.get('main.cjs').toString(), /ctx\.ipc|ctx\.apps|ipc\.mpv|127\.0\.0\.1/)
})
