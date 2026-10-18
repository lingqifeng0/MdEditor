// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../../config';
import { Muya } from '../../../muya';
import { ImageEditTool } from '../../imageEditTool';
import { ImageToolBar } from '../index';

const opened: Array<{ muya: Muya; toolbar: ImageToolBar; edit: ImageEditTool }> = [];
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
    for (const { muya, toolbar, edit } of opened.splice(0)) {
        toolbar.destroy();
        edit.destroy();
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

function boot(markdown: string, imageAction?: (state: { src: string; alt: string; title: string }) => Promise<string>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    muya.flush();
    const toolbar = new ImageToolBar(muya);
    const edit = new ImageEditTool(muya, { imageAction });
    const toolbarShow = vi.spyOn(toolbar, 'show').mockImplementation(() => {
        toolbar.status = true;
    });
    vi.spyOn(edit, 'show').mockImplementation(() => {
        edit.status = true;
    });
    opened.push({ muya, toolbar, edit });
    const content = muya.editor.scrollPage!.firstContentInDescendant()!;
    return { muya, toolbar, edit, toolbarShow, content };
}

function clickItem(toolbar: ImageToolBar, type: string) {
    toolbar.container!.querySelector<HTMLElement>(`.item.${type}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function rightClick(image: HTMLImageElement): MouseEvent {
    const event = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
    image.dispatchEvent(event);
    flushFrames();
    return event;
}

function srcInput(edit: ImageEditTool): HTMLInputElement {
    return edit.container!.querySelector<HTMLInputElement>('input.src')!;
}

describe('image context toolbar routing', () => {
    it('selects and resizes Markdown images on left click and opens the toolbar only on right click', () => {
        const { muya, toolbar, toolbarShow, content } = boot('![note](assets/photo.png)\n\nafter');
        const wrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        const image = document.createElement('img');
        image.src = 'file:///assets/photo.png';
        wrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!.appendChild(image);
        const transform = vi.fn();
        muya.on('muya-transformer', transform);
        const before = content.text;
        image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        flushFrames();
        expect(toolbarShow).not.toHaveBeenCalled();
        expect(transform).toHaveBeenCalled();
        expect(muya.editor.selection.image).not.toBeNull();
        // Selection can rerender the paragraph, so use the current node for the
        // second gesture rather than a detached image from the first one.
        const liveWrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        const liveImage = liveWrapper.querySelector('img') ?? image;
        if (!liveImage.isConnected)
            liveWrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!.appendChild(liveImage);
        expect(rightClick(liveImage).defaultPrevented).toBe(true);
        expect(toolbarShow).toHaveBeenCalledOnce();
        expect(Array.from(toolbar.container!.querySelectorAll('.item')).map(item => item.classList[1]))
            .toEqual(['open', 'copy', 'reveal', 'inline', 'left', 'center', 'right', 'edit', 'delete']);
        expect(content.text).toBe(before);
        const lastWrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        const lastImage = lastWrapper.querySelector('img') ?? image;
        if (!lastImage.isConnected)
            lastWrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!.appendChild(lastImage);
        lastImage.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        flushFrames();
        expect(toolbarShow).toHaveBeenCalledOnce();
        expect(toolbar.status).toBe(false);
    });

    it('freezes the current Markdown image when selection rerenders its wrapper with a new id', () => {
        const { muya, toolbar } = boot('![note](assets/photo.png)\n\nafter');
        const wrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        const image = document.createElement('img');
        image.src = 'file:///assets/photo.png';
        wrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!.appendChild(image);
        const selectImage = muya.editor.selection.selectImage.bind(muya.editor.selection);
        vi.spyOn(muya.editor.selection, 'selectImage').mockImplementation((data) => {
            selectImage(data);
            const liveWrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
            liveWrapper.id = 'fresh-wrapper-after-rerender';
            if (!liveWrapper.querySelector('img')) {
                const fresh = image.cloneNode() as HTMLImageElement;
                liveWrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)!.appendChild(fresh);
            }
        });
        const open = vi.fn();
        muya.on('open-image-in-editor', open);
        rightClick(image);
        const connected = muya.domNode.querySelector<HTMLImageElement>('.mu-inline-image img')!;
        clickItem(toolbar, 'open');
        expect(open).toHaveBeenCalledExactlyOnceWith({
            src: 'assets/photo.png',
            imageId: 'fresh-wrapper-after-rerender',
            image: connected,
        });
        expect(connected.isConnected).toBe(true);
        expect(toolbar.status).toBe(false);
    });

    it('shows only five HTML image actions and sends direct renderer images without document changes', () => {
        const { muya, toolbar, toolbarShow, content } = boot('<div style="width:400px"><img src="assets/photo.png" alt="note"></div>\n\nafter');
        const image = muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!;
        const viewer = vi.fn();
        muya.domNode.addEventListener('dblclick', viewer);
        const doubleClick = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
        image.dispatchEvent(doubleClick);
        expect(viewer).toHaveBeenCalledOnce();
        expect(doubleClick.defaultPrevented).toBe(false);
        const before = content.text;
        const copy = vi.fn();
        const reveal = vi.fn();
        const open = vi.fn();
        const change = vi.fn();
        muya.on('copy-image', copy);
        muya.on('reveal-image', reveal);
        muya.on('open-image-in-editor', open);
        muya.on('json-change', change);
        image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        flushFrames();
        expect(toolbarShow).not.toHaveBeenCalled();
        expect(rightClick(image).defaultPrevented).toBe(true);
        expect(toolbarShow).toHaveBeenCalledOnce();
        expect(Array.from(toolbar.container!.querySelectorAll('.item')).map(item => item.classList[1]))
            .toEqual(['open', 'copy', 'reveal', 'edit', 'delete']);
        for (const action of ['copy', 'reveal', 'open']) {
            rightClick(image);
            clickItem(toolbar, action);
            expect(toolbar.status).toBe(false);
        }
        for (const event of [copy, reveal, open])
            expect(event).toHaveBeenCalledExactlyOnceWith({ src: 'assets/photo.png', imageId: expect.any(String), image });
        expect(content.text).toBe(before);
        expect(change).not.toHaveBeenCalled();
    });

    it('edits HTML image fields through the existing selector and deleting updates its source model', () => {
        const { muya, toolbar, edit, content } = boot('<div><img src=\'assets/photo.png\' alt=note style="width:80px"><b>keep</b></div>\n\nafter');
        const source = content.text;
        rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
        clickItem(toolbar, 'edit');
        const input = srcInput(edit);
        expect(input.value).toBe('assets/photo.png');
        input.value = 'https://example.com/new.png';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(content.text).toBe(source.replace('assets/photo.png', 'https://example.com/new.png'));
        muya.undo();
        expect(content.text).toBe(source);
        rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
        clickItem(toolbar, 'delete');
        expect(content.text).toBe(source.replace('<img src=\'assets/photo.png\' alt=note style="width:80px">', ''));
        expect(muya.domNode.querySelector(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)).toBeNull();
        muya.undo();
        expect(content.text).toBe(source);
    });

    it('keeps file URLs and source spacing intact when HTML editing is cancelled or unchanged', () => {
        const action = vi.fn().mockResolvedValue('copied.png');
        const { muya, toolbar, edit, content } = boot('<div><IMG  SRC=\'file:///C:/Images/photo.png\' alt="note"></div>\n\nafter', action);
        const source = content.text;
        const change = vi.fn();
        muya.on('json-change', change);
        rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
        clickItem(toolbar, 'edit');
        expect(srcInput(edit).value).toBe('file:///C:/Images/photo.png');
        srcInput(edit).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(content.text).toBe(source);
        expect(action).not.toHaveBeenCalled();
        expect(change).not.toHaveBeenCalled();
        rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
        clickItem(toolbar, 'edit');
        srcInput(edit).value = 'assets/cancelled.png';
        srcInput(edit).dispatchEvent(new Event('input', { bubbles: true }));
        edit.hide();
        expect(content.text).toBe(source);
    });

    it('does not apply an asynchronous replacement over newer HTML source', async () => {
        let resolve!: (src: string) => void;
        const action = vi.fn(() => new Promise<string>((done) => {
            resolve = done;
        }));
        const { muya, toolbar, edit, content } = boot('<div><img src="assets/photo.png"></div>\n\nafter', action);
        rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
        clickItem(toolbar, 'edit');
        const input = srcInput(edit);
        input.value = 'C:/Images/new.png';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(action).toHaveBeenCalledOnce();
        const newer = content.text.replace('</div>', '<p>newer change</p></div>');
        content.text = newer;
        content.update();
        resolve('assets/finished.png');
        await Promise.resolve();
        await Promise.resolve();
        expect(content.text).toBe(newer);
        expect(content.text).not.toContain('finished.png');
    });

    it('leaves HTML source and undo state intact when image persistence fails or returns empty', async () => {
        const failure = new Error('persistence refused');
        const action = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('');
        const { muya, toolbar, edit, content } = boot('<div><img src="assets/photo.png"></div>\n\nafter', action);
        const source = content.text;
        const history = JSON.stringify(muya.getHistory());
        const change = vi.fn();
        const error = vi.fn();
        muya.on('json-change', change);
        muya.on('image-action-error', error);
        for (let attempt = 0; attempt < 2; attempt++) {
            rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
            clickItem(toolbar, 'edit');
            const input = srcInput(edit);
            input.value = 'C:/Images/new.png';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        }
        expect(action).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledExactlyOnceWith({ src: 'C:/Images/new.png', error: failure });
        expect(content.text).toBe(source);
        expect(change).not.toHaveBeenCalled();
        expect(JSON.stringify(muya.getHistory())).toBe(history);
    });

    it('disables external opening for remote image sources', () => {
        const { muya, toolbar } = boot('<div><img src="https://example.com/photo.png"></div>\n\nafter');
        const open = vi.fn();
        muya.on('open-image-in-editor', open);
        rightClick(muya.domNode.querySelector<HTMLImageElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW} img`)!);
        expect(toolbar.container!.querySelector('.item.open')!.getAttribute('aria-disabled')).toBe('true');
        clickItem(toolbar, 'open');
        expect(open).not.toHaveBeenCalled();
    });
});
