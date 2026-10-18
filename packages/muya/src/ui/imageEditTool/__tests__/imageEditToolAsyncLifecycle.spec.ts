// @vitest-environment happy-dom
import type { IImagePathSuggestion } from '../../imagePicker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageEditTool } from '..';
import EventCenter from '../../../event';
import { Muya } from '../../../muya';
import { createHtmlImageTarget } from '../../../utils/htmlImage';
import { getImageInfo } from '../../../utils/image';

const opened: Array<{ tool: ImageEditTool; eventCenter: EventCenter }> = [];
const editors: Muya[] = [];

beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
});

afterEach(() => {
    for (const { tool, eventCenter } of opened.splice(0)) {
        tool.destroy();
        eventCenter.detachAllDomEvents();
    }
    for (const muya of editors.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function bootUpload(src = 'assets/original.png') {
    window.MUYA_VERSION = 'test';
    let resolve!: (src: string) => void;
    let reject!: (error: Error) => void;
    const upload = new Promise<string>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    const action = vi.fn(() => upload);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: `before ![original](${src} "keep") after\n\n<div><img src="assets/html.png" alt="HTML"></div>` });
    muya.init();
    muya.flush();
    editors.push(muya);
    const tool = new ImageEditTool(muya, { imageAction: action });
    vi.spyOn(tool, 'show').mockImplementation(() => {
        tool.status = true;
    });
    opened.push({ tool, eventCenter: muya.eventCenter });
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    const original = block.text;
    const open = () => {
        const image = block.domNode!.querySelector<HTMLElement>('.mu-inline-image')!;
        muya.eventCenter.emit('muya-image-selector', {
            block,
            reference: image,
            imageInfo: getImageInfo(image),
        });
    };
    const confirm = (src: string) => {
        const input = tool.container!.querySelector<HTMLInputElement>('input.src')!;
        input.value = src;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    };
    const openHtml = () => {
        const target = createHtmlImageTarget(muya, muya.domNode.querySelector<HTMLImageElement>('.mu-html-preview img')!)!;
        muya.eventCenter.emit('muya-image-selector', { block: null, reference: target.image, imageInfo: target.imageInfo, replace: target.replace });
        return target;
    };
    open();
    return { muya, tool, block, original, action, resolve, reject, confirm, openHtml };
}

describe('markdown image persistence target lifecycle', () => {
    it('does not persist or dirty an unchanged local image', async () => {
        const { muya, tool, original, block, action, confirm } = bootUpload();
        const history = JSON.stringify(muya.getHistory());
        const change = vi.fn();
        muya.on('json-change', change);
        confirm('assets/original.png');
        await settle();
        muya.flush();
        expect(action).not.toHaveBeenCalled();
        expect(block.text).toBe(original);
        expect(JSON.stringify(muya.getHistory())).toBe(history);
        expect(change).not.toHaveBeenCalled();
        expect(tool.status).toBe(false);
    });

    it('keeps an unchanged file URL clean after the selector normalizes its input', async () => {
        const { muya, tool, block, original, action, confirm } = bootUpload('file:///C:/Images/photo.png');
        const history = JSON.stringify(muya.getHistory());
        confirm(tool.container!.querySelector<HTMLInputElement>('input.src')!.value);
        await settle();
        muya.flush();
        expect(action).not.toHaveBeenCalled();
        expect(block.text).toBe(original);
        expect(JSON.stringify(muya.getHistory())).toBe(history);
    });

    it('keeps the active original-block caret after the completed image changes source length', async () => {
        const { muya, block, resolve, confirm } = bootUpload();
        confirm('assets/new.png');
        block.setCursor(block.text.length, block.text.length);
        muya.domNode.focus();
        expect(muya.domNode.contains(document.activeElement)).toBe(true);
        resolve('https://example.com/long-uploaded-image.png');
        await settle();
        expect(muya.getSelection()!.anchor.offset).toBe(block.text.length);
        expect(muya.getSelection()!.focus.offset).toBe(block.text.length);
    });

    it('finishes the original Markdown image while a newer HTML selector remains intact', async () => {
        const { muya, tool, block, resolve, confirm, openHtml } = bootUpload();
        confirm('assets/new.png');
        expect(block.text).toContain('loading-');
        const target = openHtml();
        const html = muya.getState()[1];
        const input = tool.container!.querySelector<HTMLInputElement>('input.src')!;
        const cursor = vi.spyOn(block, 'setCursor');
        resolve('https://example.com/uploaded.png');
        await settle();
        muya.flush();
        expect(block.text).toBe('before ![original](https://example.com/uploaded.png "keep") after');
        expect(muya.getState()[1]).toEqual(html);
        expect(input.value).toBe(target.imageInfo.token.attrs.src);
        expect(tool.status).toBe(true);
        expect(cursor).not.toHaveBeenCalled();
    });

    it.each(['reject', 'empty'] as const)('restores exact original source on %s without disturbing a newer HTML selector', async (result: 'reject' | 'empty') => {
        const { muya, tool, block, original, resolve, reject, confirm, openHtml } = bootUpload();
        const error = new Error('persistence failed');
        const actionError = vi.fn();
        muya.on('image-action-error', actionError);
        confirm('assets/new.png');
        const target = openHtml();
        const html = muya.getState()[1];
        if (result === 'reject')
            reject(error);
        else
            resolve('');
        await settle();
        muya.flush();
        expect(block.text).toBe(original);
        expect(muya.getState()[1]).toEqual(html);
        expect(tool.container!.querySelector<HTMLInputElement>('input.src')!.value).toBe(target.imageInfo.token.attrs.src);
        expect(tool.status).toBe(true);
        if (result === 'reject')
            expect(actionError).toHaveBeenCalledExactlyOnceWith({ src: 'assets/new.png', error });
    });

    it('leaves a manually changed pending image untouched on completion', async () => {
        const { block, resolve, confirm } = bootUpload();
        confirm('assets/new.png');
        block.text = block.text.replace('assets/new.png', 'assets/manual.png');
        block.update();
        const changed = block.text;
        resolve('https://example.com/uploaded.png');
        await settle();
        expect(block.text).toBe(changed);
    });

    it('rejects a result after the original document is replaced', async () => {
        const { muya, resolve, confirm } = bootUpload();
        confirm('assets/new.png');
        muya.setContent('replacement document');
        resolve('https://example.com/uploaded.png');
        await settle();
        expect(muya.getMarkdown()).toBe('replacement document\n');
    });

    it.each(['resolve', 'reject'] as const)('does not change state or emit errors after destroy when persistence %s completes', async (result: 'resolve' | 'reject') => {
        const { muya, tool, block, resolve, reject, confirm } = bootUpload();
        const actionError = vi.fn();
        muya.on('image-action-error', actionError);
        confirm('assets/new.png');
        const pending = block.text;
        tool.destroy();
        if (result === 'resolve')
            resolve('https://example.com/uploaded.png');
        else
            reject(new Error('late failure'));
        await settle();
        expect(block.text).toBe(pending);
        expect(actionError).not.toHaveBeenCalled();
    });
});

function deferredPicker() {
    let resolve!: (path: string) => void;
    const promise = new Promise<string>((done) => {
        resolve = done;
    });
    return { picker: vi.fn(() => promise), resolve };
}

function boot(picker: () => Promise<string>, autocomplete?: (src: string) => Promise<IImagePathSuggestion[]>) {
    const eventCenter = new EventCenter();
    const wrapper = document.createElement('div');
    const domNode = document.createElement('div');
    wrapper.appendChild(domNode);
    document.body.appendChild(wrapper);
    const muya = {
        domNode,
        eventCenter,
        i18n: { t: (text: string) => text },
        ui: { shownFloat: new Set() },
    } as unknown as Muya;
    const tool = new ImageEditTool(muya, { imagePathPicker: picker, imagePathAutoComplete: autocomplete });
    vi.spyOn(tool, 'show').mockImplementation(() => {
        tool.status = true;
    });
    opened.push({ tool, eventCenter });
    const open = (kind: 'html' | 'markdown', src: string) => {
        const replace = vi.fn(() => true);
        const replaceImage = vi.fn();
        const reference = document.createElement('img');
        document.body.appendChild(reference);
        eventCenter.emit('muya-image-selector', {
            block: kind === 'markdown' ? { replaceImage } : null,
            reference,
            imageInfo: { imageId: src, token: { attrs: { src, alt: `${src}-alt`, title: `${src}-title` } } },
            ...(kind === 'html' ? { replace } : {}),
        });
        return { replace, replaceImage };
    };
    const choose = () => {
        const tabs = tool.container!.querySelectorAll('ul.header span');
        tabs[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        tool.container!.querySelector('button.select')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    return { tool, eventCenter, open, choose };
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('image path picker selector lifecycle', () => {
    it.each(['html', 'markdown'] as const)('applies a current %s picker to its captured image', async (kind: 'html' | 'markdown') => {
        const pending = deferredPicker();
        const { tool, open, choose } = boot(pending.picker);
        const target = open(kind, 'original.png');
        choose();
        pending.resolve('selected.png');
        await settle();
        const state = { src: 'selected.png', alt: 'original.png-alt', title: 'original.png-title' };
        if (kind === 'html')
            expect(target.replace).toHaveBeenCalledExactlyOnceWith(state);
        else
            expect(target.replaceImage).toHaveBeenCalledExactlyOnceWith(expect.anything(), state);
        expect(tool.status).toBe(false);
    });

    it.each(['html', 'markdown'] as const)('drops a %s picker after hide without entering another image route', async (kind: 'html' | 'markdown') => {
        const pending = deferredPicker();
        const { tool, open, choose } = boot(pending.picker);
        const target = open(kind, 'original.png');
        choose();
        tool.hide();
        pending.resolve('selected.png');
        await settle();
        expect(target.replace).not.toHaveBeenCalled();
        expect(target.replaceImage).not.toHaveBeenCalled();
        expect(tool.status).toBe(false);
    });

    it.each([
        ['html', 'markdown', 'selected.png'],
        ['markdown', 'html', 'selected.png'],
        ['html', 'html', ''],
        ['markdown', 'markdown', ''],
    ] as const)('does not apply or cancel a newer %s → %s selector when the old picker returns %j', async (first: 'html' | 'markdown', second: 'html' | 'markdown', path: string) => {
        const pending = deferredPicker();
        const { tool, open, choose } = boot(pending.picker);
        const oldTarget = open(first, 'old.png');
        choose();
        const newTarget = open(second, 'new.png');
        pending.resolve(path);
        await settle();
        for (const target of [oldTarget, newTarget]) {
            expect(target.replace).not.toHaveBeenCalled();
            expect(target.replaceImage).not.toHaveBeenCalled();
        }
        expect(tool.status).toBe(true);
    });

    it('drops a picker after destruction and cannot reopen the destroyed selector', async () => {
        const pending = deferredPicker();
        const { tool, open, choose } = boot(pending.picker);
        const target = open('html', 'original.png');
        choose();
        tool.destroy();
        pending.resolve('selected.png');
        await settle();
        const newer = open('markdown', 'new.png');
        expect(target.replace).not.toHaveBeenCalled();
        expect(newer.replaceImage).not.toHaveBeenCalled();
        expect(tool.status).toBe(false);
        expect(tool.floatBox!.isConnected).toBe(false);
    });
});

describe('image path autocomplete selector lifecycle', () => {
    it.each(['hide', 'replace', 'destroy'] as const)('drops an old response after selector %s', async (action: 'hide' | 'replace' | 'destroy') => {
        let resolve!: (list: IImagePathSuggestion[]) => void;
        const pending = new Promise<IImagePathSuggestion[]>((done) => {
            resolve = done;
        });
        const { tool, eventCenter, open } = boot(async () => '', () => pending);
        const showPicker = vi.fn();
        eventCenter.subscribe('muya-image-picker', showPicker);
        open('html', 'old/photo.png');
        tool.container!.querySelector('input.src')!.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
        if (action === 'replace')
            open('markdown', 'new/photo.png');
        else if (action === 'hide')
            tool.hide();
        else
            tool.destroy();
        resolve([{ text: 'old-suggestion.png', iconClass: 'icon-image' }]);
        await settle();
        expect(showPicker).not.toHaveBeenCalled();
        expect(tool.status).toBe(action === 'replace');
    });

    it.each(['hide', 'replace', 'destroy'] as const)('rejects an already published callback after selector %s', async (action: 'hide' | 'replace' | 'destroy') => {
        const suggestion = { text: 'old-suggestion.png', iconClass: 'icon-image' };
        const { tool, eventCenter, open } = boot(async () => '', async () => [suggestion]);
        let callback!: (item: IImagePathSuggestion) => void;
        eventCenter.subscribe('muya-image-picker', (payload: { cb: typeof callback }) => {
            callback = payload.cb;
        });
        open('html', 'old/photo.png');
        const oldInput = tool.container!.querySelector<HTMLInputElement>('input.src')!;
        oldInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
        await settle();
        expect(callback).toBeTypeOf('function');
        if (action === 'replace')
            open('markdown', 'new/photo.png');
        else if (action === 'hide')
            tool.hide();
        else
            tool.destroy();
        const currentInput = tool.container!.querySelector<HTMLInputElement>('input.src')!;
        const before = currentInput.value;
        callback(suggestion);
        expect(currentInput.value).toBe(before);
        expect(tool.status).toBe(action === 'replace');
    });

    it('applies a published suggestion while its selector session is still active', async () => {
        const suggestion = { text: 'selected.png', iconClass: 'icon-image' };
        const { tool, eventCenter, open } = boot(async () => '', async () => [suggestion]);
        let callback!: (item: IImagePathSuggestion) => void;
        eventCenter.subscribe('muya-image-picker', (payload: { cb: typeof callback }) => {
            callback = payload.cb;
        });
        const target = open('html', 'images/photo.png');
        const input = tool.container!.querySelector<HTMLInputElement>('input.src')!;
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
        await settle();
        callback(suggestion);
        expect(input.value).toBe('images/selected.png');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settle();
        expect(target.replace).toHaveBeenCalledExactlyOnceWith({
            src: 'images/selected.png',
            alt: 'images/photo.png-alt',
            title: 'images/photo.png-title',
        });
    });
});
