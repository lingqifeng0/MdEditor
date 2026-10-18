import path from 'node:path'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import iconv from 'iconv-lite'
import { localImagePathCandidates } from 'common/imageFilePath'
import type { PrepareImageDirectoryRequest, PrepareImageDirectoryResult } from '@shared/types/ipc'

const exists = async(pathname: string): Promise<boolean> => {
  try { await stat(pathname); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function prepareNoteImageDirectory(request: PrepareImageDirectoryRequest): Promise<PrepareImageDirectoryResult> {
  const source = request.pathname
  const candidate = source || request.destination || ''
  if (!path.isAbsolute(candidate) || !/\.(?:md|markdown)$/i.test(candidate) || typeof request.markdown !== 'string') {
    return { ok: false, error: '请选择有效的 Markdown 保存位置。' }
  }
  const stem = path.basename(candidate, path.extname(candidate))
  const parent = path.dirname(candidate)
  const equalName = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  const directory = equalName(path.basename(parent), stem) ? parent : path.join(parent, stem)
  const destination = path.join(directory, path.basename(candidate))
  const assets = path.join(directory, 'assets')
  const createdFiles: string[] = []
  const createdDirectories: string[] = []
  const ensureDirectory = async(dir: string): Promise<void> => {
    if (await exists(dir)) {
      if (!(await stat(dir)).isDirectory()) throw new Error(`该位置是文件，无法创建目录：${dir}`)
      return
    }
    await ensureDirectory(path.dirname(dir))
    await mkdir(dir)
    createdDirectories.push(dir)
  }
  try {
    if (source && (!path.isAbsolute(source) || !(await stat(source)).isFile())) throw new Error('原笔记文件不存在，请先另存为。')
    if (destination !== source && await exists(destination)) throw new Error(`同名目录中已有笔记，已停止以避免覆盖：${destination}`)
    await ensureDirectory(assets)
    if (source && destination !== source) {
      // Preserve source text and the pending paste's selection by copying only
      // referenced relative files to their equivalent locations, never overwriting.
      for (const src of new Set(request.resources)) {
        if (!src || path.isAbsolute(src) || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) continue
        let original = ''
        for (const file of localImagePathCandidates(src.split(/[?#]/)[0] || '', source)) {
          if (await exists(file) && (await stat(file)).isFile()) { original = file; break }
        }
        if (!original) continue
        const relative = path.relative(path.dirname(source), original)
        const target = path.resolve(directory, relative)
        if (equalName(original, target)) continue
        if (await exists(target)) {
          if (!(await stat(target)).isFile() || !(await readFile(target)).equals(await readFile(original))) {
            throw new Error(`已有图片或附件路径冲突，未移动笔记：${target}`)
          }
          continue
        }
        await ensureDirectory(path.dirname(target))
        await copyFile(original, target, constants.COPYFILE_EXCL)
        createdFiles.push(target)
      }
      await copyFile(source, destination, constants.COPYFILE_EXCL)
      createdFiles.push(destination)
      await unlink(source)
    } else if (!source) {
      const { encoding, lineEnding, adjustLineEndingOnSave } = request.options
      const content = adjustLineEndingOnSave ? request.markdown.replace(/\r\n|\r|\n/g, lineEnding === 'crlf' ? '\r\n' : '\n') : request.markdown
      const buffer = iconv.encode(content, encoding.encoding, { addBOM: encoding.isBom })
      await writeFile(destination, buffer, { flag: 'wx' })
      createdFiles.push(destination)
    }
    return { ok: true, pathname: destination, directory: assets }
  } catch (error) {
    for (const file of createdFiles.reverse()) await unlink(file).catch(() => {})
    for (const dir of createdDirectories.reverse()) await rmdir(dir).catch(() => {})
    return { ok: false, error: error instanceof Error ? error.message : '未能创建笔记目录，请检查路径和写入权限。' }
  }
}
