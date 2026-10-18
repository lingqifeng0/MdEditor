import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent, MenuItem, MenuItemConstructorOptions } from 'electron'
import { APP_REPOSITORY_URL } from 'common/appIdentity'

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }))
vi.mock('electron', () => ({ shell: { openExternal } }))
vi.mock('../../../src/main/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../../src/main/menu/actions/help', () => ({ showAboutDialog: vi.fn() }))

import buildHelpMenu from '../../../src/main/menu/templates/help'

describe('MdEditor project help links', () => {
  beforeEach(() => { openExternal.mockClear() })

  it('omits upstream social and donation actions while keeping source and license entries', () => {
    const items = buildHelpMenu().submenu as MenuItemConstructorOptions[]
    const labels = items.map(item => item.label)
    expect(labels).not.toContain('menu.help.followUs')
    expect(labels).not.toContain('menu.help.support')
    expect(labels).toEqual(expect.arrayContaining(['menu.help.viewSource', 'menu.help.license', 'menu.help.openSourceNotices']))
  })

  it('routes every project action to this repository and Markdown reference to CommonMark', () => {
    const items = buildHelpMenu().submenu as MenuItemConstructorOptions[]
    for (const item of items) item.click?.({} as MenuItem, undefined, {} as KeyboardEvent)
    const urls = openExternal.mock.calls.map(([url]) => String(url))
    expect(urls).toContain('https://spec.commonmark.org/')
    const projectUrls = urls.filter(url => url !== 'https://spec.commonmark.org/')
    expect(projectUrls.length).toBeGreaterThanOrEqual(7)
    expect(projectUrls.every(url => url === APP_REPOSITORY_URL || url.startsWith(APP_REPOSITORY_URL + '/'))).toBe(true)
    expect(projectUrls).toEqual(expect.arrayContaining([APP_REPOSITORY_URL + '/blob/main/LICENSE', APP_REPOSITORY_URL + '/blob/main/NOTICE.md', APP_REPOSITORY_URL + '/releases/latest']))
  })
})
