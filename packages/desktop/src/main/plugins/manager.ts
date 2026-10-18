import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, utilityProcess, type UtilityProcess } from 'electron'
import log from 'electron-log'
import { APP_NAME } from 'common/appIdentity'
import {
  PLUGIN_API_VERSION, PluginError, type AppInfo, type CommandContext, type DocumentSnapshot, type Json,
  type LinkContext, type PluginManifest, type PluginPermission, type PluginPlatformState, type PluginRegistration,
  type PluginResponse, type PluginSummary, type RendererPluginRequest, type SettingField
} from '@shared/plugin-api'
import { applyTextChanges, validateSelection } from '@shared/plugin-edits'
import { getDocumentMetadata } from './metadata'
import { collectFiles, readZip, rejectLinks, safePackagePath, validatePluginId } from './package'
import { manifestFromFiles } from './manifest'
import { PluginLogStore } from './logs'
import { registerPluginViewProtocol, createPluginViewUrl, releasePluginViewUrl, revokePluginViews, revokeWindowViews } from './view-protocol'

type Pending = { resolve(value: any): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }
interface RunningPlugin {
  child: UtilityProcess
  manifest: PluginManifest
  pending: Map<string, Pending>
  stopped: Promise<void>
  stopResolve(): void
  active: boolean
}
const errorResponse = (error: unknown): NonNullable<PluginResponse['error']> => ({ code: (error as PluginError)?.code ?? 'PLUGIN_FAILED', message: error instanceof Error ? error.message : String(error) })
const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginError('INVALID_ARGUMENT', '需要对象参数。')
  return value as Record<string, any>
}
const asString = (value: unknown, limit = 4096): string => {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new PluginError('INVALID_ARGUMENT', '字符串参数无效。')
  return value
}
const validKey = (value: unknown): string => {
  const key = asString(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new PluginError('INVALID_ARGUMENT', '注册或存储名称无效。')
  return key
}

/** Owns registrations and IPC only; native application protocols belong to plugins. */
export class PluginManager {
  readonly paths: PluginPlatformState['paths']
  private plugins = new Map<string, PluginSummary>()
  private running = new Map<string, RunningPlugin>()
  private registrations = new Map<string, PluginRegistration>()
  private documents = new Map<string, DocumentSnapshot>()
  private activeDocuments = new Map<number, string | null>()
  private rendererPending = new Map<string, Pending & { windowId: number }>()
  private grants = new Map<string, Map<string, boolean>>()
  private mutations: Promise<unknown> = Promise.resolve()
  private knownWindows = new Set<number>()
  private sequence = 0
  private quitting = false
  private readonly logs: PluginLogStore

  constructor(userData: string, private readonly safeMode = false) {
    this.paths = { userData, plugins: path.join(userData, 'plugins'), data: path.join(userData, 'plugin-data') }
    this.logs = new PluginLogStore(this.paths.data, error => log.warn('Plugin log:', error))
  }

  getState(): PluginPlatformState {
    return { apiVersion: PLUGIN_API_VERSION, paths: { ...this.paths }, plugins: [...this.plugins.values()], registrations: [...this.registrations.values()] }
  }

  private broadcastState(): void {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('mt::plugins::state', this.getState())
  }

  async start(): Promise<void> {
    await fs.mkdir(this.paths.plugins, { recursive: true })
    await fs.mkdir(this.paths.data, { recursive: true })
    await rejectLinks(this.paths.plugins)
    await rejectLinks(this.paths.data)
    const state = await this.readJson(path.join(this.paths.userData, 'plugins-state-v2.json')) as Record<string, Json> | null
    for (const entry of await fs.readdir(this.paths.plugins, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        const manifest = manifestFromFiles(await collectFiles(path.join(this.paths.plugins, entry.name)))
        if (manifest.id !== entry.name) throw new PluginError('INVALID_PACKAGE', '插件目录与 ID 不一致。')
        const enabled = !this.safeMode && state?.[manifest.id] === true
        this.plugins.set(manifest.id, { manifest, enabled, status: 'disabled' })
      } catch (error) { log.warn(`Plugin directory ${entry.name}:`, error) }
    }
    registerPluginViewProtocol()
    for (const window of BrowserWindow.getAllWindows()) window.once('closed', () => revokeWindowViews(window.id))
    app.on('browser-window-created', (_event, window) => window.once('closed', () => revokeWindowViews(window.id)))
    this.registerIpc()
    nativeTheme.on('updated', () => this.emit('theme-changed', { dark: nativeTheme.shouldUseDarkColors }))
    for (const plugin of this.plugins.values()) if (plugin.enabled) await this.enable(plugin.manifest.id).catch(error => log.warn(error))
    this.broadcastState()
    app.on('before-quit', event => {
      if (this.quitting) return
      event.preventDefault()
      this.quitting = true
      Promise.allSettled([...this.running.keys()].map(id => this.stop(id))).then(() => this.logs.flushAll()).finally(() => app.quit())
    })
  }

  private window(id?: unknown, editorOnly = true): BrowserWindow {
    const focused = BrowserWindow.getFocusedWindow()
    const window = typeof id === 'number' ? BrowserWindow.fromId(id) : (focused && (!editorOnly || this.activeDocuments.has(focused.id)) ? focused : BrowserWindow.getAllWindows().find(w => !editorOnly || this.activeDocuments.has(w.id)))
    if (!window || window.isDestroyed() || (editorOnly && !this.activeDocuments.has(window.id))) throw new PluginError('NOT_FOUND', '编辑器窗口不可用。')
    return window
  }

  private document(id: unknown): DocumentSnapshot {
    const document = this.documents.get(asString(id, 160))
    if (!document) throw new PluginError('NOT_FOUND', '文档已关闭。')
    return document
  }

  private context(window: BrowserWindow): CommandContext {
    return { windowId: window.id, document: this.documents.get(this.activeDocuments.get(window.id) ?? '') ?? null }
  }

  private async renderer(window: BrowserWindow, method: string, args: unknown[]): Promise<any> {
    const id = `renderer-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.rendererPending.delete(id); reject(new PluginError('TIMEOUT', '编辑器请求超时。')) }, 5000)
      this.rendererPending.set(id, { resolve, reject, timer, windowId: window.id })
      window.webContents.send('mt::plugins::request', { id, method, args } satisfies RendererPluginRequest)
    })
  }

  private call(id: string, key: string, args: unknown[], timeout = 15000): Promise<any> {
    const worker = this.running.get(id)
    if (!worker || !worker.active) return Promise.reject(new PluginError('PLUGIN_DISABLED', '插件尚未启用。'))
    const requestId = `plugin-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => { worker.pending.delete(requestId); reject(new PluginError('TIMEOUT', '插件未及时响应。')) }, timeout) : undefined
      worker.pending.set(requestId, { resolve, reject, timer })
      worker.child.postMessage({ type: 'call', id: requestId, key, args })
    })
  }

  private registration(owner: string, kind: PluginRegistration['kind'], id: string): PluginRegistration {
    const item = this.registrations.get(`${owner}:${kind}:${id}`)
    if (!item) throw new PluginError('NOT_FOUND', '插件入口不存在。')
    return item
  }

  private demand(owner: string, permission: PluginPermission): void {
    if (!this.plugins.get(owner)?.manifest.permissions.includes(permission)) throw new PluginError('PERMISSION_DENIED', `未声明 ${permission} 权限。`)
  }

  private async register(owner: string, kind: PluginRegistration['kind'], id: string, definition: Record<string, any>): Promise<void> {
    const generation = this.running.get(owner)
    validKey(id)
    if (!['command', 'event', 'link', 'view', 'button', 'settings', 'renderer'].includes(kind)) throw new PluginError('INVALID_ARGUMENT', '未知注册类型。')
    if (['view', 'button', 'settings'].includes(kind)) this.demand(owner, 'ui')
    if (kind === 'link') this.demand(owner, 'links')
    if (kind === 'event' && ['document-changed', 'active-document-changed'].includes(definition.event)) this.demand(owner, 'editor.read')
    if (kind === 'renderer') this.demand(owner, 'editor.read')
    const key = `${owner}:${kind}:${id}`
    if (this.registrations.has(key) || [...this.registrations.values()].filter(r => r.owner === owner).length >= 100) throw new PluginError('INVALID_ARGUMENT', '入口重复或超出数量上限。')
    const copy = JSON.parse(JSON.stringify(definition)) as Record<string, any>
    if (kind === 'command') {
      asString(copy.name, 160)
      if (!copy.name.trim() || (copy.hotkey && !/^(?:(?:Ctrl|Alt|Shift|Meta|CmdOrCtrl)\+){1,3}[A-Za-z0-9]$/.test(copy.hotkey))) throw new PluginError('INVALID_ARGUMENT', '命令名称或快捷键无效。')
    }
    if (kind === 'event' && !['document-changed', 'active-document-changed', 'settings-changed', 'theme-changed'].includes(copy.event)) throw new PluginError('INVALID_ARGUMENT', '未知事件。')
    if (kind === 'view') {
      if (!['sidebar', 'tab', 'bottom', 'dialog', 'settings'].includes(copy.placement)) throw new PluginError('INVALID_ARGUMENT', '视图位置无效。')
      asString(copy.title, 160)
      safePackagePath(asString(copy.html, 240))
      if (!copy.html.endsWith('.html')) throw new PluginError('INVALID_ARGUMENT', '视图必须使用包内 HTML。')
      const files = await collectFiles(path.join(this.paths.plugins, owner))
      if (!files.has(copy.html) || files.get(copy.html)!.length > 512 * 1024) throw new PluginError('INVALID_ARGUMENT', '视图 HTML 不存在或过大。')
    }
    if (kind === 'button') {
      asString(copy.label, 160)
      asString(copy.icon ?? '', 80)
      if (!['toolbar', 'statusbar'].includes(copy.placement)) throw new PluginError('INVALID_ARGUMENT', '按钮位置无效。')
      this.registration(owner, 'command', validKey(copy.commandId))
    }
    if (kind === 'settings') {
      asString(copy.title, 160)
      if (copy.viewId) this.registration(owner, 'view', validKey(copy.viewId))
      if (copy.fields) {
        if (!Array.isArray(copy.fields) || copy.fields.length > 100) throw new PluginError('INVALID_ARGUMENT', '设置字段无效。')
        const keys = new Set<string>()
        for (const field of copy.fields as SettingField[]) {
          const key = validKey(field.key)
          if (keys.has(key) || !['text', 'file', 'toggle', 'number', 'select'].includes(field.type)) throw new PluginError('INVALID_ARGUMENT', '设置字段重复或类型无效。')
          keys.add(key)
          asString(field.label, 160)
          if (field.type === 'number' && ((field.min !== undefined && !Number.isFinite(field.min)) || (field.max !== undefined && !Number.isFinite(field.max)) || (field.min !== undefined && field.max !== undefined && field.min > field.max))) throw new PluginError('INVALID_ARGUMENT', '设置数值范围无效。')
          if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.length || field.options.length > 100 || field.options.some(option => typeof option.value !== 'string' || typeof option.label !== 'string'))) throw new PluginError('INVALID_ARGUMENT', '选择项无效。')
          if (field.default !== undefined) this.validateSetting(field, field.default)
        }
      }
    }
    if (kind === 'renderer' && !/^[a-zA-Z0-9_-]{1,80}$/.test(copy.language)) throw new PluginError('INVALID_ARGUMENT', '代码块语言无效。')
    if (!generation || this.running.get(owner) !== generation || !this.plugins.get(owner)?.enabled) throw new PluginError('PLUGIN_DISABLED', '插件已停止注册。')
    this.registrations.set(key, { owner, kind, id, definition: copy })
    this.broadcastState()
  }

  private validateSetting(field: SettingField, value: unknown): void {
    const fail = () => { throw new PluginError('INVALID_ARGUMENT', `设置 ${field.key} 的值无效。`) }
    if (field.type === 'toggle') { if (typeof value !== 'boolean') fail() } else if (field.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) fail() } else if (typeof value !== 'string' || value.length > 16000 || (field.type === 'select' && !field.options.some(option => option.value === value))) fail()
  }

  private async readJson(filename: string): Promise<Json | null> {
    try {
      const data = await fs.readFile(filename, 'utf8')
      if (data.length > 2 * 1024 * 1024) throw new Error('插件数据超过上限。')
      return JSON.parse(data) as Json
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }

  private async writeJson(filename: string, value: unknown): Promise<void> {
    const data = JSON.stringify(value)
    if (!data || data.length > 2 * 1024 * 1024) throw new PluginError('INVALID_ARGUMENT', '插件数据无效或过大。')
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await rejectLinks(path.dirname(filename))
    const temp = `${filename}.${randomUUID()}.tmp`
    try { await fs.writeFile(temp, data, { flag: 'wx' }); await fs.rename(temp, filename) } finally { await fs.unlink(temp).catch(() => {}) }
  }

  private storagePath(owner: string, key: string): string { return path.join(this.paths.data, validatePluginId(owner), validKey(key) + '.json') }

  private async readSettings(owner: string): Promise<Record<string, Json>> {
    const defaults: Record<string, Json> = {}
    for (const registration of this.registrations.values()) {
      if (registration.owner === owner && registration.kind === 'settings') {
        for (const field of (registration.definition.fields ?? []) as SettingField[]) if (field.default !== undefined) defaults[field.key] = field.default
      }
    }
    return { ...defaults, ...(await this.readJson(this.storagePath(owner, 'settings')) as Record<string, Json> ?? {}) }
  }

  private async saveSettings(owner: string, value: unknown): Promise<void> {
    const values = asObject(value)
    for (const key of Object.keys(values)) validKey(key)
    for (const registration of this.registrations.values()) {
      if (registration.owner === owner && registration.kind === 'settings') {
        for (const field of (registration.definition.fields ?? []) as SettingField[]) if (Object.hasOwn(values, field.key)) this.validateSetting(field, values[field.key])
      }
    }
    await this.writeJson(this.storagePath(owner, 'settings'), values)
    this.emit('settings-changed', { values }, owner)
    this.broadcastState()
  }

  private emit(event: string, value: unknown, owner?: string): void {
    for (const registration of this.registrations.values()) if (registration.kind === 'event' && registration.definition.event === event && (!owner || registration.owner === owner)) this.call(registration.owner, `event:${registration.id}`, [value]).catch(error => log.warn('Plugin event:', error))
  }

  private async allowedPath(owner: string, value: unknown, write = false): Promise<string> {
    const filename = path.resolve(asString(value))
    let actual: string
    try { actual = await fs.realpath(filename) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !write) throw error
      actual = path.join(await fs.realpath(path.dirname(filename)), path.basename(filename))
    }
    if (write && [...this.documents.values()].some(d => d.path && (path.resolve(d.path).toLowerCase() === actual.toLowerCase() || path.resolve(d.path).toLowerCase().startsWith(actual.toLowerCase() + path.sep)))) throw new PluginError('INVALID_ARGUMENT', '打开的文档请使用编辑事务。')
    const roots = [path.join(this.paths.data, owner), ...(write ? [] : [path.join(this.paths.plugins, owner)]), ...[...this.documents.values()].filter(d => d.path).map(d => path.dirname(d.path!))]
    for (const root of roots) {
      let actualRoot: string
      try { actualRoot = await fs.realpath(root) } catch { continue }
      const relative = path.relative(actualRoot, actual)
      if ((!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))) {
        if (write && [...this.documents.values()].some(d => d.path && path.resolve(d.path).toLowerCase() === filename.toLowerCase())) throw new PluginError('INVALID_ARGUMENT', '打开的文档请使用编辑事务，不能绕过保存和撤销直接写磁盘。')
        return actual
      }
    }
    for (const [grant, directory] of this.grants.get(owner) ?? []) {
      const relative = path.relative(grant, actual)
      if (!relative || (directory && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) return actual
    }
    throw new PluginError('PERMISSION_DENIED', '路径超出文档、插件数据或用户选择的文件范围。')
  }

  private async handle(owner: string, method: string, args: any[]): Promise<any> {
    if (method === 'register') return this.register(owner, args[0], asString(args[1], 160), asObject(args[2]))
    if (method === 'unregister') { this.registrations.delete(`${owner}:${args[0]}:${args[1]}`); this.broadcastState(); return }
    if (method.startsWith('editor.') || method.startsWith('metadata.') || ['workspace.getActiveDocument', 'workspace.listDocuments', 'markdown.render'].includes(method)) this.demand(owner, 'editor.read')
    if (['editor.edit', 'editor.setSelection', 'editor.undo', 'editor.redo', 'workspace.createDocument'].includes(method)) this.demand(owner, 'editor.write')
    if (method.startsWith('files.')) this.demand(owner, ['files.writeText', 'files.createFolder', 'files.trash'].includes(method) ? 'files.write' : 'files.read')
    if (method.startsWith('ui.')) this.demand(owner, 'ui')
    if (method.startsWith('desktop.')) this.demand(owner, 'desktop')
    switch (method) {
      case 'workspace.getActiveDocument': return this.context(this.window(args[0])).document
      case 'workspace.listDocuments': return [...this.documents.values()]
      case 'workspace.openFile': this.demand(owner, 'files.read'); return this.renderer(this.window(args[1]), method, [await this.allowedPath(owner, args[0])])
      case 'workspace.createDocument': return this.renderer(this.window(args[1]), method, [asString(args[0], 20 * 1024 * 1024)])
      case 'editor.getDocument': return this.document(args[0])
      case 'metadata.get': return getDocumentMetadata(this.document(args[0]))
      case 'editor.edit': {
        const transaction = asObject(args[0]) as any
        const document = this.document(transaction.documentId)
        if (document.revision !== transaction.expectedRevision) throw new PluginError('STALE_DOCUMENT', '笔记已改变，请重新读取后再编辑。')
        applyTextChanges(document.markdown, transaction)
        const result = await this.renderer(this.window(document.windowId), method, [transaction])
        return { ...result, windowId: document.windowId }
      }
      case 'editor.setSelection': {
        const document = this.document(args[0])
        if (document.revision !== args[1]) throw new PluginError('STALE_DOCUMENT', '选区使用了旧版本。')
        validateSelection(args[2], document.markdown.length)
        return this.renderer(this.window(document.windowId), method, args)
      }
      case 'editor.undo': case 'editor.redo': { const document = this.document(args[0]); return this.renderer(this.window(document.windowId), method, args) }
      case 'commands.execute': return this.execute(owner, asString(args[0], 160), args[1])
      case 'storage.get': return this.readJson(this.storagePath(owner, args[0]))
      case 'storage.set': return this.writeJson(this.storagePath(owner, args[0]), args[1])
      case 'storage.remove': return fs.unlink(this.storagePath(owner, args[0])).catch(error => { if (error.code !== 'ENOENT') throw error })
      case 'settings.read': return this.readSettings(owner)
      case 'settings.save': return this.saveSettings(owner, args[0])
      case 'ui.openView': case 'ui.closeView': {
        const registration = this.registration(owner, 'view', validKey(args[0]))
        return this.renderer(this.window(method === 'ui.openView' ? args[2] : args[1]), method, [registration, method === 'ui.openView' ? args[1] ?? null : null])
      }
      case 'ui.notice': return this.renderer(this.window(args[1]), method, [asString(args[0], 4000)])
      case 'ui.dialog': {
        const request = asObject(args[0])
        asString(request.title, 160); asString(request.message, 4000)
        if (!Array.isArray(request.buttons) || !request.buttons.length || request.buttons.length > 6 || request.buttons.some((b: unknown) => typeof b !== 'string' || b.length > 80)) throw new PluginError('INVALID_ARGUMENT', '对话框按钮无效。')
        return (await dialog.showMessageBox(this.window(args[1], false), { type: 'question', title: request.title, message: request.message, buttons: request.buttons, defaultId: request.defaultId, cancelId: request.cancelId, noLink: true })).response
      }
      case 'desktop.chooseFile': {
        const options = args[0] ? asObject(args[0]) : {}
        const result = await dialog.showOpenDialog(this.window(args[1], false), { title: options.title, properties: [options.directory ? 'openDirectory' : 'openFile', ...(options.multiple ? ['multiSelections' as const] : [])], filters: options.extensions ? [{ name: '文件', extensions: options.extensions }] : undefined })
        const grants = this.grants.get(owner) ?? new Map<string, boolean>()
        for (const filename of result.filePaths) grants.set(await fs.realpath(filename), (await fs.stat(filename)).isDirectory())
        this.grants.set(owner, grants)
        return result.filePaths
      }
      case 'desktop.openExternal': { const url = new URL(asString(args[0])); if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new PluginError('INVALID_ARGUMENT', '外部链接协议无效。'); return shell.openExternal(url.href) }
      case 'desktop.revealFile': return shell.showItemInFolder(await this.allowedPath(owner, args[0]))
      case 'desktop.readClipboardText': return clipboard.readText()
      case 'desktop.writeClipboardText': return clipboard.writeText(asString(args[0], 2 * 1024 * 1024))
      case 'files.resolve': { const document = this.document(args[1]); if (!document.path) throw new PluginError('INVALID_ARGUMENT', '请先保存笔记。'); return path.resolve(path.dirname(document.path), asString(args[0])) }
      case 'files.readText': { const data = await fs.readFile(await this.allowedPath(owner, args[0]), 'utf8'); if (data.length > 20 * 1024 * 1024) throw new PluginError('INVALID_ARGUMENT', '文件过大。'); return data }
      case 'files.readBinary': { const data = await fs.readFile(await this.allowedPath(owner, args[0])); if (data.length > 32 * 1024 * 1024) throw new PluginError('INVALID_ARGUMENT', '文件过大。'); return new Uint8Array(data) }
      case 'files.stat': { const filename = await this.allowedPath(owner, args[0]); const stat = await fs.stat(filename); return { path: filename, directory: stat.isDirectory(), size: stat.size, modifiedAt: stat.mtimeMs } }
      case 'files.list': { const directory = await this.allowedPath(owner, args[0]); return Promise.all((await fs.readdir(directory)).slice(0, 10000).map(async name => { const filename = await this.allowedPath(owner, path.join(directory, name)); const stat = await fs.stat(filename); return { path: filename, directory: stat.isDirectory(), size: stat.size, modifiedAt: stat.mtimeMs } })) }
      case 'files.writeText': return fs.writeFile(await this.allowedPath(owner, args[0], true), asString(args[1], 20 * 1024 * 1024))
      case 'files.createFolder': return fs.mkdir(await this.allowedPath(owner, args[0], true))
      case 'files.trash': return shell.trashItem(await this.allowedPath(owner, args[0], true))
      case 'markdown.render': { const document = this.document(args[0]); return this.renderer(this.window(document.windowId), method, [asString(args[1], 2 * 1024 * 1024), document.id]) }
      default: throw new PluginError('INVALID_ARGUMENT', `未定义的 SDK 方法：${method}`)
    }
  }

  private async enable(id: string): Promise<void> {
    validatePluginId(id)
    if (this.running.has(id)) return
    const summary = this.plugins.get(id)
    if (!summary) throw new PluginError('NOT_FOUND', '插件未安装。')
    summary.enabled = true
    summary.status = 'starting'
    delete summary.error
    this.logs.record(id, 'info', `启动插件 ${summary.manifest.name} ${summary.manifest.version}`)
    this.broadcastState()
    const code = path.join(this.paths.plugins, id)
    await rejectLinks(code)
    await fs.mkdir(path.join(this.paths.data, id), { recursive: true })
    const child = utilityProcess.fork(path.join(__dirname, 'plugin-worker.js'), [], { serviceName: `${APP_NAME} Plugin ${id}`, stdio: 'pipe' })
    for (const [stream, level] of [[child.stdout, 'info'], [child.stderr, 'error']] as const) {
      const decoder = new StringDecoder('utf8')
      stream?.on('data', (chunk: Buffer) => { const text = decoder.write(chunk); if (text) this.logs.record(id, level, text.trimEnd()) })
      stream?.on('end', () => { const text = decoder.end(); if (text) this.logs.record(id, level, text) })
    }
    let stopResolve!: () => void
    const worker: RunningPlugin = { child, manifest: summary.manifest, pending: new Map(), active: false, stopped: new Promise(resolve => { stopResolve = resolve }), stopResolve: () => stopResolve() }
    this.running.set(id, worker)
    const info: AppInfo = { version: app.getVersion(), apiVersion: 2, platform: process.platform, paths: { code, data: path.join(this.paths.data, id), userData: this.paths.userData, application: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath() }, capabilities: ['commands', 'documents', 'editor.transactions', 'metadata.atx-links', 'files', 'events', 'links', 'ui.views', 'ui.buttons', 'ui.settings', 'storage', 'markdown.codeblocks.preview', 'desktop.node', 'network'] }
    let readyResolve!: () => void
    let readyReject!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    const readyTimer = setTimeout(() => readyReject(new PluginError('TIMEOUT', '插件初始化超时。')), 15000)
    child.on('spawn', () => child.postMessage({ type: 'init', init: { manifest: summary.manifest, app: info }, entry: path.join(code, summary.manifest.main) }))
    child.on('message', message => {
      if (this.running.get(id) !== worker) return
      if (message.type === 'request') {
        this.handle(id, message.method, message.args ?? []).then(value => { if (this.running.get(id) === worker) child.postMessage({ type: 'response', id: message.id, value }) }, error => { if (this.running.get(id) === worker) child.postMessage({ type: 'response', id: message.id, error: errorResponse(error) }) })
      } else if (message.type === 'ready') { worker.active = true; readyResolve() } else if (message.type === 'failed') readyReject(new PluginError('PLUGIN_FAILED', message.error))
      else if (message.type === 'stopped') worker.stopResolve()
      else if (message.type === 'log') this.logs.record(id, message.level, message.message)
      else if (message.type === 'result') {
        const request = worker.pending.get(message.id)
        if (!request) return
        clearTimeout(request.timer)
        worker.pending.delete(message.id)
        if (message.error) request.reject(new PluginError(message.error.code, message.error.message))
        else request.resolve(message.value)
      }
    })
    child.on('exit', code => {
      this.logs.record(id, code ? 'error' : 'info', `插件进程退出 (${code})`)
      worker.stopResolve()
      readyReject(new PluginError('PLUGIN_FAILED', `插件进程已退出 (${code})。`))
      if (this.running.get(id) === worker) {
        this.running.delete(id)
        this.removeRegistrations(id)
        summary.status = summary.enabled ? 'error' : 'disabled'
        summary.error = summary.enabled ? `插件进程退出 (${code})` : undefined
        this.broadcastState()
      }
      for (const request of worker.pending.values()) { clearTimeout(request.timer); request.reject(new PluginError('PLUGIN_DISABLED', '插件进程已结束。')) }
      worker.pending.clear()
    })
    try { await ready; summary.status = 'active'; this.logs.record(id, 'info', '插件已启用'); this.emit('theme-changed', { dark: nativeTheme.shouldUseDarkColors }, id) } catch (error) {
      summary.status = 'error'
      summary.error = errorResponse(error).message
      this.logs.record(id, 'error', summary.error)
      await this.stop(id)
      throw error
    } finally { clearTimeout(readyTimer); this.broadcastState(); await this.saveEnabled() }
  }

  private removeRegistrations(id: string): void {
    for (const [key, registration] of this.registrations) if (registration.owner === id) this.registrations.delete(key)
    this.grants.delete(id)
    revokePluginViews(id)
  }

  private async stop(id: string): Promise<void> {
    const worker = this.running.get(id)
    this.removeRegistrations(id)
    this.broadcastState()
    if (!worker) return
    this.logs.record(id, 'info', '停用插件')
    worker.active = false
    worker.child.postMessage({ type: 'stop' })
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([worker.stopped, new Promise(resolve => { timer = setTimeout(resolve, 2000) })]) } finally {
      if (timer) clearTimeout(timer)
      this.running.delete(id)
      worker.child.kill()
      for (const request of worker.pending.values()) { clearTimeout(request.timer); request.reject(new PluginError('PLUGIN_DISABLED', '插件已停用。')) }
      worker.pending.clear()
      await this.logs.flush(id)
    }
  }

  private async saveEnabled(): Promise<void> { await this.writeJson(path.join(this.paths.userData, 'plugins-state-v2.json'), Object.fromEntries([...this.plugins].map(([id, plugin]) => [id, plugin.enabled]))) }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(action)
    this.mutations = result.catch(() => {})
    return result
  }

  private async execute(owner: string, id: string, context?: CommandContext): Promise<void> {
    this.registration(owner, 'command', id)
    const actual = context ? this.context(this.window(context.windowId)) : this.context(this.window())
    await this.call(owner, `command:${id}`, [{ ...actual, document: this.plugins.get(owner)?.manifest.permissions.includes('editor.read') ? actual.document : null }], 0)
  }

  private async install(filename: string, window: BrowserWindow): Promise<void> {
    const files = (await fs.stat(filename)).isDirectory() ? await collectFiles(filename) : readZip(await fs.readFile(filename))
    const manifest = manifestFromFiles(files)
    const old = this.plugins.get(manifest.id)
    const consent = await dialog.showMessageBox(window, { type: 'question', title: old ? '更新插件' : '安装插件', message: `${manifest.name} ${manifest.version}`, detail: `可信桌面插件具有 Node.js 系统访问能力。只安装你信任的插件。\n接口权限：${manifest.permissions.join('、') || '本插件数据'}\n${old ? '更新保留插件设置和数据。' : ''}`, buttons: ['取消', old ? '更新' : '安装'], defaultId: 0, cancelId: 0, noLink: true })
    if (consent.response !== 1) return
    const staging = path.join(this.paths.plugins, `.stage-${randomUUID()}`)
    const destination = path.join(this.paths.plugins, manifest.id)
    const backup = path.join(this.paths.plugins, `.backup-${randomUUID()}`)
    const wasEnabled = old?.enabled ?? false
    await rejectLinks(this.paths.plugins)
    await fs.mkdir(staging)
    let backedUp = false
    let installed = false
    try {
      for (const [name, content] of files) { const file = path.join(staging, safePackagePath(name)); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content, { flag: 'wx' }) }
      if (old) { await this.stop(manifest.id); await fs.rename(destination, backup); backedUp = true }
      await fs.rename(staging, destination)
      installed = true
      this.plugins.set(manifest.id, { manifest, enabled: wasEnabled, status: 'disabled' })
      if (wasEnabled) await this.enable(manifest.id)
      await this.saveEnabled()
      this.logs.record(manifest.id, 'info', `${old ? '更新' : '安装'}插件 ${manifest.name} ${manifest.version}`)
      if (backedUp) await fs.rm(backup, { recursive: true, force: true })
    } catch (error) {
      await this.stop(manifest.id)
      if (installed) await fs.rm(destination, { recursive: true, force: true })
      if (backedUp) await fs.rename(backup, destination)
      if (old) { this.plugins.set(manifest.id, old); if (wasEnabled) await this.enable(manifest.id).catch(e => log.warn(e)) } else this.plugins.delete(manifest.id)
      await this.saveEnabled()
      throw error
    } finally { await fs.rm(staging, { recursive: true, force: true }); this.broadcastState() }
  }

  private registerIpc(): void {
    ipcMain.handle('mt::plugins::control', async(event, action: string, payload?: any) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || event.senderFrame !== event.sender.mainFrame) throw new PluginError('PERMISSION_DENIED', '仅主应用窗口可操作插件。')
      switch (action) {
        case 'state': return this.getState()
        case 'enable': return this.serial(async() => { await this.enable(validatePluginId(payload)); this.broadcastState() })
        case 'disable': return this.serial(async() => { const id = validatePluginId(payload); const summary = this.plugins.get(id); if (summary) { summary.enabled = false; await this.stop(id); summary.status = 'disabled'; delete summary.error; await this.saveEnabled(); this.broadcastState() } })
        case 'install': return this.serial(() => this.install(asString(payload), window))
        case 'choose-install': { const result = await dialog.showOpenDialog(window, { title: '选择插件安装包', properties: ['openFile'], filters: [{ name: `${APP_NAME} 插件`, extensions: ['mtplug', 'zip'] }] }); if (result.filePaths[0]) return this.serial(() => this.install(result.filePaths[0]!, window)); return }
        case 'choose-folder': { const result = await dialog.showOpenDialog(window, { title: '选择插件文件夹', properties: ['openDirectory'] }); if (result.filePaths[0]) return this.serial(() => this.install(result.filePaths[0]!, window)); return }
        case 'uninstall': return this.serial(async() => {
          const id = validatePluginId(payload)
          const consent = await dialog.showMessageBox(window, { type: 'question', title: '卸载插件', message: '卸载插件程序？设置和数据会保留。', buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0, noLink: true })
          if (consent.response !== 1) return
          await this.stop(id)
          await rejectLinks(this.paths.plugins)
          await fs.rm(path.join(this.paths.plugins, id), { recursive: true, force: true })
          this.plugins.delete(id); await this.saveEnabled(); this.broadcastState()
        })
        case 'open-folder': { const filename = payload === 'data' ? this.paths.data : this.paths.plugins; return shell.openPath(filename) }
        case 'open-plugin-data': {
          const id = validatePluginId(payload)
          if (!this.plugins.has(id)) throw new PluginError('NOT_FOUND', '插件未安装。')
          const directory = path.join(this.paths.data, id)
          await rejectLinks(directory)
          await fs.mkdir(directory, { recursive: true })
          return shell.openPath(directory)
        }
        case 'logs-read': {
          const id = validatePluginId(payload)
          if (!this.plugins.has(id)) throw new PluginError('NOT_FOUND', '插件未安装。')
          return this.logs.read(id)
        }
        case 'execute': return this.execute(validatePluginId(payload.owner), validKey(payload.id), { windowId: window.id, document: null })
        case 'settings-read': return this.readSettings(validatePluginId(payload))
        case 'settings-save': { this.registration(validatePluginId(payload.owner), 'settings', validKey(payload.id)); return this.saveSettings(payload.owner, payload.values) }
        case 'release-view': return releasePluginViewUrl(asString(payload), window.id)
        case 'view-url': { const view = this.registration(validatePluginId(payload.owner), 'view', validKey(payload.id)); const files = await collectFiles(path.join(this.paths.plugins, payload.owner)); return createPluginViewUrl(payload.owner, window.id, files.get(view.definition.html as string)?.toString('utf8') ?? '') }
        case 'view-message': {
          this.registration(validatePluginId(payload.owner), 'view', validKey(payload.id))
          const context = this.activeDocuments.has(window.id) ? this.context(window) : { windowId: window.id, document: null }
          return this.call(payload.owner, `view:${payload.id}`, [payload.message as Json, { ...context, document: this.plugins.get(payload.owner)?.manifest.permissions.includes('editor.read') ? context.document : null }], 0)
        }
        case 'render': { const registration = this.registration(validatePluginId(payload.owner), 'renderer', validKey(payload.id)); const document = this.document(payload.documentId); if (document.windowId !== window.id) throw new PluginError('PERMISSION_DENIED', '文档不属于窗口。'); return this.call(registration.owner, `renderer:${registration.id}`, [{ document, markdown: asString(payload.markdown, 2 * 1024 * 1024), language: registration.definition.language }]) }
        case 'link': {
          if (!this.activeDocuments.has(window.id)) return false
          const snapshot = payload.document as DocumentSnapshot | null
          const document = snapshot ? this.documents.get(snapshot.id) : null
          if (snapshot && (!document || document.windowId !== window.id || document.revision !== snapshot.revision)) return false
          const context: LinkContext = { ...this.context(window), document: document ?? null, href: asString(payload.href), text: payload.text, modifiers: payload.modifiers ?? { ctrl: false, alt: false, shift: false, meta: false } }
          for (const registration of this.registrations.values()) {
            if (registration.kind === 'link') {
              try { if (await this.call(registration.owner, `link:${registration.id}`, [{ ...context, document: this.plugins.get(registration.owner)?.manifest.permissions.includes('editor.read') ? context.document : null }], 2000) === true) return true } catch (error) { log.warn('Plugin link:', error) }
            }
          }
          return false
        }
        default: throw new PluginError('INVALID_ARGUMENT', '未知插件管理操作。')
      }
    })
    ipcMain.on('mt::plugins::snapshot', (event, payload: { documents: DocumentSnapshot[]; activeId: string | null }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || event.senderFrame !== event.sender.mainFrame || !Array.isArray(payload.documents)) return
      const beforeActive = this.activeDocuments.get(window.id)
      const ids = new Set(payload.documents.map(d => d.id))
      for (const [id, document] of this.documents) if (document.windowId === window.id && !ids.has(id)) this.documents.delete(id)
      for (const incoming of payload.documents) {
        const document = { ...incoming, windowId: window.id }
        const before = this.documents.get(document.id)
        if (before && before.windowId !== window.id) continue
        this.documents.set(document.id, document)
        if (before && document.revision !== before.revision) this.emit('document-changed', document)
      }
      this.activeDocuments.set(window.id, payload.activeId)
      if (beforeActive !== payload.activeId) this.emit('active-document-changed', this.context(window))
      if (!this.knownWindows.has(window.id)) {
        this.knownWindows.add(window.id)
        window.once('closed', () => {
          this.knownWindows.delete(window.id)
          this.activeDocuments.delete(window.id)
          for (const [id, document] of this.documents) if (document.windowId === window.id) this.documents.delete(id)
          for (const [id, request] of this.rendererPending) if (request.windowId === window.id) { clearTimeout(request.timer); request.reject(new PluginError('NOT_FOUND', '编辑器窗口已关闭。')); this.rendererPending.delete(id) }
        })
      }
    })
    ipcMain.on('mt::plugins::response', (event, response: PluginResponse) => {
      const request = this.rendererPending.get(response.id)
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!request || !window || request.windowId !== window.id || event.senderFrame !== event.sender.mainFrame) return
      this.rendererPending.delete(response.id)
      clearTimeout(request.timer)
      if (response.error) request.reject(new PluginError(response.error.code as any, response.error.message))
      else request.resolve(response.value)
    })
  }
}
