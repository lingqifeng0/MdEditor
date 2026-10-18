import { PLUGIN_PERMISSIONS, PluginError, type PluginManifest } from '@shared/plugin-api'
import { safePackagePath, validatePluginId } from './package'

export function validateManifest(value: unknown, files?: Map<string, Buffer>): PluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginError('INVALID_PACKAGE', 'manifest.json 必须是对象。')
  const m = value as Record<string, unknown>
  if (m.formatVersion !== 2 || m.apiVersion !== 2 || m.isDesktopOnly !== true) throw new PluginError('INCOMPATIBLE_API', '此平台只加载 SDK 2 桌面插件，旧 SDK 1 插件需要独立适配。')
  const allowed = ['formatVersion', 'apiVersion', 'id', 'name', 'version', 'description', 'author', 'main', 'permissions', 'isDesktopOnly']
  if (Object.keys(m).some(key => !allowed.includes(key))) throw new PluginError('INVALID_PACKAGE', 'manifest 含未定义的字段。')
  validatePluginId(m.id)
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100 || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version)) throw new PluginError('INVALID_PACKAGE', '插件名称或版本无效。')
  for (const key of ['description', 'author']) if (m[key] !== undefined && (typeof m[key] !== 'string' || (m[key] as string).length > 2000)) throw new PluginError('INVALID_PACKAGE', '插件说明无效。')
  if (typeof m.main !== 'string' || !safePackagePath(m.main).endsWith('.cjs') || (files && !files.get(m.main)?.length)) throw new PluginError('INVALID_PACKAGE', '插件入口必须是存在的包内 .cjs 文件。')
  if (!Array.isArray(m.permissions) || m.permissions.length > PLUGIN_PERMISSIONS.length || new Set(m.permissions).size !== m.permissions.length || m.permissions.some(p => !PLUGIN_PERMISSIONS.includes(p))) throw new PluginError('INVALID_PACKAGE', '插件权限声明无效。')
  return m as unknown as PluginManifest
}

export function manifestFromFiles(files: Map<string, Buffer>): PluginManifest {
  const raw = files.get('manifest.json')
  if (!raw || raw.length > 65536) throw new PluginError('INVALID_PACKAGE', '需要根目录 manifest.json。')
  let parsed: unknown
  try { parsed = JSON.parse(raw.toString('utf8')) } catch { throw new PluginError('INVALID_PACKAGE', 'manifest.json 无法解析。') }
  return validateManifest(parsed, files)
}
