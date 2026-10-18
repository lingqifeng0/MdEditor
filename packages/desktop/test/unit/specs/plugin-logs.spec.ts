// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { PluginLogStore, PLUGIN_LOG_BYTES } from '../../../src/main/plugins/logs'

describe('persistent plugin logs', () => {
  let directory: string
  let store: PluginLogStore
  const failed = vi.fn()
  beforeEach(async() => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marktext-plugin-logs-')); failed.mockClear(); store = new PluginLogStore(directory, failed) })
  afterEach(async() => { await store.flushAll(); await fs.rm(directory, { recursive: true, force: true }) })

  it('keeps each plugin separate and persists logs across store restarts', async() => {
    store.record('local.first', 'info', 'first plugin 中文')
    store.record('local.second', 'error', 'second plugin error')
    const first = await store.read('local.first')
    expect(first).toContain('[info] first plugin 中文')
    expect(first).not.toContain('second plugin')
    const restored = new PluginLogStore(directory, failed)
    expect(await restored.read('local.first')).toBe(first)
    expect(await store.read('local.second')).toContain('[error] second plugin error')
  })

  it('serializes concurrent writes and readers without losing accepted messages', async() => {
    const writes: Promise<void>[] = []
    for (let index = 0; index < 50; index++) { store.record('local.first', 'info', `line-${index}`); writes.push(store.flush('local.first')) }
    await Promise.all(writes)
    const text = await store.read('local.first')
    expect(text.split('\n').filter(Boolean)).toHaveLength(50)
    expect(text).toContain('line-0\n')
    expect(text).toContain('line-49\n')
    expect(failed).not.toHaveBeenCalled()
  })

  it('bounds pending and on-disk logs while retaining the latest complete UTF-8 lines', async() => {
    for (let index = 0; index < 80; index++) store.record('local.first', 'info', `record-${index}：${'中文'.repeat(1500)}`)
    store.record('local.first', 'warn', 'latest line')
    const text = await store.read('local.first')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(PLUGIN_LOG_BYTES)
    expect(text).not.toContain('\uFFFD')
    expect(text).not.toContain('record-0：')
    expect(text).toContain('[warn] latest line')
    expect((await fs.stat(path.join(directory, 'local.first/logs/marktext.log'))).size).toBeLessThanOrEqual(PLUGIN_LOG_BYTES)
  })

  it('reads only a bounded tail from oversized existing logs and limits the next write', async() => {
    const target = path.join(directory, 'local.first/logs')
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, 'marktext.log'), 'older\n'.repeat(40000) + 'recent\n')
    const text = await store.read('local.first')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(PLUGIN_LOG_BYTES)
    expect(text).toMatch(/recent\n$/)
    store.record('local.first', 'info', 'next')
    await store.flushAll()
    expect((await fs.stat(path.join(target, 'marktext.log'))).size).toBeLessThanOrEqual(PLUGIN_LOG_BYTES)
  })

  it('rejects invalid plugin IDs before touching the filesystem', async() => {
    expect(() => store.record('../escape', 'info', 'blocked')).toThrow()
    await expect(store.read('LOCAL.invalid')).rejects.toThrow()
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('does not write through linked plugin directories or crash on logging errors', async() => {
    const outside = path.join(directory, 'outside')
    await fs.mkdir(outside)
    await fs.symlink(outside, path.join(directory, 'local.first'), process.platform === 'win32' ? 'junction' : 'dir')
    store.record('local.first', 'error', 'must stay inside plugin data')
    await expect(store.flushAll()).resolves.toBeUndefined()
    expect(failed).toHaveBeenCalledOnce()
    await expect(store.read('local.first')).rejects.toThrow('日志目录')
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('does not follow a linked log file', async() => {
    const logs = path.join(directory, 'local.first/logs')
    await fs.mkdir(logs, { recursive: true })
    const outside = path.join(directory, 'outside')
    await fs.mkdir(outside)
    await fs.symlink(outside, path.join(logs, 'marktext.log'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.read('local.first')).rejects.toThrow('日志文件')
    expect(await fs.readdir(outside)).toEqual([])
  })
})
