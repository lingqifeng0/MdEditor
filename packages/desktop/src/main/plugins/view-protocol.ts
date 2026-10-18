import { protocol } from 'electron'
import { randomUUID } from 'node:crypto'

protocol.registerSchemesAsPrivileged([{ scheme: 'marktext-plugin-view', privileges: { standard: true, secure: true } }])
const views = new Map<string, { owner: string; windowId: number; html: string }>()
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'; base-uri 'none'"
const bridge = `<script>
(() => {
  let sequence = 0
  const pending = new Map()
  const listeners = new Set()
  let autoHeight = false
  let previousHeight = 0
  let measurement = 0
  function measureContent() {
    if (!autoHeight || measurement) return
    measurement = requestAnimationFrame(() => {
      measurement = 0
      const body = document.body
      if (!body) return
      const bounds = body.getBoundingClientRect()
      const margin = parseFloat(getComputedStyle(body).marginBottom) || 0
      const height = Math.max(1, Math.ceil(bounds.top + Math.max(bounds.height, body.scrollHeight) + margin))
      if (height === previousHeight) return
      previousHeight = height
      parent.postMessage({ channel: 'marktext-view', type: 'content-height', height }, '*')
    })
  }
  window.marktextView = {
    request(message) {
      const id = String(++sequence)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        parent.postMessage({ channel: 'marktext-view', id, message }, '*')
      })
    },
    onData(callback) { listeners.add(callback); return () => listeners.delete(callback) }
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== 'marktext-view') return
    if (event.data.type === 'layout') {
      autoHeight = event.data.autoHeight === true
      document.documentElement.classList.toggle('marktext-auto-height', autoHeight)
      if (autoHeight) { previousHeight = 0; measureContent() }
      return
    }
    if (event.data.type === 'data') { for (const callback of listeners) callback(event.data.value); return }
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    if (event.data.error) request.reject(new Error(event.data.error))
    else request.resolve(event.data.value)
  })
  addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(measureContent).observe(document.body)
    new MutationObserver(measureContent).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    parent.postMessage({ channel: 'marktext-view', ready: true }, '*')
  })
  addEventListener('resize', measureContent)
  addEventListener('load', measureContent, true)
})()
</script>`

export function registerPluginViewProtocol(): void {
  protocol.handle('marktext-plugin-view', request => {
    const parsed = new URL(request.url)
    const view = parsed.hostname === 'view' ? views.get(parsed.pathname.slice(1)) : undefined
    return new Response(view?.html ?? 'Plugin view closed', { status: view ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } })
  })
}

export function createPluginViewUrl(owner: string, windowId: number, html: string): string {
  if ([...views.values()].filter(view => view.owner === owner).length >= 50) throw new Error('插件视图数量超过上限。')
  const token = randomUUID()
  const document = `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:dark light}body{margin:12px;font:14px system-ui;background:#262626;color:#ddd}button,input,select{font:inherit;padding:6px;background:#343434;color:inherit;border:1px solid #555;border-radius:4px}button{cursor:pointer}html.marktext-auto-height,html.marktext-auto-height body{height:auto!important;min-height:0!important;max-height:none!important;overflow:hidden!important}</style>${bridge}${html}`
  views.set(token, { owner, windowId, html: document })
  return `marktext-plugin-view://view/${token}`
}

export function releasePluginViewUrl(url: string, windowId: number): void {
  const token = new URL(url).pathname.slice(1)
  if (views.get(token)?.windowId === windowId) views.delete(token)
}
export function revokePluginViews(owner: string): void { for (const [token, view] of views) if (view.owner === owner) views.delete(token) }
export function revokeWindowViews(windowId: number): void { for (const [token, view] of views) if (view.windowId === windowId) views.delete(token) }
