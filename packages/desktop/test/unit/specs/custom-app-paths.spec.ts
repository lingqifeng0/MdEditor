import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const { getPath, setPath } = vi.hoisted(() => ({ getPath: vi.fn(), setPath: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath, setPath } }))

import AppPaths from 'main_renderer/app/paths'

describe('custom app data isolation', () => {
  beforeEach(() => {
    getPath.mockReset()
    setPath.mockClear()
    getPath.mockImplementation((name: string) => name === 'appData' ? path.resolve('AppData') : path.resolve('AppData/marktext'))
  })

  it('keeps settings, sessions and logs in the custom directory for installer and ZIP builds', () => {
    const paths = new AppPaths()
    const expected = path.resolve('AppData/MarkTextToolbar')
    expect(paths.userDataPath).toBe(expected)
    expect(paths.preferencesPath).toBe(expected)
    expect(paths.editorBufferStorePath).toBe(path.join(expected, 'editorStates'))
    expect(setPath).toHaveBeenCalledWith('userData', expected)
    expect(getPath).not.toHaveBeenCalledWith('userData')
  })

  it('preserves an explicitly supplied test profile', () => {
    const profile = path.resolve('test-profiles/独立 profile')
    expect(new AppPaths(profile).userDataPath).toBe(profile)
    expect(setPath).toHaveBeenCalledWith('userData', profile)
  })
})
