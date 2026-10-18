import { extname } from 'pathe'

export const getRenamedFilename = (name: string, originalFilename: string): string | null => {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    /[/\\:*?"<>|]/.test(trimmed) ||
    Array.from(trimmed).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    trimmed.endsWith('.')
  ) {
    return null
  }

  const extension = extname(originalFilename)
  const filename =
    extension && !trimmed.toLowerCase().endsWith(extension.toLowerCase())
      ? trimmed + extension
      : trimmed
  if (
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ||
    new TextEncoder().encode(filename).length > 255
  ) {
    return null
  }
  return filename
}
