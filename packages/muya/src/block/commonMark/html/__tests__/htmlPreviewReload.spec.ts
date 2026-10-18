// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

const opened: Muya[] = [];

afterEach(() => {
    for (const muya of opened.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    vi.unstubAllGlobals();
});

describe('local HTML image cache refresh', () => {
    it('refreshes local preview URLs, preserves remote queries and leaves source and undo state unchanged', () => {
        window.MUYA_VERSION = 'test';
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            unobserve() {}
            disconnect() {}
        });
        const source = '<div>\n<img src="file:///C:/Images/photo.png?other=123#part" alt="local">\n<img src="https://example.com/photo.png?other=456" alt="remote">\n</div>';
        const host = document.createElement('div');
        document.body.append(host);
        const muya = new Muya(host, { json: [{ name: 'html-block', text: source }] });
        muya.init();
        opened.push(muya);
        const before = muya.getMarkdown();
        const changes = vi.fn();
        muya.on('json-change', changes);
        muya.invalidateImageCache();
        const local = muya.domNode.querySelector<HTMLImageElement>('img[alt="local"]')!;
        const remote = muya.domNode.querySelector<HTMLImageElement>('img[alt="remote"]')!;
        const url = new URL(local.getAttribute('src')!);
        expect(url.searchParams.get('mucache')).toMatch(/^\d+-1$/);
        expect(url.searchParams.get('other')).toBe('123');
        expect(url.hash).toBe('#part');
        expect(remote.getAttribute('src')).toBe('https://example.com/photo.png?other=456');
        expect(muya.getMarkdown()).toBe(before);
        expect(muya.getState()).toEqual([{ name: 'html-block', text: source }]);
        expect(changes).not.toHaveBeenCalled();
        muya.invalidateImageCache();
        const refreshed = muya.domNode.querySelector<HTMLImageElement>('img[alt="local"]')!;
        expect(new URL(refreshed.getAttribute('src')!).searchParams.get('mucache')).toMatch(/^\d+-2$/);
        expect(muya.getMarkdown()).toBe(before);
        expect(changes).not.toHaveBeenCalled();
    });
});
