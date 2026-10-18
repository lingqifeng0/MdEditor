import { shallowRef } from 'vue'

export interface ImageOperationPrompt {
  title: string
  message: string
  confirmLabel?: string
  secondaryLabel?: string
  onConfirm?: () => Promise<boolean>
  error: string
  busy: boolean
}

export const imageOperationPrompt = shallowRef<ImageOperationPrompt | null>(null)
type ImageOperationAnswer = boolean | 'links'
export type ImageRemovalChoice = 'files' | 'links' | 'cancel'
let resolvePrompt: ((answer: ImageOperationAnswer) => void) | null = null

export function askImageOperation(options: Omit<ImageOperationPrompt, 'busy' | 'error'>): Promise<boolean> {
  return openPrompt(options).then(answer => answer === true)
}

function openPrompt(options: Omit<ImageOperationPrompt, 'busy' | 'error'>): Promise<ImageOperationAnswer> {
  if (imageOperationPrompt.value) return Promise.resolve(false)
  imageOperationPrompt.value = { ...options, busy: false, error: '' }
  return new Promise(resolve => { resolvePrompt = resolve })
}

export async function askImageRemoval(kind: 'image' | 'html' = 'image', count = 1): Promise<ImageRemovalChoice> {
  const answer = await openPrompt({
    title: kind === 'html' ? '删除 HTML 块' : '删除图片',
    message: kind === 'html'
      ? `是否同时删除这个 HTML 块中的 ${count} 张关联图片？\n“删除图片和链接”会删除整个块，并将本地图片放入回收站。\n“只删除链接”会删除整个块，保留本地图片。`
      : '请选择如何删除这张图片。\n“删除图片和链接”会移除图片链接，并将本地图片放入回收站。\n“只删除链接”会保留本地图片。',
    confirmLabel: '删除图片和链接',
    secondaryLabel: '只删除链接'
  })
  return answer === true ? 'files' : answer === 'links' ? 'links' : 'cancel'
}

export function finishImageOperation(answer: ImageOperationAnswer): void {
  if (imageOperationPrompt.value?.busy) return
  const resolve = resolvePrompt
  resolvePrompt = null
  imageOperationPrompt.value = null
  resolve?.(answer)
}

export async function confirmImageOperation(): Promise<void> {
  const prompt = imageOperationPrompt.value
  if (!prompt || prompt.busy) return
  imageOperationPrompt.value = { ...prompt, busy: true, error: '' }
  try {
    const completed = await (prompt.onConfirm?.() ?? true)
    if (imageOperationPrompt.value) imageOperationPrompt.value = { ...imageOperationPrompt.value, busy: false }
    if (completed) finishImageOperation(true)
  } catch (error) {
    if (imageOperationPrompt.value) imageOperationPrompt.value = { ...imageOperationPrompt.value, busy: false, error: error instanceof Error ? error.message : '操作失败，请检查文件路径和权限。' }
  }
}
