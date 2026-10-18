const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require(process.argv[2] || 'sharp')

const desktop = path.resolve(__dirname, '../packages/desktop')
const master = path.join(desktop, 'build/branding/icon-master.png')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

async function main() {
  const metadata = await sharp(master).metadata()
  if (metadata.width !== metadata.height) throw new Error('The approved icon canvas must be square')
  const frames = new Map()
  for (const size of sizes) frames.set(size, await sharp(master).resize(size, size).png().toBuffer())
  const write = async (relative, data) => {
    const target = path.join(desktop, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, data)
  }
  for (const size of sizes.filter(size => size <= 512)) {
    for (const name of ['marktext', 'md']) await write(`build/icons/${size}x${size}/${name}.png`, frames.get(size))
  }
  const icoSizes = sizes.filter(size => size <= 256)
  const header = Buffer.alloc(6 + icoSizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(icoSizes.length, 4)
  let offset = header.length
  icoSizes.forEach((size, index) => {
    const frame = frames.get(size)
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = header[entry]
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  })
  const ico = Buffer.concat([header, ...icoSizes.map(size => frames.get(size))])
  for (const relative of ['static/icon.ico', 'build/icons/icon.ico', 'build/icons/md.ico']) await write(relative, ico)
  const icnsChunks = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, type]) => {
    const frame = frames.get(size)
    const chunk = Buffer.alloc(8)
    chunk.write(type)
    chunk.writeUInt32BE(frame.length + 8, 4)
    return Buffer.concat([chunk, frame])
  })
  const icnsHeader = Buffer.alloc(8)
  icnsHeader.write('icns')
  icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  const icns = Buffer.concat([icnsHeader, ...icnsChunks])
  for (const relative of ['static/icon.icns', 'build/icons/icon.icns', 'build/icons/md.icns']) await write(relative, icns)
  for (const relative of ['static/icon.png', 'build/icons/icon.png', 'src/renderer/src/assets/images/logo.png']) await write(relative, frames.get(512))
  await write('static/logo-96px.png', await sharp(master).resize(96, 96).png().toBuffer())
  await write('static/logo-small.png', frames.get(32))
  await write('build/icons/md.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${frames.get(512).toString('base64')}"/></svg>\n`))
  console.log(JSON.stringify({ master, canvas: [metadata.width, metadata.height], icoSizes, pngSizes: sizes.filter(size => size <= 512), updated: ['application', 'taskbar', 'about', 'Markdown file associations'] }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
