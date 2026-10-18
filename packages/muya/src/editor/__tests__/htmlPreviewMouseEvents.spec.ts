// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { isHtmlPreviewMarginTarget, isHtmlPreviewTarget } from '../htmlPreviewMouseEvents';

const sessions: Muya[] = [];

afterEach(() => {
    for (const muya of sessions.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.getSelection()?.removeAllRanges();
});

function boot(html = '<div style="height:300px">\n<img src="photo.png">\n</div>') {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: `first paragraph\n\n${html}\n\nlast paragraph` });
    muya.init();
    sessions.push(muya);
    return { muya, preview: muya.domNode.querySelector<HTMLElement>('.mu-html-preview')! };
}

function mockLayout(muya: Muya, preview: HTMLElement) {
    const column = muya.editor.scrollPage!.domNode!;
    const figure = preview.closest<HTMLElement>('.mu-html-block')!;
    const previewRect = new DOMRect(140, 180, 720, 220);
    Object.defineProperties(muya.domNode, {
        clientLeft: { configurable: true, value: 0 },
        clientTop: { configurable: true, value: 0 },
        clientWidth: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 600 },
    });
    vi.spyOn(muya.domNode, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1016, 600));
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(new DOMRect(90, 0, 820, 600));
    vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue(previewRect);
    const previewBounds = vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(previewRect);
    const lastBlock = muya.editor.scrollPage!.lastChild!;
    vi.spyOn(lastBlock.domNode!, 'getBoundingClientRect').mockReturnValue(new DOMRect(140, 450, 720, 50));
    return { column, figure, previewBounds };
}

function press(target: HTMLElement, x: number, y: number) {
    const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
    });
    target.dispatchEvent(event);
    return event;
}

