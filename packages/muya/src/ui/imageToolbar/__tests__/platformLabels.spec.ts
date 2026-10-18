import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('../../../config/index');
    vi.resetModules();
});

describe('image file reveal labels', () => {
    it.each([
        ['win32', false, true, '在资源管理器中显示', 'Show Image in File Explorer'],
        ['darwin', true, false, '在 Finder 中显示', 'Show Image in Finder'],
        ['linux', false, false, '在文件夹中显示', 'Show Image in Folder'],
    ])('uses the %s platform name for both tooltip and accessibility', async (_platform, isOsx, isWin, ariaLabel, tooltip) => {
        vi.resetModules();
        vi.doMock('../../../config/index', () => ({ isOsx, isWin }));
        const { default: icons } = await import('../config');
        expect(icons.find(icon => icon.type === 'reveal')).toMatchObject({ ariaLabel, tooltip });
    });
});
