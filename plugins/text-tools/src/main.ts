import type { PluginContext } from '@marktext/plugin-sdk'

export async function activate(ctx: PluginContext): Promise<void> {
  await ctx.commands.register({
    id: 'uppercase', name: '把选中文字转为大写', hotkey: 'Ctrl+Alt+U',
    async callback({ document, windowId }) {
      if (!document?.selection) { await ctx.ui.notice('请先选择文字。', windowId); return }
      const from = Math.min(document.selection.anchor, document.selection.head)
      const to = Math.max(document.selection.anchor, document.selection.head)
      if (from === to) return
      const text = document.markdown.slice(from, to).toUpperCase()
      await ctx.editor.edit({ documentId: document.id, expectedRevision: document.revision, changes: [{ from, to, text }], selection: { anchor: from, head: from + text.length } })
    }
  })
  await ctx.ui.registerButton({ id: 'uppercase', commandId: 'uppercase', label: '选中文字转大写', icon: 'Aa', placement: 'toolbar' })
}
