import type { PluginContext, Json } from '@marktext/plugin-sdk'

export async function activate(ctx: PluginContext): Promise<void> {
  await ctx.settings.register({ id: 'general', title: '界面示例自己的设置', fields: [{ key: 'greeting', label: '问候语', type: 'text', default: '你好，MarkText' }, { key: 'compact', label: '紧凑显示', type: 'toggle', default: true }] })
  await ctx.ui.registerView({ id: 'advanced', title: '自定义设置页面', placement: 'settings', html: 'settings.html' }, async message => {
    const action = message as { action: string; greeting?: string }
    if (action.action === 'read') return await ctx.settings.read()
    if (action.action === 'save') { const settings = await ctx.settings.read(); await ctx.settings.save({ ...settings, greeting: action.greeting ?? '' }); return true }
    return null
  })
  await ctx.settings.register({ id: 'advanced', title: '插件提供的 HTML 设置界面', viewId: 'advanced' })
  await ctx.ui.registerView({ id: 'outline', title: '独立插件侧栏', placement: 'sidebar', html: 'view.html' }, async (message, context) => {
    const action = message as { action: string }
    if (action.action === 'inspect') {
      const settings = await ctx.settings.read()
      const document = await ctx.workspace.getActiveDocument(context.windowId)
      const headings = document ? (await ctx.metadata.get(document.id)).headings : []
      return { greeting: settings.greeting ?? '', headings: headings as unknown as Json }
    }
    if (action.action === 'dialog') return await ctx.ui.dialog({ title: '插件自己的对话框', message: '这个入口由通用 SDK 注册，宿主不知道插件的业务内容。', buttons: ['关闭'], cancelId: 0 }, context.windowId)
    return null
  })
  await ctx.commands.register({ id: 'open', name: '打开界面示例侧栏', callback: context => ctx.ui.openView('outline', null, context.windowId) })
  await ctx.ui.registerButton({ id: 'open', label: '界面示例', icon: '▤', commandId: 'open', placement: 'toolbar' })
  await ctx.ui.registerButton({ id: 'status', label: '状态栏界面示例', icon: 'UI', commandId: 'open', placement: 'statusbar' })
  await ctx.markdown.registerCodeBlock({ id: 'callout', language: 'plugin-callout', render: ({ markdown }) => `<aside>${markdown.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)}</aside>` })
}