describe('noneditable HTML preview pointer handling', () => {
    it.each(['div', 'img'])('keeps background and %s presses out of text-caret selection', (selector) => {
        const { muya, preview } = boot();
        const bubble = vi.fn();
        muya.domNode.addEventListener('mousedown', bubble);
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        preview.querySelector(selector)!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(bubble).not.toHaveBeenCalled();
    });

    it.each(['button', 'a', 'input', 'summary', 'video'])('preserves native %s interaction in the preview', (tag) => {
        const { preview } = boot(`<div><${tag}></${tag}></div>`);
        const element = document.createElement(tag);
        preview.append(element);
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it('allows selection of visible HTML text and ordinary document text', () => {
        const { muya, preview } = boot('<div><span>selectable text</span></div>');
        for (const element of [preview.querySelector('span')!, muya.domNode.querySelector('.mu-content')!]) {
            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            element.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
        }
    });

    it('does not commit a stale paragraph cursor for HTML preview clicks', () => {
        const { muya, preview } = boot();
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const click = vi.spyOn(block, 'clickHandler');
        const selection = vi.spyOn(muya.editor.selection, 'getSelection');
        const state = JSON.stringify(muya.getState());
        const markdown = muya.getMarkdown();
        preview.querySelector('div')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(click).not.toHaveBeenCalled();
        expect(selection).not.toHaveBeenCalled();
        expect(JSON.stringify(muya.getState())).toBe(state);
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it.each([
        { surface: 'editor', x: 950 },
        { surface: 'column', x: 110 },
        { surface: 'figure', x: 850 },
    ])('keeps a click on the HTML $surface margin from reusing the old paragraph caret', ({ surface, x }) => {
        const { muya, preview } = boot();
        const { column, figure } = mockLayout(muya, preview);
        preview.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const target = surface === 'editor' ? muya.domNode : surface === 'column' ? column : figure;
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const click = vi.spyOn(block, 'clickHandler');
        const selection = vi.spyOn(muya.editor.selection, 'getSelection');
        const bubble = vi.fn();
        muya.domNode.addEventListener('mousedown', bubble);
        const state = JSON.stringify(muya.getState());
        const markdown = muya.getMarkdown();
        const event = press(target, x, 250);
        expect(isHtmlPreviewMarginTarget(muya, event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(bubble).not.toHaveBeenCalled();
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: 250 }));
        expect(click).not.toHaveBeenCalled();
        expect(selection).not.toHaveBeenCalled();
        expect(JSON.stringify(muya.getState())).toBe(state);
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it.each([
        { x: 950, y: 150 },
        { x: 950, y: 410 },
        { x: 1008, y: 250 },
        { x: -1, y: 250 },
    ])('leaves ordinary text rows and the scrollbar outside the HTML margin guard ($x,$y)', ({ x, y }) => {
        const { muya, preview } = boot();
        mockLayout(muya, preview);
        const event = press(muya.domNode, x, y);
        expect(isHtmlPreviewMarginTarget(muya, event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('allows ordinary paragraph clicks at the same vertical position as a preview', () => {
        const { muya, preview } = boot();
        mockLayout(muya, preview);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const click = vi.spyOn(block, 'clickHandler');
        const event = press(block.domNode!, 200, 250);
        expect(isHtmlPreviewMarginTarget(muya, event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        block.domNode!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 250 }));
        expect(click).toHaveBeenCalledOnce();
    });

    it('leaves HTML source content editable when its preview is hidden', () => {
        const { muya, preview } = boot();
        const { figure } = mockLayout(muya, preview);
        figure.classList.add('mu-active');
        preview.style.display = 'none';
        const source = figure.querySelector<HTMLElement>('.mu-html-container .mu-content')!;
        const event = press(source, 200, 250);
        expect(isHtmlPreviewMarginTarget(muya, event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        const margin = press(muya.domNode, 950, 250);
        expect(isHtmlPreviewMarginTarget(muya, margin)).toBe(false);
        expect(margin.defaultPrevented).toBe(false);
    });

    it.each(['display', 'visibility', 'zero-size'])('does not treat a %s preview as a visible HTML row', (hidden) => {
        const { muya, preview } = boot();
        const { previewBounds } = mockLayout(muya, preview);
        if (hidden === 'display')
            preview.style.display = 'none';
        else if (hidden === 'visibility')
            preview.style.visibility = 'hidden';
        else
            previewBounds.mockReturnValue(new DOMRect(140, 180, 0, 0));
        const event = press(muya.domNode, 950, 250);
        expect(isHtmlPreviewMarginTarget(muya, event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('allows a click below the last block to create a new paragraph', () => {
        const { muya, preview } = boot();
        const { column } = mockLayout(muya, preview);
        const count = muya.getState().length;
        const event = press(column, 110, 550);
        expect(isHtmlPreviewMarginTarget(muya, event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        column.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 550 }));
        muya.flush();
        expect(muya.getState()).toHaveLength(count + 1);
        expect(muya.editor.scrollPage!.lastChild!.blockName).toBe('paragraph');
        expect(muya.editor.selection.anchorBlock).toBe(muya.editor.scrollPage!.lastContentInDescendant());
    });

    it('detaches the new margin press listener when the editor is destroyed', () => {
        const { muya, preview } = boot();
        const { column } = mockLayout(muya, preview);
        muya.destroy();
        sessions.splice(sessions.indexOf(muya), 1);
        expect(press(column, 110, 250).defaultPrevented).toBe(false);
        expect(press(muya.domNode, 950, 250).defaultPrevented).toBe(false);
        muya.domNode.remove();
    });

    it('recognizes only preview targets and detaches its listeners on destroy', () => {
        const { muya, preview } = boot();
        expect(isHtmlPreviewTarget(preview.querySelector('img'))).toBe(true);
        expect(isHtmlPreviewTarget(muya.domNode)).toBe(false);
        expect(isHtmlPreviewTarget(null)).toBe(false);
        expect(isHtmlPreviewTarget(document.createTextNode('text'))).toBe(false);
        const element = preview.querySelector('div')!;
        muya.destroy();
        sessions.splice(sessions.indexOf(muya), 1);
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        muya.domNode.remove();
    });
});
