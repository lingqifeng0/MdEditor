// @vitest-environment happy-dom
import type Content from '../../block/base/content';
import type Format from '../../block/base/format';
import type { Muya } from '../../muya';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pasteImageSrc, tryReplaceSelectedImage } from '../pasteImage';

vi.mock('../../utils/prism/index', () => ({ default: {}, walkTokens: () => null, loadedLanguages: new Set(), transformAliasToOrigin: (s: string) => s, loadLanguage: () => null, search: () => [] }));
const Clipboard = (await import('../index')).default;
const hosts: HTMLElement[] = [];
afterEach(() => {
    hosts.splice(0).forEach(host => host.remove());
});

function fixture(action: () => Promise<string>, text = 'Selected text') {
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const block = { text, domNode: host, getCursor: () => ({ start: { offset: 0 }, end: { offset: text.length } }), setCursor: vi.fn() } as unknown as Content;
    const selection = { getSelection: () => ({ anchor: { block } }), activate: vi.fn(), image: null as unknown };
    const clipboard = new Clipboard({ options: { imageAction: action, imageActionBeforeInsert: true, clipboardFilePath: async () => '/tmp/new.png' }, editor: { activeContentBlock: block } } as unknown as Muya);
    Object.defineProperty(clipboard, 'selection', { get: () => selection });
    return { clipboard, block, selection };
}

describe('atomic image insertion', () => {
    it('does not replace selection or write a loading marker when storage refuses', async () => {
        const { clipboard, block } = fixture(async () => '');
        await pasteImageSrc(clipboard, '/tmp/new.png');
        expect(block.text).toBe('Selected text');
        expect(block.setCursor).not.toHaveBeenCalled();
    });
    it('keeps the original selection while storage is pending and commits the resolved path once', async () => {
        let resolve!: (src: string) => void;
        const { clipboard, block } = fixture(() => new Promise<string>((done) => {
            resolve = done;
        }));
        const pending = pasteImageSrc(clipboard, '/tmp/new.png');
        expect(block.text).toBe('Selected text');
        resolve('assets/new image.png');
        await pending;
        expect(block.text).toBe('![](assets/new%20image.png)');
        expect(block.setCursor).toHaveBeenCalledOnce();
    });
    it('does not overwrite user edits or a detached document after an asynchronous copy', async () => {
        let resolve!: (src: string) => void;
        const { clipboard, block } = fixture(() => new Promise<string>((done) => {
            resolve = done;
        }));
        const pending = pasteImageSrc(clipboard, '/tmp/new.png');
        block.text = 'New user input';
        resolve('assets/new.png');
        await pending;
        expect(block.text).toBe('New user input');
        expect(block.setCursor).not.toHaveBeenCalled();
    });
    it('leaves a selected image untouched when a replacement is rejected', async () => {
        const { clipboard, block, selection } = fixture(async () => '', '![original](original.png)');
        selection.image = { block: block as Format, token: { range: { start: 0, end: block.text.length } } };
        expect(await tryReplaceSelectedImage(clipboard, null)).toBe(true);
        expect(block.text).toBe('![original](original.png)');
        expect(selection.activate).not.toHaveBeenCalled();
        expect(block.setCursor).not.toHaveBeenCalled();
    });
});
