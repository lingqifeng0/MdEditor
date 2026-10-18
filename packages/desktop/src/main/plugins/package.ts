import fs from 'fs/promises'
import path from 'path'
import { inflateRawSync, deflateRawSync } from 'zlib'
import { PluginError } from '@shared/plugin-api'

export const PACKAGE_LIMITS = { bytes: 128 * 1024 * 1024, file: 32 * 1024 * 1024, count: 2048 }
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i
  for (let bit = 0; bit < 8; bit++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function invalid(message: string): never { throw new PluginError('INVALID_PACKAGE', message) }
export const validatePluginId = (id: unknown): string => {
  if (typeof id !== 'string' || id.length > 100 || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id)) {
    invalid('插件 ID 必须是小写的命名空间，例如 local.example。')
  }
  return id as string
}
export const safePackagePath = (name: string): string => {
  if (!name || name.length > 240 || /[\\:]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32) || name.startsWith('/')) invalid('包内路径无效。')
  const parts = name.replace(/\/$/, '').split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) ||
    /[<>"|?*]/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) invalid('包内路径包含非法名称或越界路径。')
  return name
}

/** Fully validate before extracting, including local headers, CRC and bounded inflation. */
export const readZip = (buffer: Buffer): Map<string, Buffer> => {
  if (buffer.length < 22 || buffer.length > PACKAGE_LIMITS.bytes) invalid('压缩包大小无效。')
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break }
  }
  if (end < 0) invalid('找不到 ZIP 目录。')
  const count = buffer.readUInt16LE(end + 10)
  const directorySize = buffer.readUInt32LE(end + 12)
  const directoryStart = buffer.readUInt32LE(end + 16)
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== buffer.readUInt16LE(end + 8) ||
      !count || count > PACKAGE_LIMITS.count || directoryStart + directorySize !== end) invalid('不支持分卷或 ZIP64，或目录无效。')
  const names = new Set<string>()
  const files = new Map<string, Buffer>()
  const occupied: Array<[number, number]> = []
  let cursor = directoryStart
  let total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) invalid('ZIP 文件目录损坏。')
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressed = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const attributes = buffer.readUInt32LE(cursor + 38)
    const offset = buffer.readUInt32LE(cursor + 42)
    if (cursor + 46 + nameLength + extraLength + commentLength > end || flags & ~0x0808 || ![0, 8].includes(method) ||
        buffer.readUInt16LE(cursor + 34) || size > PACKAGE_LIMITS.file || compressed > PACKAGE_LIMITS.file ||
        (attributes >>> 28) === 10 || (attributes & 0x400)) invalid('包内有不支持的文件、链接或加密条目。')
    const bytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = safePackagePath(bytes.toString('utf8'))
    if (!Buffer.from(name, 'utf8').equals(bytes) || (!(flags & 0x800) && bytes.some(b => b > 127))) invalid('文件名编码无效。')
    const key = name.replace(/\/$/, '').toLowerCase()
    if (names.has(key)) invalid('包内有 Windows 大小写重复名称。')
    names.add(key)
    if (offset + 30 > directoryStart || buffer.readUInt32LE(offset) !== 0x04034b50 ||
      buffer.readUInt16LE(offset + 6) !== flags || buffer.readUInt16LE(offset + 8) !== method) invalid('ZIP 本地条目损坏。')
    const localName = buffer.readUInt16LE(offset + 26)
    const localExtra = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + localName + localExtra
    if (start + compressed > directoryStart || !buffer.subarray(offset + 30, offset + 30 + localName).equals(bytes)) invalid('ZIP 条目路径或长度不一致。')
    if (occupied.some(([a, b]) => offset < b && start + compressed > a)) invalid('ZIP 条目相互重叠。')
    occupied.push([offset, start + compressed])
    total += size
    if (total > PACKAGE_LIMITS.bytes) invalid('解压后的数据超过上限。')
    let content: Buffer
    try { content = method === 0 ? buffer.subarray(start, start + compressed) : inflateRawSync(buffer.subarray(start, start + compressed), { maxOutputLength: Math.max(1, size) }) } catch { invalid('解压失败或文件超出声明长度。') }
    if (content!.length !== size || crc32(content!) !== crc || (name.endsWith('/') && size)) invalid('文件 CRC 或长度不一致。')
    if (!name.endsWith('/')) files.set(name, content!)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== end) invalid('ZIP 目录长度不一致。')
  for (const name of files.keys()) {
    const parts = name.toLowerCase().split('/')
    for (let n = 1; n < parts.length; n++) if ([...files.keys()].some(k => k.toLowerCase() === parts.slice(0, n).join('/'))) invalid('文件与目录名称冲突。')
  }
  return files
}

export const writeZip = (files: Map<string, Buffer>): Buffer => {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of files) {
    const filename = Buffer.from(safePackagePath(name))
    const compressed = deflateRawSync(content)
    const crc = crc32(content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(content.length, 22)
    header.writeUInt16LE(filename.length, 26)
    local.push(header, filename, compressed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(compressed.length, 20)
    entry.writeUInt32LE(content.length, 24)
    entry.writeUInt16LE(filename.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, filename)
    offset += header.length + filename.length + compressed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  const result = Buffer.concat([...local, directory, end])
  readZip(result)
  return result
}

export const rejectLinks = async(root: string): Promise<void> => {
  try {
    const stat = await fs.lstat(root)
    if (stat.isSymbolicLink()) invalid('插件目录不能使用符号链接或目录联接。')
    if (stat.isDirectory()) for (const name of await fs.readdir(root)) await rejectLinks(path.join(root, name))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
export const collectFiles = async(root: string): Promise<Map<string, Buffer>> => {
  await rejectLinks(root)
  const files = new Map<string, Buffer>()
  let total = 0
  const visit = async(directory: string, prefix = ''): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative + '/')
      else if (entry.isFile()) {
        const filename = path.join(directory, entry.name)
        const stat = await fs.stat(filename)
        total += stat.size
        if (stat.size > PACKAGE_LIMITS.file || total > PACKAGE_LIMITS.bytes || files.size >= PACKAGE_LIMITS.count) invalid('插件目录的数据超过上限。')
        files.set(safePackagePath(relative), await fs.readFile(filename))
      } else invalid('插件包包含不支持的文件类型。')
    }
  }
  await visit(root)
  return files
}
