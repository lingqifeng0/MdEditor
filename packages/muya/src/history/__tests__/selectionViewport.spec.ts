// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
beforeEach(() => {
    window.MUYA_VERSION = 'test';
});
afterEach(() => {
    for (const muya of editors.splice(0)) muya.destroy();
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
});

function boot(): { muya: Muya; target: Content } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: 'old caret at top\n\nsecond paragraph\n\ntarget word' });
    muya.init();
    editors.push(muya);
    return { muya, target: muya.editor.scrollPage!.lastContentInDescendant()! };
}

function edit(muya: Muya, target: Content, text: string): void {
    muya.editor.history.cutoff();
    target.text = text;
    target.setCursor(text.length, text.length, true);
    muya.flush();
}

describe('history caret snapshots and viewport', () => {
    it('notifies the host to stop prior scrolling before replay changes the DOM', () => {
        const { muya, target } = boot();
        target.setCursor(11, 11, true);
        edit(muya, target, 'target word!');
        const sequence: string[] = [];
        muya.eventCenter.on('history-will-change', () => {
            expect(muya.editor.history.isChanging).toBe(true);
            sequence.push('stop-host-scroll');
        });
        const replay = muya.editor.updateContents.bind(muya.editor);
        vi.spyOn(muya.editor, 'updateContents').mockImplementation((...args) => {
            sequence.push('replace-dom');
            replay(...args);
        });
        muya.undo();
        expect(sequence).toEqual(['stop-host-scroll', 'replace-dom']);
        sequence.length = 0;
        muya.redo();
        expect(sequence).toEqual(['stop-host-scroll', 'replace-dom']);
    });

    it('undoes both spaces in the current paragraph, including the first history entry', () => {
        const { muya, target } = boot();
        target.setCursor(target.text.length, target.text.length, true);
        edit(muya, target, 'target word ');
        edit(muya, target, 'target word  ');
        muya.undo();
        expect(target.text).toBe('target word ');
        expect(muya.getSelection()?.anchor.block).toBe(target);
        expect(muya.getSelection()?.anchor.offset).toBe(12);
        muya.undo();
        expect(target.text).toBe('target word');
        expect(muya.getSelection()?.anchor.block).toBe(target);
        expect(muya.getSelection()?.anchor.offset).toBe(11);
        muya.redo();
        muya.redo();
        expect(target.text).toBe('target word  ');
        expect(muya.getSelection()?.anchor.block).toBe(target);
    });

    it('flushes a pending native edit before undo is dispatched', () => {
        const { muya, target } = boot();
        target.setCursor(11, 11, true);
        target.text += ' ';
        target.setCursor(12, 12, true);
        muya.undo();
        expect(target.text).toBe('target word');
        expect(muya.getSelection()?.anchor.block).toBe(target);
        expect(muya.getSelection()?.anchor.offset).toBe(11);
    });

    it('stores the color selection instead of the previous edit in a different paragraph', () => {
        const { muya, target } = boot();
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(0, 0, true);
        edit(muya, first, 'old caret at top!');
        target.setCursor(0, 6, true);
        muya.applyTextColor('color', '#12345680');
        muya.applyTextColor('background-color', '#65432140');
        muya.undo();
        muya.undo();
        expect(target.text).toBe('target word');
        expect(muya.getSelection()?.anchor.block).toBe(target);
        expect(muya.getSelection()?.anchor.offset).toBe(0);
        expect(muya.getSelection()?.focus.offset).toBe(6);
        expect(first.text).toBe('old caret at top!');
    });

    it('leaves cached and saved paths intact through focus, lookup and repeated undo/redo', () => {
        const { muya, target } = boot();
        target.setCursor(4, 4, true);
        const path = [...muya.editor.selection.anchorPath];
        expect(muya.editor.scrollPage!.queryBlock(path)).toBe(target);
        expect(path).toEqual(target.path);
        muya.focus();
        expect(muya.editor.selection.anchorPath).toEqual(target.path);
        edit(muya, target, 'target word!');
        const saved = muya.getHistory();
        const savedPath = [...saved.stack.undo[0].selection!.anchor.path];
        muya.setHistory(saved);
        for (let i = 0; i < 3; i++) {
            muya.undo();
            muya.redo();
            expect(muya.getSelection()?.anchor.path).toEqual(target.path);
        }
        expect(saved.stack.undo[0].selection!.anchor.path).toEqual(savedPath);
    });

    it('restores scroll synchronously and after caret scrolling, then releases protection', async () => {
        const { muya, target } = boot();
        target.setCursor(11, 11, true);
        edit(muya, target, 'target word!');
        muya.domNode.scrollTop = 720;
        muya.domNode.scrollLeft = 36;
        const replay = muya.editor.updateContents.bind(muya.editor);
        vi.spyOn(muya.editor, 'updateContents').mockImplementation((...args) => {
            replay(...args);
            muya.domNode.scrollTop = 0;
            muya.domNode.scrollLeft = 0;
        });
        muya.undo();
        expect(muya.domNode.scrollTop).toBe(720);
        expect(muya.domNode.scrollLeft).toBe(36);
        expect(muya.editor.history.isChanging).toBe(true);
        muya.domNode.scrollTop = 0;
        await vi.waitFor(() => expect(muya.editor.history.isChanging).toBe(false));
        expect(muya.domNode.scrollTop).toBe(720);
        expect(target.text).toBe('target word');
    });

    it('does not override a wheel scroll that arrives after undo', async () => {
        const { muya, target } = boot();
        target.setCursor(11, 11, true);
        edit(muya, target, 'target word!');
        muya.domNode.scrollTop = 700;
        muya.undo();
        muya.domNode.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        muya.domNode.scrollTop = 820;
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(muya.editor.history.isChanging).toBe(false);
        expect(muya.domNode.scrollTop).toBe(820);
    });
});
