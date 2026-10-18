// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

const editors: Muya[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    for (const editor of editors.splice(0))
        editor.destroy();
    window.DIRNAME = undefined;
});

function preview(src: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const markdown = `<div><img src="${src}" onerror="alert(1)"></div>\n`;
    const editor = new Muya(host, { markdown });
    editors.push(editor);
    editor.init();
    const image = editor.domNode.querySelector<HTMLImageElement>('.mu-html-preview img')!;
    expect(image.hasAttribute('onerror')).toBe(false);
    expect(editor.getMarkdown()).toBe(markdown);
    return image;
}

describe('html preview local image sources', () => {
    it('retains an encoded Windows file URL across preview rendering', () => {
        const src = 'file:///C:/notes/%E4%B8%AD%E6%96%87%20image.png';
        expect(preview(src).getAttribute('src')).toBe(src);
    });

    it('resolves an absolute drive path without changing the Markdown source', () => {
        expect(preview('C:\\notes\\image.png').getAttribute('src')).toBe('file:///C:/notes/image.png');
    });

    it('resolves a UNC path to a server file URL', () => {
        expect(preview('\\\\server\\share\\image.png').getAttribute('src')).toBe('file://server/share/image.png');
    });

    it('continues to reject executable image URLs', () => {
        expect(preview('javascript:alert(1)').getAttribute('src')).toBe('');
    });
});
