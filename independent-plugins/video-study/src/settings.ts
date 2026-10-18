import path from 'node:path'
import fs from 'node:fs/promises'
import { StudyError } from './common'

export interface Settings {
  schemaVersion: 2
  playerPath: string
  autoPlay: boolean
  bringToFront: boolean
}

export function normalizeSettings(raw: Record<string, unknown>): Settings {
  let selected: unknown = raw.playerPath
  if (selected === undefined && raw.player && typeof raw.player === 'object') {
    const old = raw.player as { base?: unknown; path?: unknown }
    if (old.base !== undefined && old.base !== 'marktextExecutableDir') {
      throw new StudyError('BAD_SETTINGS', '旧播放器设置的路径基准不受支持，请重新选择播放器。')
    }
    selected = old.path
  }
  if (selected !== undefined && typeof selected !== 'string') {
    throw new StudyError('BAD_SETTINGS', '播放器路径设置无效，请重新选择。')
  }
  if (raw.autoPlay !== undefined && typeof raw.autoPlay !== 'boolean') {
    throw new StudyError('BAD_SETTINGS', '播放状态设置无效。')
  }
  if (raw.bringToFront !== undefined && typeof raw.bringToFront !== 'boolean') {
    throw new StudyError('BAD_SETTINGS', '窗口显示设置无效。')
  }
  return {
    schemaVersion: 2,
    playerPath: typeof selected === 'string' ? selected.trim() : '',
    autoPlay: typeof raw.autoPlay === 'boolean' ? raw.autoPlay : raw.afterSeek !== 'pause',
    bringToFront: typeof raw.bringToFront === 'boolean' ? raw.bringToFront : true
  }
}

export async function resolvePlayer(settings: Settings, application: string): Promise<string> {
  if (!settings.playerPath) throw new StudyError('PLAYER_NOT_SET', '请先打开“视频回看设置”，选择并保存你的播放器程序。')
  const configured = path.resolve(application, settings.playerPath)
  if (path.extname(configured).toLowerCase() !== '.exe') {
    throw new StudyError('WRONG_PLAYER', '请选择 Windows 播放器的 .exe 程序。')
  }
  try {
    const actual = await fs.realpath(configured)
    if (!(await fs.stat(actual)).isFile()) throw new Error('not a file')
    return actual
  } catch { throw new StudyError('PLAYER_MISSING', '播放器程序不存在，请重新选择：' + configured) }
}

export function portablePlayerPath(file: string, application: string): string {
  if (path.parse(file).root.toLowerCase() !== path.parse(application).root.toLowerCase()) {
    return file
  }
  return path.relative(application, file).replace(/\\/g, '/')
}
