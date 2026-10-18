const zlib = require('node:zlib')
// Standard ZIP (deflate, UTF-8 names); no runtime dependency is bundled.
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function writeZip(files) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, value] of files) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(piece => piece === '..')) throw new Error('Unsafe ZIP path')
    const filename = Buffer.from(name, 'utf8')
    const data = zlib.deflateRawSync(value)
    const crc = crc32(value)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(value.length, 22)
    header.writeUInt16LE(filename.length, 26)
    local.push(header, filename, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(value.length, 24)
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42)
    central.push(entry, filename)
    offset += header.length + filename.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
module.exports = { writeZip }
