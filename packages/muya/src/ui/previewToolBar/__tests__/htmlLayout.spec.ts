// @vitest-environment happy-dom

import type HTMLBlock from '../../../block/commonMark/html';
import type { IEditHtmlLayoutPayload } from '../index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { getBlock } from '../../../utils/dom';
import { PreviewToolBar } from '../index';

const FIRST = '<div class="layout"><img src="assets/图片.png" alt="原图"><div class="text-box">first</div></div>';
const SECOND = '<div id="second"><div class="text-box">second</div></div>';
const SOURCE = `before\n\n${FIRST}\n\nmiddle\n\n${SECOND}\n\nafter\n`;
const opened: Array<{ muya: Muya; toolbar: PreviewToolBar }> = [];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let hits: Element[];
let elementsDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
    window.MUYA_VERSION = 'test';
    frames = new Map();
    frameId = 0;
    hits = [];
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
    elementsDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hits });
});

afterEach(() => {
    for (const { muya, toolbar } of opened.splice(0)) {
        toolbar.destroy();
        muya.destroy();
        muya.domNode.remove();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (elementsDescriptor)
        Object.defineProperty(document, 'elementsFromPoint', elementsDescriptor);
    else
        Reflect.deleteProperty(document, 'elementsFromPoint');
    document.getSelection()?.removeAllRanges();
});

function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending)
        callback(0);
}

function boot(markdown = SOURCE) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    muya.domNode.style.overflowY = 'auto';
    const toolbar = new PreviewToolBar(muya);
    opened.push({ muya, toolbar });
    const show = vi.spyOn(toolbar, 'show').mockImplementation(() => {
        toolbar.status = true;
    });
    const blocks = Array.from(muya.domNode.querySelectorAll('.mu-html-block'), element => getBlock(element) as HTMLBlock);
    const emitted = vi.fn<(payload: IEditHtmlLayoutPayload) => void>();
    muya.on('edit-html-layout', emitted);
    return { muya, toolbar, blocks, show, emitted };
}

function hover(block: HTMLBlock, flush = true) {
    hits = [block.attachments!.head!.domNode!, block.domNode!];
    mouseMove(block.attachments!.head!.domNode!);
    if (flush)
        flushFrames();
}

function mouseMove(target: HTMLElement) {
    const event = new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 50 });
    Object.defineProperty(event, 'x', { value: 30 });
    Object.defineProperty(event, 'y', { value: 50 });
    target.dispatchEvent(event);
}

function editButton(toolbar: PreviewToolBar): HTMLElement {
    const button = toolbar.container!.querySelector<HTMLElement>('[role="button"][aria-label="编辑 HTML 布局"]');
    expect(button).not.toBeNull();
    return button!;
}

