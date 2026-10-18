// @vitest-environment happy-dom

import type Format from '../../../block/base/format';
import type { ImageToken } from '../../../inlineRenderer/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenizer } from '../../../inlineRenderer/lexer';
import { Muya } from '../../../muya';
import icons from '../config';
import { ImageToolBar } from '../index';

const revealLabel = icons.find(icon => icon.type === 'reveal')!.ariaLabel!;

const opened: Array<{ muya: Muya; toolbar: ImageToolBar }> = [];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

beforeEach(() => {
    window.MUYA_VERSION = 'test';
    frames = new Map();
    frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback);
        return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
});

afterEach(() => {
    for (const { muya, toolbar } of opened.splice(0)) {
        toolbar.destroy();
        muya.destroy();
        muya.domNode.remove();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.getSelection()?.removeAllRanges();
});

function flushFrames(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending)
        callback(0);
}

function boot() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: 'before ![note](assets/photo.png) after' });
    muya.init();
    const toolbar = new ImageToolBar(muya);
    opened.push({ muya, toolbar });
    const show = vi.spyOn(toolbar, 'show').mockImplementation(() => {
        toolbar.status = true;
    });
    const block = muya.editor.scrollPage!.firstContentInDescendant()! as Format;
    const token = tokenizer(block.text).find(token => token.type === 'image')! as ImageToken;
    const imageInfo = { token, imageId: 'image-toolbar-test' };
    const reference = { getBoundingClientRect: () => new DOMRect(10, 20, 100, 80) };
    const emit = (src = token.src, attrsSrc = src, imageId = imageInfo.imageId) => {
        const info = { token: { ...token, src, attrs: { ...token.attrs, src: attrsSrc } }, imageId };
        muya.eventCenter.emit('muya-image-toolbar', { block, reference, imageInfo: info });
        return info;
    };
    return { muya, toolbar, show, block, imageInfo, reference, emit };
}

function button(toolbar: ImageToolBar, label: string): HTMLElement {
    const element = toolbar.container!.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
    expect(element).not.toBeNull();
    return element!;
}

