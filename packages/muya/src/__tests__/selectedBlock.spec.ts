// @vitest-environment happy-dom

import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type { ImageToken } from '../inlineRenderer/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';

const editors: Muya[] = [];
beforeEach(() => {
    window.MUYA_VERSION = 'test';
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
    for (const muya of editors.splice(0))
        muya.destroy();
    document.getSelection()?.removeAllRanges();
    vi.unstubAllGlobals();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, superSubScript: false });
    muya.init();
    editors.push(muya);
    return muya;
}

function leaves(muya: Muya): Content[] {
    const result: Content[] = [];
    let leaf = muya.editor.scrollPage!.firstContentInDescendant();
    while (leaf) {
        result.push(leaf);
        leaf = leaf.nextContentInContext() ?? null;
    }
    return result;
}

describe.each(['code-block', 'math-block'] as const)('selection conversion to %s', (type) => {
    it.each([false, true])('uses the text range instead of an earlier image selection, detached=%s', (detached: boolean) => {
        const muya = boot('![image](https://example.com/owned.png)\n\nbefore target after');
        const imageBlock = leaves(muya)[0] as Format;
        const token = { type: 'image', raw: imageBlock.text, range: { start: 0, end: imageBlock.text.length } } as unknown as ImageToken;
        muya.editor.selection.selectImage({ block: imageBlock, token, imageId: 'earlier-image' });
        if (detached)
            muya.setContent('before target after');
        const deleteImage = vi.spyOn(imageBlock, 'deleteImage');
        const leaf = leaves(muya).find(content => content.text.includes('target'))!;
        const start = leaf.text.indexOf('target');
        leaf.setCursor(start, start + 6, true);
        const before = muya.getMarkdown();
        muya.toggleSelectedBlock(type);
        const content = leaves(muya).find(content => content.getAnchor()?.blockName === type && content.blockName !== 'language-input');
        expect(content?.text).toBe('target');
        expect(deleteImage).not.toHaveBeenCalled();
        expect(muya.editor.selection.image).toBeNull();
        if (!detached)
            expect(muya.getMarkdown()).toContain('![image]');
        const after = muya.getMarkdown();
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
        muya.redo();
        expect(muya.getMarkdown()).toBe(after);
    });

    it.each(['**before target after**', '<span style="color:#ff0000">before target after</span>', '<u>before <sup>target</sup> after</u>'])('keeps outside inline formatting balanced when extracting %s', (text: string) => {
        const muya = boot(text);
        const before = muya.getMarkdown();
        const leaf = leaves(muya)[0];
        const start = leaf.text.indexOf('target');
        leaf.setCursor(start, start + 6, true);
        muya.toggleSelectedBlock(type);
        const converted = leaves(muya).find(content => content.getAnchor()?.blockName === type && content.blockName !== 'language-input');
        expect(converted?.text).toBe('target');
        const state = muya.getState();
        expect(state[0]).toMatchObject({ name: 'paragraph' });
        expect(state[state.length - 1]).toMatchObject({ name: 'paragraph' });
        const markdown = muya.getMarkdown();
        const reopened = boot(markdown);
        expect(reopened.getMarkdown()).toBe(markdown);
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
    });

    it.each(['', '- ', '> ', '### '])('wraps only a partial selection in container %j, with exact undo/redo', (prefix: string) => {
        const muya = boot(`${prefix}before target after\n\nfollowing`);
        const before = muya.getMarkdown();
        const leaf = leaves(muya)[0];
        const start = leaf.text.indexOf('target');
        leaf.setCursor(start, start + 6, true);
        muya.toggleSelectedBlock(type);
        const after = muya.getMarkdown();
        const block = leaves(muya).find(content => content.getAnchor()?.blockName === type && content.blockName !== 'language-input');
        expect(block?.text).toBe('target');
        expect(leaves(muya).map(content => content.text)).toEqual(expect.arrayContaining([' after', 'following']));
        expect(after.match(/target/g)).toHaveLength(1);
        expect(after).toContain('before');
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
        muya.redo();
        expect(muya.getMarkdown()).toBe(after);
    });

    it.each([false, true])('wraps a cross-paragraph selection, backward=%s', (backward: boolean) => {
        const muya = boot('before first\n\nsecond after\n\nfollowing');
        const before = muya.getMarkdown();
        const [first, last] = leaves(muya);
        const start = { block: first, path: first.path, offset: 7 };
        const end = { block: last, path: last.path, offset: 6 };
        muya.editor.selection.setSelection(backward ? end : start, backward ? start : end);
        muya.toggleSelectedBlock(type);
        expect(muya.getState()).toEqual([
            expect.objectContaining({ name: 'paragraph', text: 'before ' }),
            expect.objectContaining({ name: type, text: 'first\nsecond' }),
            expect.objectContaining({ name: 'paragraph', text: ' after' }),
            expect.objectContaining({ name: 'paragraph', text: 'following' }),
        ]);
        const after = muya.getMarkdown();
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
        muya.redo();
        expect(muya.getMarkdown()).toBe(after);
    });

    it('converts selected list items without inserting an empty block or losing later items', () => {
        const muya = boot('- first\n- second\n- following');
        const before = muya.getMarkdown();
        const [first, second] = leaves(muya);
        muya.editor.selection.setSelection({ block: first, path: first.path, offset: 0 }, { block: second, path: second.path, offset: second.text.length });
        muya.toggleSelectedBlock(type);
        const blocks = leaves(muya).filter(leaf => leaf.getAnchor()?.blockName === type && leaf.blockName !== 'language-input');
        expect(blocks.map(leaf => leaf.text)).toEqual(['first\nsecond']);
        expect(muya.getMarkdown()).toContain('following');
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
    });

    it('toggles an existing block back into text and restores it on undo', () => {
        const muya = boot(type === 'code-block' ? '```\nfirst\nsecond\n```' : '$$\nfirst\nsecond\n$$');
        const before = muya.getMarkdown();
        const leaf = leaves(muya).find(leaf => leaf.blockName !== 'language-input')!;
        leaf.setCursor(0, leaf.text.length, true);
        muya.toggleSelectedBlock(type);
        expect(muya.getState()[0]).toMatchObject({ name: 'paragraph', text: 'first\nsecond' });
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
    });
});