function click(button: HTMLElement) {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function openLayout(fixture: ReturnType<typeof boot>, index = 0): IEditHtmlLayoutPayload {
    hover(fixture.blocks[index]);
    click(editButton(fixture.toolbar));
    expect(fixture.emitted).toHaveBeenCalledTimes(1);
    return fixture.emitted.mock.calls[0][0];
}

describe('html layout toolbar entry', () => {
    it('opens the hovered HTML block without moving selection, activating source, or changing Markdown', () => {
        const fixture = boot();
        const { muya, blocks, toolbar } = fixture;
        const content = blocks[1].firstContentInDescendant()!;
        const setCursor = vi.spyOn(content, 'setCursor');
        const active = muya.editor.activeContentBlock;
        const selected = muya.editor.selection.getSelection();
        const markdown = muya.getMarkdown();
        muya.domNode.scrollTop = 450;
        const payload = openLayout(fixture, 1);
        expect(payload.html).toBe(SECOND);
        expect(payload.preview).toBe(blocks[1].attachments!.head!.domNode);
        expect(payload.preview.getAttribute('contenteditable')).toBe('false');
        expect(payload.blockPath).toEqual(blocks[1].path);
        expect(setCursor).not.toHaveBeenCalled();
        expect(muya.editor.activeContentBlock).toBe(active);
        expect(muya.editor.selection.getSelection()).toEqual(selected);
        expect(muya.getMarkdown()).toBe(markdown);
        expect(muya.domNode.scrollTop).toBe(450);
        expect(toolbar.status).toBe(false);
    });

    it('keeps the original target while the pointer crosses the floating toolbar', () => {
        const fixture = boot();
        hover(fixture.blocks[0]);
        const button = editButton(fixture.toolbar);
        hover(fixture.blocks[1], false);
        hits = [button, fixture.toolbar.floatBox!];
        mouseMove(button);
        flushFrames();
        click(button);
        expect(fixture.emitted.mock.calls[0][0].html).toBe(FIRST);
    });

    it('cancels pending outside hover on mousedown before click', () => {
        const fixture = boot();
        hover(fixture.blocks[1]);
        const button = editButton(fixture.toolbar);
        hits = [];
        mouseMove(document.body);
        click(button);
        flushFrames();
        expect(fixture.emitted).toHaveBeenCalledTimes(1);
        expect(fixture.emitted.mock.calls[0][0].html).toBe(SECOND);
    });

    it('uses the latest hover in a frame and does not reopen after hide or destroy', () => {
        const fixture = boot();
        hover(fixture.blocks[0], false);
        hover(fixture.blocks[1], false);
        flushFrames();
        expect(fixture.show).toHaveBeenCalledTimes(1);
        click(editButton(fixture.toolbar));
        expect(fixture.emitted.mock.calls[0][0].html).toBe(SECOND);
        hover(fixture.blocks[0], false);
        fixture.toolbar.hide();
        flushFrames();
        expect(fixture.show).toHaveBeenCalledTimes(1);
        hover(fixture.blocks[0], false);
        fixture.toolbar.destroy();
        flushFrames();
        hover(fixture.blocks[0]);
        expect(fixture.show).toHaveBeenCalledTimes(1);
    });

    it('ignores HTML blocks from another Muya instance', () => {
        const original = boot();
        const other = boot();
        hover(original.blocks[0]);
        hover(other.blocks[0]);
        expect(original.toolbar.status).toBe(false);
        expect(other.toolbar.status).toBe(true);
    });

    it('keeps HTML tools disabled when HTML rendering is disabled', () => {
        const fixture = boot();
        fixture.muya.setOptions({ disableHtml: true });
        hover(fixture.blocks[0]);
        expect(fixture.show).not.toHaveBeenCalled();
    });

    it.each(['Enter', ' '])('opens layout with %j without sending editor keystrokes', (key) => {
        const fixture = boot();
        hover(fixture.blocks[0]);
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        const bubbled = vi.fn();
        document.addEventListener('keydown', bubbled);
        try {
            editButton(fixture.toolbar).dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(bubbled).not.toHaveBeenCalled();
            expect(fixture.emitted).toHaveBeenCalledTimes(1);
        }
        finally {
            document.removeEventListener('keydown', bubbled);
        }
    });
});

describe('html layout apply and viewport callbacks', () => {
    it('updates only the captured HTML source and preview, keeping relative image paths and surrounding Markdown', () => {
        const fixture = boot();
        const before = fixture.muya.getMarkdown();
        const payload = openLayout(fixture);
        const next = FIRST.replace('class="layout"', 'class="layout" style="position:relative"').replace('>first<', '>edited<');
        expect(payload.apply(next)).toBe(true);
        expect(fixture.muya.getMarkdown()).toBe(before.replace(FIRST, next));
        expect(payload.preview.textContent).toContain('edited');
        expect(fixture.blocks[1].firstContentInDescendant()!.text).toBe(SECOND);
        expect(payload.apply(next)).toBe(true);
    });

    it('supports one-step undo and redo with matching rendered previews', async () => {
        const fixture = boot();
        const payload = openLayout(fixture);
        const next = FIRST.replace('>first<', '>changed<');
        expect(payload.apply(next)).toBe(true);
        fixture.muya.undo();
        await vi.waitFor(() => expect(fixture.muya.getMarkdown()).toContain(FIRST));
        expect(payload.preview.textContent).toContain('first');
        fixture.muya.redo();
        await vi.waitFor(() => expect(fixture.muya.getMarkdown()).toContain(next));
        expect(payload.preview.textContent).toContain('changed');
    });

    it('refuses to overwrite independently changed source', () => {
        const fixture = boot();
        const payload = openLayout(fixture);
        const content = fixture.blocks[0].firstContentInDescendant()!;
        content.text = FIRST.replace('first', 'outside');
        content.update();
        expect(payload.apply(FIRST.replace('first', 'panel'))).toBe(false);
        expect(content.text).toContain('outside');
        expect(fixture.muya.getMarkdown()).not.toContain('panel');
    });

    it('keeps apply valid after preview updates, focus changes, and appearance changes', () => {
        const fixture = boot();
        const payload = openLayout(fixture);
        const content = fixture.blocks[0].firstContentInDescendant()!;
        content.update();
        fixture.blocks[0].active = true;
        fixture.blocks[0].active = false;
        fixture.muya.setOptions({ fontSize: 18, lineHeight: 1.8 });
        fixture.toolbar.hide();
        flushFrames();
        const next = FIRST.replace('first', 'applied');
        expect(payload.apply(next)).toBe(true);
        expect(fixture.muya.getMarkdown()).toContain(next);
    });

    it('keeps apply valid after unrelated document edits and save snapshot reads', () => {
        const fixture = boot();
        const payload = openLayout(fixture);
        const saveSnapshots = vi.fn(() => ({
            markdown: fixture.muya.getMarkdown(),
            state: fixture.muya.getState(),
            history: fixture.muya.getHistory(),
        }));
        fixture.muya.on('json-change', saveSnapshots);
        const paragraph = fixture.muya.editor.scrollPage!.firstContentInDescendant()!;
        paragraph.text = 'unrelated updated paragraph';
        paragraph.update();
        fixture.muya.flush();
        expect(saveSnapshots).toHaveBeenCalled();
        const next = FIRST.replace('first', 'applied after save');
        expect(payload.apply(next)).toBe(true);
        expect(fixture.muya.getMarkdown()).toContain('unrelated updated paragraph');
        expect(fixture.muya.getMarkdown()).toContain(next);
    });

    it('refuses deleted blocks and document replacement without touching another block', () => {
        const fixture = boot();
        const payload = openLayout(fixture);
        fixture.blocks[0].remove();
        const afterDelete = fixture.muya.getMarkdown();
        expect(payload.apply('<div>new</div>')).toBe(false);
        expect(fixture.muya.getMarkdown()).toBe(afterDelete);
        fixture.muya.setContent(SOURCE);
        expect(payload.apply('<div>new</div>')).toBe(false);
        expect(fixture.muya.getMarkdown()).not.toContain('<div>new</div>');
    });

    it('follows the captured block when preceding blocks are removed', () => {
        const fixture = boot();
        const payload = openLayout(fixture, 1);
        const originalPath = [...payload.blockPath];
        fixture.blocks[0].remove();
        fixture.muya.editor.jsonState.flush();
        expect(fixture.blocks[1].path).not.toEqual(originalPath);
        const next = SECOND.replace('>second<', '>correct target<');
        expect(payload.apply(next)).toBe(true);
        expect(fixture.blocks[1].firstContentInDescendant()!.text).toBe(next);
        expect(fixture.muya.getMarkdown()).toContain(next);
    });

    it('keeps the block screen position after host focus changes or apply changes layout', () => {
        const fixture = boot();
        const { muya, blocks } = fixture;
        let documentTop = 620;
        const rect = vi.spyOn(blocks[0].domNode!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(20, documentTop - muya.domNode.scrollTop, 400, 200));
        muya.domNode.scrollTop = 500;
        muya.domNode.scrollLeft = 24;
        const payload = openLayout(fixture);
        muya.domNode.scrollTop = 150;
        muya.domNode.scrollLeft = 0;
        payload.restoreViewport();
        expect(muya.domNode.scrollTop).toBe(500);
        expect(muya.domNode.scrollLeft).toBe(24);
        expect(rect().top).toBe(120);
        const content = blocks[0].firstContentInDescendant()!;
        const update = content.update.bind(content);
        vi.spyOn(content, 'update').mockImplementation(() => {
            update();
            documentTop += 60;
        });
        expect(payload.apply(FIRST.replace('first', 'taller'))).toBe(true);
        expect(muya.domNode.scrollTop).toBe(560);
        expect(rect().top).toBe(120);
    });

    it('does not scroll a replacement document when the old panel closes', () => {
        const fixture = boot();
        const payload = openLayout(fixture);
        fixture.muya.setContent(SOURCE);
        fixture.muya.domNode.scrollTop = 70;
        payload.restoreViewport();
        expect(fixture.muya.domNode.scrollTop).toBe(70);
    });

    it('keeps delete and non-HTML source editing functional', async () => {
        const fixture = boot();
        hover(fixture.blocks[1]);
        click(fixture.toolbar.container!.querySelector<HTMLElement>('li.delete')!);
        flushFrames();
        await vi.waitFor(() => expect(fixture.muya.getMarkdown()).not.toContain(SECOND));
        expect(fixture.muya.getMarkdown()).toContain(FIRST);
        const math = boot('before\n\n$$\nx+1\n$$\n\nafter');
        const element = math.muya.domNode.querySelector<HTMLElement>('.mu-math-block')!;
        hits = [element];
        mouseMove(element);
        flushFrames();
        click(math.toolbar.container!.querySelector<HTMLElement>('li.edit')!);
        expect(math.muya.editor.activeContentBlock?.text).toBe('x+1');
        expect(math.emitted).not.toHaveBeenCalled();
    });
});
