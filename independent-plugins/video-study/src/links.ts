import path from 'node:path'
import fs from 'node:fs/promises'
import { StudyError } from './common'

const extensions = /\.(?:mp4|mkv|mov|avi|webm|m4v|wmv|flv|ts|m2ts|mpg|mpeg|mp3|wav|m4a|aac|flac|ogg|opus)$/i
const unwrap = (href: string): string => href.startsWith('<') && href.endsWith('>') ? href.slice(1, -1) : href

export function ownsLink(href: string): boolean {
  const raw = unwrap(href)
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || !raw.includes('#t')) return false
  try { return extensions.test(decodeURIComponent(raw.split('#', 1)[0])) } catch { return false }
}

export function parseLink(href: string, documentPath: string | null): { file: string; seconds: number } {
  const raw = unwrap(href)
  const match = /^([^#]+)#t=((?:0|[1-9]\d*)(?:\.\d{1,3})?)$/.exec(raw)
  if (!match) throw new StudyError('BAD_TIMESTAMP', '时间戳需要使用 #t=非负秒数，最多三位小数。')
  if (!documentPath || !path.isAbsolute(documentPath)) {
    throw new StudyError('NOTE_UNSAVED', '请先保存这篇笔记，再打开相对视频时间戳。')
  }
  let decoded: string
  try { decoded = decodeURIComponent(match[1]) } catch {
    throw new StudyError('BAD_REFERENCE', '视频路径的字符编码无效。')
  }
  if (!extensions.test(decoded) || path.isAbsolute(decoded) ||
      /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /^[\\\/]/.test(decoded) ||
      /[\u0000-\u001f]/.test(decoded) || match[1].includes('?')) {
    throw new StudyError('BAD_REFERENCE', '回看链接需要引用相对于这篇 Markdown 的本地视频。')
  }
  const seconds = Number(match[2])
  if (!Number.isFinite(seconds) || seconds > 7 * 24 * 3600) {
    throw new StudyError('BAD_TIMESTAMP', '时间戳超出支持范围。')
  }
  return { file: path.resolve(path.dirname(documentPath), decoded), seconds }
}

export async function resolveMedia(file: string): Promise<string> {
  try {
    const actual = await fs.realpath(file)
    if (!(await fs.stat(actual)).isFile()) throw new Error('not a file')
    return actual
  } catch { throw new StudyError('MEDIA_MISSING', '笔记引用的视频不存在：' + file) }
}

export function samePath(a: unknown, b: string): boolean {
  return typeof a === 'string' && path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
}

export function displayTime(seconds: number): string {
  const total = Math.round(seconds * 1000)
  const whole = Math.floor(total / 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const fraction = total % 1000
  return pad(Math.floor(whole / 3600)) + ':' + pad(Math.floor(whole / 60) % 60) + ':' +
    pad(whole % 60) + (fraction ? '.' + String(fraction).padStart(3, '0') : '')
}
