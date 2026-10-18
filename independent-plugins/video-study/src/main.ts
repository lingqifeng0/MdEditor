import type { PluginContext, Json } from '../sdk'
import { current, errorMessage, StudyError } from './common'
import { ReplayController, type ControllerOptions } from './controller'
import { displayTime, ownsLink } from './links'
import { NativeHelper, type NativeBridge } from './native'
import { normalizeSettings, portablePlayerPath, type Settings } from './settings'

let active: ReplayController | null = null

function settingsJson(value: Settings): Record<string, Json> {
  return {
    schemaVersion: 2, playerPath: value.playerPath,
    autoPlay: value.autoPlay, bringToFront: value.bringToFront
  }
}

/** The dependency argument is used by quiet protocol tests, never by the host. */
export async function setup(
  ctx: PluginContext,
  native: NativeBridge,
  overrides: Partial<ControllerOptions> = {}
): Promise<ReplayController> {
  if (!ctx.manifest.permissions.includes('editor.read')) {
    throw new StudyError('MISSING_PERMISSION', '视频回看插件必须声明 editor.read，才能取得原笔记路径。请更新插件包。')
  }
  let dark = true
  let requestId = 0
  const controller = new ReplayController({
    application: ctx.app.paths.application,
    data: ctx.app.paths.data,
    native,
    readSettings: async () => normalizeSettings(await ctx.settings.read()),
    readSession: () => ctx.storage.get('mpv-session-v2'),
    saveSession: session => ctx.storage.set('mpv-session-v2', {
      endpoint: session.endpoint, executable: session.executable,
      identity: { pid: session.identity.pid, executable: session.identity.executable, started: session.identity.started }
    }),
    log: message => ctx.log.warn(message),
    ...overrides
  })
  const stop = (): void => { ++requestId; controller.dispose() }
  ctx.signal.addEventListener('abort', stop, { once: true })
  ctx.register(() => { ctx.signal.removeEventListener('abort', stop); stop() })
  const notice = (message: string, windowId: number): void => {
    if (!ctx.signal.aborted) void ctx.ui.notice(message, windowId).catch(error => ctx.log.warn(errorMessage(error)))
  }

  await ctx.ui.registerView({
    id: 'settings', title: '视频回看设置', placement: 'settings', html: 'settings.html'
  }, async (message, context): Promise<Json> => {
    current(ctx.signal)
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('设置请求无效。')
    const action = message.action
    if (action === 'theme') return { dark }
    if (action === 'read') {
      try {
        return { ok: true, settings: settingsJson(normalizeSettings(await ctx.settings.read())), dark, application: ctx.app.paths.application }
      } catch (error) {
        return {
          ok: false, message: errorMessage(error), settings: settingsJson(normalizeSettings({})),
          dark, application: ctx.app.paths.application
        }
      }
    }
    if (action === 'choose') {
      const choices = await ctx.desktop.chooseFile({ title: '选择播放器程序（.exe）', extensions: ['exe'], multiple: false }, context.windowId)
      current(ctx.signal)
      if (!choices.length) return { ok: true, cancelled: true }
      const checked = await controller.checkPlayer(normalizeSettings({ playerPath: choices[0] }), ctx.signal)
      return {
        ok: true, playerPath: portablePlayerPath(checked.file, ctx.app.paths.application),
        resolved: checked.file, version: checked.version
      }
    }
    if (action === 'save' || action === 'check') {
      if (typeof message.playerPath !== 'string' || typeof message.autoPlay !== 'boolean' || typeof message.bringToFront !== 'boolean') {
        throw new Error('请提供播放器路径和两个播放选项。')
      }
      const settings = normalizeSettings(message)
      const checked = await controller.checkPlayer(settings, ctx.signal)
      current(ctx.signal)
      settings.playerPath = portablePlayerPath(checked.file, ctx.app.paths.application)
      if (action === 'save') {
        ++requestId
        controller.cancel()
        await ctx.settings.save(settingsJson(settings))
      }
      return { ok: true, settings: settingsJson(settings), resolved: checked.file, version: checked.version }
    }
    throw new Error('未知设置操作。')
  })
  await ctx.settings.register({ id: 'video', title: '播放器与回看行为', viewId: 'settings' })
  // Preferences embeds this settings view. No extra command menu or editor button.
  await ctx.events.on('theme-changed', event => { dark = event.dark })
  await ctx.events.on('settings-changed', () => { ++requestId; controller.cancel() })
  await ctx.links.register(context => {
    if (!ownsLink(context.href)) return false
    const id = ++requestId
    try {
      const task = controller.request(context.href, context.document?.path ?? null)
      void task.then(result => {
        if (result && id === requestId && !ctx.signal.aborted) {
          notice('视频已定位到 ' + displayTime(result.seconds) + (result.playing ? '，开始播放。' : '，保持暂停。'), context.windowId)
        }
      }).catch(error => {
        if (id === requestId && !ctx.signal.aborted) {
          ctx.log.warn(errorMessage(error))
          notice(errorMessage(error), context.windowId)
        }
      })
    } catch (error) {
      controller.cancel()
      ctx.log.warn(errorMessage(error))
      notice(errorMessage(error), context.windowId)
    }
    return true
  })
  // This prepares only our small identity helper, never mpv or a video.
  void native.prepare().catch(error => {
    if (!ctx.signal.aborted) ctx.log.warn('身份检查预热失败：' + errorMessage(error))
  })
  return controller
}

export async function activate(ctx: PluginContext): Promise<void> {
  active?.dispose()
  active = await setup(ctx, new NativeHelper(ctx.app.paths.code))
}

export function deactivate(): void {
  active?.dispose()
  active = null
}
