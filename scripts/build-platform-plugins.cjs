const path = require('node:path')
const fs = require('node:fs/promises')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const esbuild = require(path.join(root, 'node_modules/esbuild'))

async function main() {
  const sdk = path.join(root, 'docs/plugins/sdk')
  await fs.mkdir(sdk, { recursive: true })
  const compiler = spawnSync(process.execPath, [path.join(root, 'packages/desktop/node_modules/typescript/bin/tsc'), path.join(root, 'packages/desktop/src/shared/plugin-api.ts'), '--declaration', '--emitDeclarationOnly', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--skipLibCheck', '--outDir', sdk], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (compiler.status !== 0) throw new Error('SDK declaration generation failed')
  await fs.rename(path.join(sdk, 'plugin-api.d.ts'), path.join(sdk, 'index.d.ts'))
  await esbuild.build({ entryPoints: [path.join(root, 'packages/desktop/src/shared/plugin-api.ts')], outfile: path.join(sdk, 'index.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22' })
  await fs.writeFile(path.join(sdk, 'package.json'), JSON.stringify({ name: '@marktext/plugin-sdk', version: '2.0.0-dev', main: 'index.cjs', types: 'index.d.ts' }, null, 2) + '\n')
  const output = path.join(root, 'dist/plugins')
  const tools = path.join(root, 'dist/tools')
  await fs.mkdir(output, { recursive: true })
  await fs.mkdir(tools, { recursive: true })
  await esbuild.build({ entryPoints: [path.join(root, 'packages/desktop/src/main/plugins/package.ts')], outfile: path.join(tools, 'package.cjs'), bundle: true, platform: 'node', format: 'cjs', alias: { '@shared/plugin-api': path.join(root, 'packages/desktop/src/shared/plugin-api.ts') } })
  const { writeZip } = require(path.join(tools, 'package.cjs'))
  const plugins = [
    { folder: 'text-tools', id: 'local.text-tools', name: '文字处理示例', permissions: ['editor.read', 'editor.write', 'ui'], description: '通过通用事务修改选中文字，并保留撤销与视口。' },
    { folder: 'ui-example', id: 'local.ui-example', name: '界面扩展示例', permissions: ['editor.read', 'ui'], description: '插件自己的侧栏、按钮、对话框、设置表单和 HTML 设置页。' },
    { folder: 'desktop-example', id: 'local.desktop-example', name: '独立桌面进程示例', permissions: ['ui', 'desktop'], description: '插件自己创建、复用和关闭辅助进程；宿主不包含辅助程序。' }
  ]
  for (const plugin of plugins) {
    const directory = path.join(root, 'plugins', plugin.folder)
    const manifest = { formatVersion: 2, apiVersion: 2, id: plugin.id, name: plugin.name, version: '0.1.0', description: plugin.description, main: 'main.cjs', permissions: plugin.permissions, isDesktopOnly: true }
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    await esbuild.build({ entryPoints: [path.join(directory, 'src/main.ts')], outfile: path.join(directory, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', alias: { '@marktext/plugin-sdk': path.join(sdk, 'index.cjs') } })
    const files = new Map([['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')], ['main.cjs', await fs.readFile(path.join(directory, 'main.cjs'))]])
    for (const name of await fs.readdir(directory)) if (/\.(html|cjs)$/.test(name) && name !== 'main.cjs') files.set(name, await fs.readFile(path.join(directory, name)))
    const filename = `${plugin.id}-${manifest.version}.mtplug`
    await fs.writeFile(path.join(output, filename), writeZip(files))
    console.log(filename)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
