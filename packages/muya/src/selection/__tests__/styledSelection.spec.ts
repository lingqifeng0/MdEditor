// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { getNodeAndOffset, getOffsetOfParagraph } from '../dom';

const editors: Muya[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const muya of editors.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string): { muya: Muya; leaf: Format } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return { muya, leaf: muya.editor.scrollPage!.firstContentInDescendant()! as Format };
}

function selectNode(node: Node, start: number, end = start): void {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
}

describe('selection in portable styled text', () => {
    it.each([
        '<span style="color:#e0190f;background-color:#fff3a3">你好</span>',
        '<span style="display:block;text-align:center"><span style="color:#e0190f">你好</span></span>',
    ])('restores the content start into visible text without changing source offsets: %s', (source) => {
        const { muya, leaf } = boot(source);
        const start = source.indexOf('你好');
        const endpoint = getNodeAndOffset(leaf.domNode!, start);
        expect(endpoint.node.textContent).toBe('你好');
        expect(endpoint.offset).toBe(0);
        expect(getOffsetOfParagraph(endpoint.node, leaf.domNode!) + endpoint.offset).toBe(start);

        leaf.setCursor(start + 2, start);
        expect(document.getSelection()!.focusNode?.textContent).toBe('你好');
        expect(document.getSelection()!.focusOffset).toBe(0);
        expect(muya.getMarkdown()).toBe(`${source}\n`);
    });

    it('keeps DOM text and source intact during a selection-only keyup', () => {
        const source = '<span style="color:#e0190f;background-color:#fff3a3">你好</span>';
        const { muya, leaf } = boot(source);
        const start = source.indexOf('你好');
        leaf.setCursor(start, start);
        const text = leaf.domNode!.querySelector('.mu-plain-text')!.firstChild!;
        const update = vi.spyOn(leaf, 'update');
        selectNode(text, 0, 2);
        leaf.keyupHandler();

        expect(update).not.toHaveBeenCalled();
        expect(leaf.domNode!.querySelector('.mu-plain-text')!.firstChild).toBe(text);
        expect(document.getSelection()!.toString()).toBe('你好');
        expect(muya.editor.selection.anchor!.offset).toBe(start);
        expect(muya.editor.selection.focus!.offset).toBe(start + 2);
        expect(muya.getMarkdown()).toBe(`${source}\n`);
    });

    it('still rerenders nested Markdown markers and ordinary HTML on selection moves', () => {
        const styled = boot('<span style="color:#ff0000">**你好**</span>').leaf;
        const ordinary = boot('<u>你好</u>').leaf;
        for (const leaf of [styled, ordinary]) {
            const offset = leaf.text.indexOf('你好');
            expect(leaf.checkNeedRender({ anchor: { offset }, focus: { offset: offset + 2 } }, true)).toBe(true);
        }
    });

    it('retains input rendering and saves inserted Chinese text inside both colors', () => {
        const { muya, leaf } = boot('<span style="color:#e0190f;background-color:#fff3a3">你好</span>');
        const text = leaf.domNode!.querySelector('.mu-plain-text')!.firstChild!;
        text.textContent = '你好呀';
        selectNode(text, 3);
        const update = vi.spyOn(leaf, 'update');
        leaf.inputHandler(new InputEvent('input', { inputType: 'insertText', data: '呀' }));
        muya.flush();

        expect(update).toHaveBeenCalled();
        expect(leaf.text).toBe('<span style="color:#e0190f;background-color:#fff3a3">你好呀</span>');
        expect(leaf.domNode!.querySelector('.mu-plain-text')!.textContent).toBe('你好呀');
        expect(muya.getMarkdown()).toContain('你好呀</span>');
        expect(document.getSelection()!.anchorNode?.textContent).toBe('你好呀');
    });

    it.each(['ArrowLeft', 'ArrowRight'])('collapses a complete styled selection onto visible text with %s', (key) => {
        const source = '<span style="color:#e0190f;background-color:#fff3a3">你好</span>';
        const { muya, leaf } = boot(source);
        leaf.setCursor(0, source.length);
        const event = new KeyboardEvent('keydown', { key, cancelable: true });
        leaf.arrowHandler(event);

        expect(event.defaultPrevented).toBe(true);
        expect(document.getSelection()!.anchorNode?.textContent).toBe('你好');
        expect(document.getSelection()!.anchorOffset).toBe(key === 'ArrowLeft' ? 0 : 2);
        expect(muya.editor.selection.anchor!.offset).toBe(source.indexOf('你好') + (key === 'ArrowLeft' ? 0 : 2));
        expect(muya.getMarkdown()).toBe(`${source}\n`);
    });

    it('moves one visible character across either side of a colored span', () => {
        const source = 'A<span style="color:#ff0000">你好</span>B';
        const { muya, leaf } = boot(source);
        const start = source.indexOf('你好');
        leaf.setCursor(start, start);
        leaf.arrowHandler(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
        expect(document.getSelection()!.anchorNode?.textContent).toBe('A');
        expect(document.getSelection()!.anchorOffset).toBe(0);
        leaf.setCursor(start + 2, start + 2);
        leaf.arrowHandler(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
        expect(document.getSelection()!.anchorNode?.textContent).toBe('B');
        expect(document.getSelection()!.anchorOffset).toBe(1);
        expect(muya.getMarkdown()).toBe(`${source}\n`);
    });

    it('keeps a grapheme whole when entering a style span through an arrow', () => {
        const source = 'A<span style="color:#ff0000">🙂好</span>';
        const { leaf } = boot(source);
        leaf.setCursor(1, 1);
        leaf.arrowHandler(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
        expect(document.getSelection()!.anchorNode?.textContent).toBe('🙂好');
        expect(document.getSelection()!.anchorOffset).toBe(2);
    });

    it('keeps document-edge carets visible and crosses an existing paragraph', () => {
        const source = '<span style="color:#ff0000">你好</span>';
        const { muya, leaf } = boot(`${source}\n\nNext`);
        const start = source.indexOf('你好');
        leaf.setCursor(start, start);
        leaf.arrowHandler(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
        expect(document.getSelection()!.anchorNode?.textContent).toBe('你好');
        expect(document.getSelection()!.anchorOffset).toBe(0);
        leaf.setCursor(start + 2, start + 2);
        leaf.arrowHandler(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
        expect(muya.editor.selection.focusBlock?.text).toBe('Next');
        expect(muya.editor.selection.focus!.offset).toBe(0);
        expect(muya.getMarkdown()).toBe(`${source}\n\nNext\n`);
    });

    it('clamps Home/End keyboard endpoints away from hidden style tags', () => {
        const source = '<span style="color:#ff0000">你好</span>';
        const { leaf } = boot(source);
        leaf.setCursor(source.length, source.length);
        leaf.keyupHandler(new KeyboardEvent('keyup', { key: 'End' }));
        expect(document.getSelection()!.anchorNode?.textContent).toBe('你好');
        expect(document.getSelection()!.anchorOffset).toBe(2);
        leaf.setCursor(0, 0);
        leaf.keyupHandler(new KeyboardEvent('keyup', { key: 'Home' }));
        expect(document.getSelection()!.anchorNode?.textContent).toBe('你好');
        expect(document.getSelection()!.anchorOffset).toBe(0);
    });

    it.each([false, true])('formats visible Chinese text when a drag includes hidden opening source (backward: %s)', (backward) => {
        const source = '<span style="color:#e0190f;background-color:#fff3a3">你好</span>';
        const { muya, leaf } = boot(source);
        const end = source.indexOf('你好') + 2;
        leaf.setCursor(backward ? end : 0, backward ? 0 : end);
        leaf.format('strong');
        muya.flush();

        expect(leaf.text).toBe('<span style="color:#e0190f;background-color:#fff3a3">**你好**</span>');
        expect(leaf.domNode!.querySelector('strong')!.textContent).toBe('你好');
        expect(leaf.domNode!.querySelector('.mu-raw-html')?.getAttribute('style')).toContain('background-color:#fff3a3');
        expect(muya.getMarkdown()).toBe(`${leaf.text}\n`);
        leaf.format('strong');
        muya.flush();
        expect(leaf.text).toBe(source);
    });

    it('formats a complete nested alignment/color selection inside both portable wrappers', () => {
        const source = '<span style="display:block;text-align:center"><span style="color:#ff0000">你好</span></span>';
        const { leaf } = boot(source);
        leaf.setCursor(0, source.length);
        leaf.format('em');
        expect(leaf.text).toBe('<span style="display:block;text-align:center"><span style="color:#ff0000">*你好*</span></span>');
        expect(leaf.domNode!.querySelector('em')!.textContent).toBe('你好');
    });
});
