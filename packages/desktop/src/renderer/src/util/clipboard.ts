import { isLinux } from './index'

export const guessClipboardFilePath = async(): Promise<string> => {
  if (isLinux) return ''
  try {
    const result = await window.electron.clipboard.guessFilePath()
    return typeof result === 'string' ? result : ''
  } catch {
    return ''
  }
}

export async function clipboardImageSource(): Promise<string | null> {
  const path = await guessClipboardFilePath()
  if (path && await window.fileUtils.isImageFile(path) && await window.fileUtils.isFile(path)) return path
  return window.electron.clipboard.readImage()
}
