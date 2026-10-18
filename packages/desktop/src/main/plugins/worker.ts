import { createRequire } from 'node:module'
import type { PluginContext, PluginModule, PluginResponse, PluginRegistration, Json, CommandContext } from '@shared/plugin-api'
import { PluginError } from '@shared/plugin-api'

const parent = (process as unknown as { parentPort: { on(name: string, listener: (event: { data: unknown }) => void): void; postMessage(message: unknown): void } }).parentPort
const requirePlugin = createRequire(__filename)
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
const callbacks = new Map<string, (...args: any[]) => unknown>()
const resources: Array<() => void | Promise<void>> = []
const abort = new AbortController()
let sequence = 0
let context: PluginContext
let plugin: PluginModule | undefined
let stopped = false

function rpc(method: string, ...args: unknown[]): Promise<any> {
  if (stopped) return Promise.reject(new PluginError('PLUGIN_DISABLED', '插件已停止。'))
  const id = String(++sequence)
  return new Promise((resolve, reject) => {
    // Human interaction can take longer than an IPC deadline; stop still cancels pending calls.
    const interactive = ['ui.dialog', 'desktop.chooseFile', 'commands.execute'].includes(method)
    const timer = interactive ? undefined : setTimeout(() => { pending.delete(id); reject(new PluginError('TIMEOUT', `接口 ${method} 超时。`)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    parent.postMessage({ type: 'request', id, method, args })
  })
}

async function register(kind: PluginRegistration['kind'], id: string, definition: Record<string, unknown>, callback?: (...args: any[]) => unknown) {
  const key = `${kind}:${id}`
  if (callbacks.has(key)) throw new PluginError('INVALID_ARGUMENT', '注册 ID 重复。')
  if (callback) callbacks.set(key, callback)
  try { await rpc('register', kind, id, definition) } catch (error) { callbacks.delete(key); throw error }
  let disposed = false
  return context.register(async () => {
    if (disposed) return
    disposed = true
    callbacks.delete(key)
    await rpc('unregister', kind, id).catch(() => {})
  })
}

function makeContext(init: { manifest: PluginContext['manifest']; app: PluginContext['app'] }): PluginContext {
  return {
    ...init,
    signal: abort.signal,
    register(resource) {
      let disposed = false
      const dispose = async () => {
        if (disposed) return
        disposed = true
        if (typeof resource === 'function') await resource()
        else await resource.dispose()
      }
      resources.push(dispose)
      return { dispose }
    },
    commands: {
      register: ({ callback, ...definition }) => register('command', definition.id, definition, callback),
      execute: (id, commandContext) => rpc('commands.execute', id, commandContext)
    },
    workspace: {
      getActiveDocument: (windowId) => rpc('workspace.getActiveDocument', windowId),
      listDocuments: () => rpc('workspace.listDocuments'),
      openFile: (path, windowId) => rpc('workspace.openFile', path, windowId),
      createDocument: (markdown, windowId) => rpc('workspace.createDocument', markdown, windowId)
    },
    editor: {
      getDocument: (id) => rpc('editor.getDocument', id),
      edit: (transaction) => rpc('editor.edit', transaction),
      setSelection: (...args) => rpc('editor.setSelection', ...args),
      undo: (id) => rpc('editor.undo', id),
      redo: (id) => rpc('editor.redo', id)
    },
    metadata: { get: (id) => rpc('metadata.get', id) },
    files: {
      resolve: (...args) => rpc('files.resolve', ...args),
      readText: (path) => rpc('files.readText', path),
      readBinary: (path) => rpc('files.readBinary', path),
      list: (path) => rpc('files.list', path),
      stat: (path) => rpc('files.stat', path),
      writeText: (...args) => rpc('files.writeText', ...args),
      createFolder: (path) => rpc('files.createFolder', path),
      trash: (path) => rpc('files.trash', path)
    },
    events: { on: (event, callback) => register('event', `${event}.${++sequence}`, { event }, callback) },
    links: { register: (callback) => register('link', `handler.${++sequence}`, {}, callback) },
    ui: {
      registerView: (view, onMessage) => register('view', view.id, { ...view }, onMessage),
      openView: (...args) => rpc('ui.openView', ...args),
      closeView: (...args) => rpc('ui.closeView', ...args),
      registerButton: (button) => register('button', button.id, { ...button }),
      notice: (...args) => rpc('ui.notice', ...args),
      dialog: (...args) => rpc('ui.dialog', ...args)
    },
    settings: {
      register: (definition) => register('settings', definition.id, { ...definition }),
      read: () => rpc('settings.read'),
      save: (values) => rpc('settings.save', values)
    },
    storage: { get: (key) => rpc('storage.get', key), set: (key, value) => rpc('storage.set', key, value), remove: (key) => rpc('storage.remove', key) },
    markdown: {
      registerCodeBlock: ({ render, ...definition }) => register('renderer', definition.id, definition, render),
      render: (...args) => rpc('markdown.render', ...args)
    },
    desktop: {
      chooseFile: (...args) => rpc('desktop.chooseFile', ...args),
      openExternal: (url) => rpc('desktop.openExternal', url),
      revealFile: (path) => rpc('desktop.revealFile', path),
      readClipboardText: () => rpc('desktop.readClipboardText'),
      writeClipboardText: (text) => rpc('desktop.writeClipboardText', text)
    },
    network: {
      async request(url, options = {}) {
        if (!init.manifest.permissions.includes('network')) throw new PluginError('PERMISSION_DENIED', '插件未声明 network 权限。')
        const parsed = new URL(url)
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new PluginError('INVALID_ARGUMENT', '请求仅支持 HTTP(S)。')
        const response = await fetch(url, { ...options, signal: AbortSignal.any([abort.signal, options.signal ?? AbortSignal.timeout(15000)]) })
        const reader = response.body?.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        if (reader) for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new PluginError('INVALID_ARGUMENT', '网络响应超过上限。') }
          chunks.push(part.value)
        }
        return { status: response.status, text: Buffer.concat(chunks).toString('utf8') }
      }
    },
    log: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message: string) => parent.postMessage({ type: 'log', level, message: String(message).slice(0, 8000) })])) as PluginContext['log']
  }
}

