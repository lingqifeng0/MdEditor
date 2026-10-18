import type { PluginContext, PluginManifest } from '@marktext/plugin-sdk'
declare const ctx: PluginContext
// @ts-expect-error A player protocol must not become a host API.
ctx.ipc.mpv
// @ts-expect-error Transactions require an exact document revision.
ctx.editor.edit({ documentId: 'test', changes: [] })
// @ts-expect-error Settings retain their concrete value types.
ctx.settings.register({ id: 'test', title: 'test', fields: [{ key: 'enabled', label: 'Enabled', type: 'toggle', default: 'yes' }] })
// @ts-expect-error SDK 1 manifests cannot be mislabelled as compatible.
const incompatible: PluginManifest = { formatVersion: 1, apiVersion: 1, id: 'local.old', name: 'Old', version: '1.0.0', main: 'main.cjs', permissions: [], isDesktopOnly: true }
void incompatible
