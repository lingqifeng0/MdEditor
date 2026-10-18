import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const localImagePathCandidates = (src: string, documentPath: string): string[] => {
  if (!src || typeof src !== 'string') return []
  if (/^file:/i.test(src)) {
    try {
      return [fileURLToPath(new URL(src))]
    } catch {
      return []
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(src) && !path.isAbsolute(src)) return []
  if (src.startsWith('//')) return []
  if (!path.isAbsolute(src) && !path.isAbsolute(documentPath || '')) return []

  const resolve = (value: string): string => path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(path.dirname(documentPath), value)
  const candidates = [resolve(src)]
  // Markdown paths can be URI-encoded; a literal '%' filename takes precedence.
  try {
    const decoded = decodeURIComponent(src)
    if (decoded !== src) candidates.push(resolve(decoded))
  } catch {}
  return [...new Set(candidates)]
}
