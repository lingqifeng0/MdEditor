const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { api, root, until } = require('./helpers.cjs')
const { createElectron } = require('./host-electron.cjs')

test('actual v8.31 host permission routing reproduces the old failure and accepts the fixed plugin', async t => {
  const host = process.env.MARKTEXT_SDK_SOURCE
  if (!host) { t.skip('Set MARKTEXT_SDK_SOURCE to test actual host routing'); return }
  const esbuild = require(path.join(host, 'node_modules/esbuild'))
  const output = path.join(root, '.runtime/host-test')
  await fs.mkdir(output, { recursive:true })
  const aliases = {
    '@shared/plugin-api':path.join(host, 'packages/desktop/src/shared/plugin-api.ts'),
    '@shared/plugin-edits':path.join(host, 'packages/desktop/src/shared/plugin-edits.ts')
  }
  const inject = {
    name:'isolated-electron',
    setup(build) {
      build.onResolve({ filter:/^(electron|electron-log)$/ }, args => ({ path:args.path, namespace:'isolated-host' }))
      build.onLoad({ filter:/.*/, namespace:'isolated-host' }, args => ({
        contents:args.path === 'electron'
          ? 'module.exports = global.__isolatedMarkTextElectron'
          : 'module.exports = {info:(...args)=>global.__isolatedMarkTextElectron.logs.push(args),warn:(...args)=>global.__isolatedMarkTextElectron.logs.push(args)}',
        loader:'js'
      }))
    }
  }
  for (const [entry, filename] of [['manager.ts', 'manager.cjs'], ['worker.ts', 'plugin-worker.js']]) {
    await esbuild.build({
      entryPoints:[path.join(host, 'packages/desktop/src/main/plugins', entry)],
      outfile:path.join(output, filename), bundle:true, platform:'node', format:'cjs',
      target:'node22', alias:aliases, plugins:[inject]
    })
  }
  const electron = createElectron()
  global.__isolatedMarkTextElectron = electron
  const { PluginManager } = require(path.join(output, 'manager.cjs'))
  const profile = await fs.mkdtemp(path.join(output, 'profile-'))
  const manager = new PluginManager(profile)
  await manager.start()
  const control = (action, payload) => electron.control(action, payload)
  t.after(async () => {
    if (manager.getState().plugins.length) await control('disable', 'local.video-study')
    for (const child of electron.children) child.kill()
    delete global.__isolatedMarkTextElectron
  })

  const note = path.join(profile, '学习.md')
  const media = path.join(profile, '课程.mp4')
  await fs.writeFile(note, '[回看](<课程.mp4#t=12.500>)')
  await fs.writeFile(media, 'STATIC TEST FIXTURE: never played')
  const document = {
    id:'original-note', windowId:7, path:note, name:'学习.md', revision:1,
    markdown:'[回看](<课程.mp4#t=12.500>)', selection:null, dirty:false, mode:'wysiwyg'
  }
  electron.ipcMain.emit('mt::plugins::snapshot', electron.event, { documents:[document], activeId:document.id })
  const payload = { href:'课程.mp4#t=12.500', document }

  const oldPackage = path.join(root, 'dist/local.video-study-0.2.0.mtplug')
  if (await fs.stat(oldPackage).then(() => true, () => false)) {
    await control('install', oldPackage)
    await control('enable', 'local.video-study')
    assert.equal(await control('link', payload), true)
    await until(() => electron.notices.some(message => message.includes('请先保存')))
    assert.ok(manager.getState().registrations.some(registration => registration.kind === 'command'))
  }

  const manifest = require('../manifest.json')
  await control('install', path.join(root, 'dist/' + manifest.id + '-' + manifest.version + '.mtplug'))
  await control('enable', manifest.id)
  const state = manager.getState()
  assert.equal(state.plugins[0].status, 'active')
  assert.ok(state.plugins[0].manifest.permissions.includes('editor.read'))
  assert.equal(state.registrations.some(registration => ['command', 'button'].includes(registration.kind)), false)
  assert.ok(state.registrations.some(registration => registration.kind === 'settings' && registration.definition.viewId === 'settings'))
  assert.ok(state.registrations.some(registration => registration.kind === 'view' && registration.definition.placement === 'settings'))
  electron.notices.length = 0
  assert.equal(await control('link', payload), true)
  // It now reaches the next legitimate check, proving the saved original path arrived.
  // An empty test configuration deliberately prevents any player from launching.
  await until(() => electron.notices.some(message => message.includes('选择并保存你的播放器程序')))
  assert.equal(electron.notices.some(message => message.includes('请先保存')), false)
  assert.equal(await control('link', { ...payload, href:'https://example.com' }), false)
  const settings = await control('view-message', { owner:manifest.id, id:'settings', message:{ action:'read' } })
  assert.equal(settings.ok, true)
  assert.equal(settings.settings.playerPath, '')
  const settingsFile = path.join(profile, 'plugin-data/local.video-study/settings.json')
  assert.equal(await fs.stat(settingsFile).then(() => true, () => false), false)
  assert.equal(await fs.stat(path.join(profile, 'plugin-data/local.video-study/mpv-session-v2.json')).then(() => true, () => false), false)
  await control('disable', manifest.id)
  assert.equal(manager.getState().registrations.length, 0)
})

test('a package without editor.read cannot activate and silently misdiagnose a saved note', async () => {
  await assert.rejects(api.setup({ manifest:{ permissions:['links', 'ui', 'desktop'] } }, {}), { code:'MISSING_PERMISSION' })
})