async function stop(): Promise<void> {
  if (stopped) return
  stopped = true
  abort.abort()
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new PluginError('PLUGIN_DISABLED', '插件停用。')) }
  pending.clear()
  try { await plugin?.deactivate?.() } finally {
    for (const dispose of resources.reverse()) try { await dispose() } catch (error) { parent.postMessage({ type: 'log', level: 'warn', message: String(error) }) }
    callbacks.clear()
    parent.postMessage({ type: 'stopped' })
  }
}

parent.on('message', (event) => {
  const message = event.data as { type: string; id?: string; value?: unknown; error?: PluginResponse['error']; init?: Parameters<typeof makeContext>[0]; entry?: string; key?: string; args?: unknown[] }
  if (message.type === 'response') {
    const request = pending.get(message.id!)
    if (!request) return
    pending.delete(message.id!)
    clearTimeout(request.timer)
    if (message.error) request.reject(new PluginError(message.error.code as any, message.error.message))
    else request.resolve(message.value)
  } else if (message.type === 'init') {
    context = makeContext(message.init!)
    Promise.resolve().then(async () => {
      plugin = requirePlugin(message.entry!) as PluginModule
      if (typeof plugin.activate !== 'function') throw new Error('入口未导出 activate(context)。')
      await plugin.activate(context)
      parent.postMessage({ type: 'ready' })
    }).catch(error => parent.postMessage({ type: 'failed', error: String(error) }))
  } else if (message.type === 'call') {
    Promise.resolve().then(() => {
      const callback = callbacks.get(message.key!)
      if (!callback || stopped) throw new PluginError('PLUGIN_DISABLED', '入口已被移除。')
      return callback(...(message.args ?? []))
    }).then(value => parent.postMessage({ type: 'result', id: message.id, value }), error => parent.postMessage({ type: 'result', id: message.id, error: { code: error?.code ?? 'PLUGIN_FAILED', message: String(error?.message ?? error) } }))
  } else if (message.type === 'stop') {
    stop().catch(error => { parent.postMessage({ type: 'log', level: 'error', message: String(error) }); parent.postMessage({ type: 'stopped' }) })
  }
})
