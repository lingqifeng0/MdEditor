import type { PluginContext } from '@marktext/plugin-sdk'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export async function activate(ctx: PluginContext): Promise<void> {
  const child = spawn(process.execPath, [join(ctx.app.paths.code, 'helper.cjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const lines = createInterface({ input: child.stdout })
  const pending = new Map<number, { resolve(value: { value: string; pid: number }): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  let sequence = 0
  lines.on('line', line => {
    const result = JSON.parse(line) as { id: number; value: string; pid: number }
    const request = pending.get(result.id)
    if (!request) return
    pending.delete(result.id)
    clearTimeout(request.timer)
    request.resolve(result)
  })
  child.on('error', error => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }; pending.clear() })
  ctx.register(() => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('插件已停用')) }
    pending.clear()
    lines.close()
    child.stdin.end()
    child.kill()
  })
  await ctx.commands.register({ id: 'query', name: '由独立插件复用自己的辅助进程', async callback(context) {
    const started = performance.now()
    const id = ++sequence
    const value = await new Promise<{ value: string; pid: number }>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('插件自有辅助进程超时')) }, 2000)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, value: '通信完成' }) + '\n')
    })
    await ctx.storage.set('last-query', { value: value.value, helperPid: value.pid, milliseconds: Math.round(performance.now() - started) })
    await ctx.ui.notice(`${value.value}，耗时 ${Math.round(performance.now() - started)} 毫秒；辅助进程由插件创建。`, context.windowId)
  } })
}
