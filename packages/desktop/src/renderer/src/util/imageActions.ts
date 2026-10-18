import type { ImageEditorResult, ImageRevealResult } from '@shared/types/ipc'

export interface ImageActionPayload {
  src: string
  imageId: string
  image?: HTMLImageElement
}

export const selectedImageElement = (root: HTMLElement, imageId: string, image?: HTMLImageElement): HTMLImageElement | null => {
  if (image !== undefined) return image.isConnected && root.contains(image) ? image : null
  const wrapper = document.getElementById(imageId)
  if (!wrapper || !wrapper.isConnected || !root.contains(wrapper)) return null
  return wrapper instanceof HTMLImageElement ? wrapper : wrapper.querySelector('img')
}

export const visibleImagePoint = (
  image: HTMLImageElement,
  viewport: HTMLElement
): { x: number; y: number } | null => {
  if (!image.complete || !image.naturalWidth || !image.isConnected) return null
  const bounds = image.getBoundingClientRect()
  const clip = viewport.getBoundingClientRect()
  const left = Math.max(bounds.left, clip.left, 0)
  const right = Math.min(bounds.right, clip.right, window.innerWidth)
  const top = Math.max(bounds.top, clip.top, 0)
  const bottom = Math.min(bounds.bottom, clip.bottom, window.innerHeight)
  if (right - left < 2 || bottom - top < 2) return null

  // A floating toolbar or resize handle can cover part of the selected image.
  const fractions: Array<[number, number]> = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]]
  for (const [horizontal, vertical] of fractions) {
    const x = left + (right - left) * horizontal
    const y = top + (bottom - top) * vertical
    if (document.elementFromPoint(x, y) === image) return { x, y }
  }
  return null
}

export const copySelectedImage = async(
  root: HTMLElement,
  viewport: HTMLElement,
  payload: ImageActionPayload
): Promise<boolean> => {
  const image = selectedImageElement(root, payload.imageId, payload.image)
  const point = image && visibleImagePoint(image, viewport)
  return point ? window.electron.clipboard.copyImageAt(point.x, point.y) : false
}

export const revealSelectedImage = (
  root: HTMLElement,
  payload: ImageActionPayload,
  documentPath: string
): Promise<ImageRevealResult> => {
  const image = selectedImageElement(root, payload.imageId, payload.image)
  if (!image) return Promise.resolve({ ok: false, error: '所选图片已失效，请重新选择图片。' })
  // The rendered file URL already resolves Markdown escapes, references and the document folder.
  const src = image?.currentSrc || image?.src || payload.src
  return window.electron.ipcRenderer.invoke('mt::image::reveal', src, documentPath)
}

export const openImageInEditor = (src: string, documentPath: string, editorPath: string): Promise<ImageEditorResult> =>
  window.electron.images.openInEditor(src, documentPath, editorPath)

export const openSelectedImageInEditor = (
  root: HTMLElement,
  payload: ImageActionPayload,
  documentPath: string,
  editorPath: string
): Promise<ImageEditorResult> => {
  const image = selectedImageElement(root, payload.imageId, payload.image)
  if (!image) return Promise.resolve({ ok: false, errorCode: 'staleImage' })
  return openImageInEditor(image.currentSrc || image.src || payload.src, documentPath, editorPath)
}