function click(element: HTMLElement): void {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    element.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('image toolbar file actions', () => {
    it('emits raw source and image id without changing the document or frozen image selection', () => {
        const { muya, toolbar, block, emit } = boot();
        const source = '../图片%20😀.png';
        const info = emit(source);
        const frozen = { ...info, block };
        muya.editor.selection.selectImage(frozen);
        flushFrames();
        const markdown = muya.getMarkdown();
        const state = JSON.stringify(muya.getState());
        const copy = vi.fn();
        const reveal = vi.fn();
        const open = vi.fn();
        const remove = vi.spyOn(block, 'deleteImage');
        const update = vi.spyOn(block, 'updateImage');
        muya.on('copy-image', copy);
        muya.on('reveal-image', reveal);
        muya.on('open-image-in-editor', open);

        for (const label of ['复制图片', revealLabel, '用外部编辑器打开']) {
            emit(source);
            flushFrames();
            click(button(toolbar, label));
            expect(toolbar.status).toBe(false);
        }

        expect(copy).toHaveBeenCalledExactlyOnceWith({ src: source, imageId: info.imageId });
        expect(reveal).toHaveBeenCalledExactlyOnceWith({ src: source, imageId: info.imageId });
        expect(open).toHaveBeenCalledExactlyOnceWith({ src: source, imageId: info.imageId });
        expect(remove).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(muya.editor.selection.image).toBe(frozen);
        expect(muya.getMarkdown()).toBe(markdown);
        expect(JSON.stringify(muya.getState())).toBe(state);
        expect(toolbar.status).toBe(false);
    });

    it('falls back to the HTML image src attribute without rewriting it', () => {
        const { muya, toolbar, emit } = boot();
        const copy = vi.fn();
        const source = 'file:///tmp/图片%20😀.png';
        muya.on('copy-image', copy);
        emit('', source);
        flushFrames();
        click(button(toolbar, '复制图片'));
        expect(copy).toHaveBeenCalledExactlyOnceWith({ src: source, imageId: 'image-toolbar-test' });
    });

    it.each(['assets/photo.png', '../图片%20😀.png', '/tmp/photo.png', 'file:///tmp/a%20b.png', 'C:\\Images\\photo.png', '\\\\server\\images\\photo.png'])('enables file reveal for local source %s', (source) => {
        const { muya, toolbar, emit } = boot();
        const reveal = vi.fn();
        muya.on('reveal-image', reveal);
        emit(source);
        flushFrames();
        const item = button(toolbar, revealLabel);
        expect(item.getAttribute('aria-disabled')).toBe('false');
        expect(item.getAttribute('tabindex')).toBe('0');
        click(item);
        expect(reveal).toHaveBeenCalledExactlyOnceWith({ src: source, imageId: 'image-toolbar-test' });
    });

    it.each(['https://example.com/photo.png', 'HTTP://example.com/photo.png', 'data:image/png;base64,AAAA', 'blob:https://example.com/id', 'ftp://example.com/photo.png', '//example.com/photo.png'])('allows copying but disables file reveal for %s', (source) => {
        const { muya, toolbar, emit } = boot();
        const copy = vi.fn();
        const reveal = vi.fn();
        muya.on('copy-image', copy);
        muya.on('reveal-image', reveal);
        emit(source);
        flushFrames();
        const finder = button(toolbar, revealLabel);
        const external = button(toolbar, '用外部编辑器打开');
        expect(finder.getAttribute('aria-disabled')).toBe('true');
        expect(external.getAttribute('aria-disabled')).toBe('true');
        expect(finder.getAttribute('title')).toContain('local images');
        click(finder);
        click(button(toolbar, '复制图片'));
        expect(reveal).not.toHaveBeenCalled();
        expect(copy).toHaveBeenCalledExactlyOnceWith({ src: source, imageId: 'image-toolbar-test' });
    });

    it.each(['', '   '])('disables both file actions for an empty source %j', (source) => {
        const { muya, toolbar, emit } = boot();
        const copy = vi.fn();
        const reveal = vi.fn();
        muya.on('copy-image', copy);
        muya.on('reveal-image', reveal);
        emit(source);
        flushFrames();
        for (const label of ['复制图片', revealLabel, '用外部编辑器打开']) {
            const item = button(toolbar, label);
            expect(item.getAttribute('aria-disabled')).toBe('true');
            expect(item.getAttribute('tabindex')).toBe('-1');
            click(item);
        }
        expect(copy).not.toHaveBeenCalled();
        expect(reveal).not.toHaveBeenCalled();
    });

    it.each(['Enter', ' '])('activates the copy button by %j without deleting the selected image', (key) => {
        const { muya, toolbar, block, emit } = boot();
        const info = emit();
        muya.editor.selection.selectImage({ ...info, block });
        flushFrames();
        const copy = vi.fn();
        muya.on('copy-image', copy);
        const markdown = muya.getMarkdown();
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        button(toolbar, '复制图片').dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(copy).toHaveBeenCalledOnce();
        expect(muya.getMarkdown()).toBe(markdown);
        expect(block.text).toContain('![note](assets/photo.png)');
    });

    it('keeps the existing alignment and delete actions working', () => {
        const { muya, toolbar, block, emit } = boot();
        emit();
        flushFrames();
        click(toolbar.container!.querySelector<HTMLElement>('.item.center')!);
        muya.flush();
        expect(block.text).toContain('data-align="center"');
        expect(block.text).toContain('src="assets/photo.png"');
        expect(block.text).toContain('alt="note"');
        expect(toolbar.status).toBe(false);

        const token = tokenizer(block.text).find(token => token.type === 'html_tag')! as unknown as ImageToken;
        muya.eventCenter.emit('muya-image-toolbar', {
            block,
            reference: { getBoundingClientRect: () => new DOMRect(10, 20, 100, 80) },
            imageInfo: { token, imageId: 'aligned-image' },
        });
        flushFrames();
        click(toolbar.container!.querySelector<HTMLElement>('.item.delete')!);
        muya.flush();
        expect(block.text).toBe('before  after');
        expect(muya.getMarkdown()).not.toContain('<img');
        expect(toolbar.status).toBe(false);
    });
});

describe('image toolbar pending opens', () => {
    it('does not reopen after a cleared reference or an explicit hide', () => {
        const { muya, toolbar, show, emit } = boot();
        emit();
        muya.eventCenter.emit('muya-image-toolbar', { reference: null });
        flushFrames();
        expect(show).not.toHaveBeenCalled();
        expect(toolbar.status).toBe(false);
        emit();
        toolbar.hide();
        flushFrames();
        expect(show).not.toHaveBeenCalled();
    });

    it('only opens for the newest image and never emits the old source', () => {
        const { muya, toolbar, show, emit } = boot();
        const copy = vi.fn();
        muya.on('copy-image', copy);
        emit('first.png', 'first.png', 'first-image');
        emit('second.png', 'second.png', 'second-image');
        flushFrames();
        expect(show).toHaveBeenCalledOnce();
        click(button(toolbar, '复制图片'));
        expect(copy).toHaveBeenCalledExactlyOnceWith({ src: 'second.png', imageId: 'second-image' });
    });

    it('ignores a pending or subsequent open after destruction', () => {
        const { toolbar, show, emit } = boot();
        emit();
        toolbar.destroy();
        flushFrames();
        emit('second.png');
        flushFrames();
        expect(show).not.toHaveBeenCalled();
        expect(toolbar.floatBox!.isConnected).toBe(false);
    });
});
