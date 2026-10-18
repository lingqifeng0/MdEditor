// @vitest-environment happy-dom

import type HTMLBlock from '../index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';
import { getBlock } from '../../../../utils/dom';

const HTML = '<p style="position: relative; height: 154px; width: 650px">\n<img src="images/first.png" width="180" />\n<img src="images/second.png" width="97" style="transform: translate(-3.594px, 50px)" />\n</p>';
const opened: Muya[] = [];
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
    for (const muya of opened.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending)
        callback(0);
}

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    opened.push(muya);
    flushFrames();
    const element = muya.domNode.querySelector<HTMLElement>('.mu-html-block')!;
    const block = getBlock(element) as HTMLBlock;
    const changed = vi.fn();
    muya.on('json-change', changed);
    return { muya, block, changed };
}

function visitSource(fixture: ReturnType<typeof boot>) {
    const { muya, block } = fixture;
    const content = block.firstContentInDescendant()!;
    content.setCursor(0, 0, true);
    muya.editor.activeContentBlock = content;
    flushFrames();
    expect(block.active).toBe(true);
    expect(block.domNode!.classList.contains('mu-active')).toBe(true);
    content.domNode!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    flushFrames();
    muya.blur(false, true);
    flushFrames();
    muya.flush();
    expect(block.active).toBe(false);
}

function snapshot(muya: Muya) {
    return { markdown: muya.getMarkdown(), state: muya.getState(), history: muya.getHistory() };
}

describe('viewing HTML source without editing', () => {
    it.each([
        ['HTML as the whole document', HTML],
        ['HTML at the document end', `before\n\n${HTML}\n`],
        ['HTML between existing paragraphs', `before\n\n${HTML}\n\nafter\n`],
        ['image paragraph containing blank lines', HTML.replace('<img src="images/second', '\n<img src="images/second')],
    ])('keeps Markdown, state, and undo history unchanged for %s', (_name, markdown) => {
        const fixture = boot(markdown);
        const before = snapshot(fixture.muya);
        visitSource(fixture);
        expect(snapshot(fixture.muya)).toEqual(before);
        expect(fixture.changed).not.toHaveBeenCalled();
    });

    it('preserves an actual earlier source edit when the user subsequently only views source', () => {
        const fixture = boot(`before\n\n${HTML}\n\nafter\n`);
        const content = fixture.block.firstContentInDescendant()!;
        content.text = HTML.replace('width="180"', 'width="181"');
        content.update();
        fixture.muya.flush();
        expect(fixture.changed).toHaveBeenCalledTimes(1);
        const edited = snapshot(fixture.muya);
        visitSource(fixture);
        expect(snapshot(fixture.muya)).toEqual(edited);
        expect(fixture.changed).toHaveBeenCalledTimes(1);
    });

    it('still emits a document change for an actual source edit after viewing', () => {
        const fixture = boot(HTML);
        visitSource(fixture);
        const content = fixture.block.firstContentInDescendant()!;
        content.text = HTML.replace('width="180"', 'width="181"');
        content.update();
        fixture.muya.flush();
        expect(fixture.changed).toHaveBeenCalledTimes(1);
        expect(fixture.muya.getMarkdown()).toContain('width="181"');
    });
});
