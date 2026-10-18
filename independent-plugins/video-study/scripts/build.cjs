const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { writeZip } = require('./zip.cjs')

const root = path.resolve(__dirname, '..')
const host = process.env.MARKTEXT_SDK_SOURCE
const dependencies = host ? path.resolve(host) : root
const esbuild = require(path.join(dependencies, 'node_modules/esbuild'))
const typescript = host
  ? path.join(dependencies, 'packages/desktop/node_modules/typescript/bin/tsc')
  : path.join(root, 'node_modules/typescript/bin/tsc')
const types = host
  ? path.join(dependencies, 'packages/desktop/node_modules/@types')
  : path.join(root, 'node_modules/@types')

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'))
  const output = path.join(root, 'dist')
  const pkg = path.join(output, 'package')
  await fs.mkdir(pkg, { recursive: true })
  const typecheck = spawnSync(process.execPath, [typescript, '-p', path.join(root, 'tsconfig.json'), '--typeRoots', types], {
    cwd: root, stdio: 'inherit', windowsHide: true
  })
  if (typecheck.status !== 0) throw new Error('TypeScript typecheck failed')
  for (const [entry, filename] of [['main.ts', 'package/main.cjs'], ['testing.ts', 'test-api.cjs']]) {
    await esbuild.build({
      entryPoints: [path.join(root, 'src', entry)], outfile: path.join(output, filename),
      bundle: true, platform: 'node', format: 'cjs', target: 'node22', legalComments: 'none'
    })
  }
  const compiler = process.env.CSC_PATH || 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  const compiled = spawnSync(compiler, [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+',
    '/reference:System.Web.Extensions.dll', '/out:' + path.join(pkg, 'native-helper.exe'),
    path.join(root, 'native/NativeHelper.cs')
  ], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (compiled.status !== 0) throw new Error('Native helper compile failed')
  for (const filename of ['manifest.json', 'settings.html', 'README.md', 'LICENSE', 'NOTICE.md']) {
    await fs.copyFile(path.join(root, filename), path.join(pkg, filename))
  }
  const files = new Map()
  for (const filename of ['manifest.json', 'main.cjs', 'native-helper.exe', 'settings.html', 'README.md', 'LICENSE', 'NOTICE.md']) {
    files.set(filename, await fs.readFile(path.join(pkg, filename)))
  }
  const name = manifest.id + '-' + manifest.version + '.mtplug'
  const packageFile = path.join(output, name)
  await fs.writeFile(packageFile, writeZip(files))
  const sources = new Map()
  async function collect(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (['dist', 'node_modules', '.runtime', '.git'].includes(entry.name)) continue
      const key = prefix + entry.name
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), key + '/')
      else if (entry.isFile()) sources.set(key, await fs.readFile(path.join(directory, entry.name)))
    }
  }
  await collect(root)
  const sourceFile = path.join(output, 'marktext-video-study-sdk2-' + manifest.version + '-src.zip')
  await fs.writeFile(sourceFile, writeZip(sources))
  const hashes = {}
  for (const file of [packageFile, sourceFile]) hashes[path.basename(file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex')
  await fs.writeFile(path.join(output, 'SHA256.json'), JSON.stringify(hashes, null, 2) + '\n')
  console.log(JSON.stringify({ package: packageFile, source: sourceFile, entries: [...files.keys()], hashes }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
