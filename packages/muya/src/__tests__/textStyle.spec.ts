// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenizer } from '../inlineRenderer/lexer';
import { colorTextRange } from '../inlineRenderer/textStyle';
import { Muya } from '../muya';
import HtmlToMarkdown from '../state/htmlToMarkdown';

const editors: Muya[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    for (const muya of editors.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function select(muya: Muya, leaf: Content, start: number, end: number): void {
    muya.editor.selection.setSelection(
        { block: leaf, path: leaf.path, offset: start },
        { block: leaf, path: leaf.path, offset: end },
    );
}

function firstLeaf(muya: Muya): Content {
    return muya.editor.scrollPage!.firstContentInDescendant()!;
}

describe('portable text colors', () => {
    it('keeps both colors in one span through repeated changes, selection, undo and reopen', () => {
        const muya = boot('hello world');
        const leaf = firstLeaf(muya);
        select(muya, leaf, 0, 5);
        muya.applyTextColor('color', '#f00');
        expect(leaf.text).toBe('<span style="color:#ff0000">hello</span> world');
        expect(muya.editor.selection.anchor!.offset).toBe(leaf.text.indexOf('hello'));
        expect(muya.editor.selection.focus!.offset).toBe(leaf.text.indexOf('hello') + 5);
        muya.applyTextColor('background-color', '#fff000');
        const both = '<span style="color:#ff0000;background-color:#fff000">hello</span> world';
        expect(leaf.text).toBe(both);
        expect(leaf.domNode!.querySelector('span[style]')?.getAttribute('style')).toContain('background-color:#fff000');
        expect(leaf.domNode!.querySelectorAll('.mu-html-tag')).toHaveLength(0);
        muya.undo();
        expect(firstLeaf(muya).text).toBe('<span style="color:#ff0000">hello</span> world');
        muya.redo();
        expect(firstLeaf(muya).text).toBe(both);
        const reopened = boot(muya.getMarkdown());
        expect(firstLeaf(reopened).text).toBe(both);
        expect(firstLeaf(reopened).domNode!.querySelector('span[style]')?.getAttribute('style')).toContain('color:#ff0000');
    });

    it('splits a colored span for a partial recolor without nested spans or lost surrounding colors', () => {
        const source = '<span style="color:#ff0000">hello world</span>';
        const start = source.indexOf('world');
        const result = colorTextRange(source, start, start + 5, 'color', '#0000ff')!;
        expect(result.text).toBe('<span style="color:#ff0000">hello </span><span style="color:#0000ff">world</span>');
        const reset = colorTextRange(result.text, result.start, result.end, 'color', null)!;
        expect(reset.text).toBe('<span style="color:#ff0000">hello </span>world');
    });

    it('does not cut bold markers or link destinations when selection crosses their text', () => {
        const text = 'one **bold** [link](https://example.com) end';
        const result = colorTextRange(text, 0, text.length, 'color', '#125678')!;
        expect(result.text).toContain('**<span style="color:#125678">bold</span>**');
        expect(result.text).toContain('[<span style="color:#125678">link</span>](https://example.com)');
        expect(result.text).not.toContain('color:#125678">https');
    });

    it('preserves a backward selection across nested paragraphs and skips heading markers', () => {
        const muya = boot('> # first\n>\n> second');
        const first = firstLeaf(muya);
        const last = first.nextContentInContext()!;
        muya.editor.selection.setSelection(
            { block: last, path: last.path, offset: last.text.length },
            { block: first, path: first.path, offset: 0 },
        );
        muya.applyTextColor('color', '#123456');
        expect(first.text).toBe('# <span style="color:#123456">first</span>');
        expect(last.text).toBe('<span style="color:#123456">second</span>');
        expect(muya.editor.selection.anchorBlock).toBe(last);
        expect(muya.editor.selection.focusBlock).toBe(first);
        muya.undo();
        expect(muya.getMarkdown()).toContain('> # first');
        expect(muya.getMarkdown()).not.toContain('<span');
    });

    it('rejects arbitrary CSS and leaves a caret unchanged', () => {
        const muya = boot('hello');
        const leaf = firstLeaf(muya);
        select(muya, leaf, 0, 5);
        muya.applyTextColor('color', '#000000;position:fixed');
        expect(leaf.text).toBe('hello');
        select(muya, leaf, 2, 2);
        muya.applyTextColor('color', '#ff0000');
        expect(leaf.text).toBe('hello');
    });

    it('recolors pasted CSS-normalized RGB spans without adding another wrapper', () => {
        const source = '<span style="color: rgb(255, 0, 0); background-color: rgb(255, 255, 0);">hello</span>';
        const start = source.indexOf('hello');
        const result = colorTextRange(source, start, start + 5, 'color', '#0000ff')!;
        expect(result.text).toBe('<span style="color:#0000ff;background-color:#ffff00">hello</span>');
    });

    it.each([
        ['<font color="#ff0000">hello</font>', 'color'],
        ['<mark style="background:#ffff00">hello</mark>', 'background-color'],
        ['<span style="color:red">hello</span>', 'color'],
        ['<span style="background-color:rgba(255, 255, 0, 0.5)">hello</span>', 'background-color'],
        ['<span style="color:hsl(0, 100%, 50%)">hello</span>', 'color'],
    ] as const)('clears imported toolbar color %s without leaving inherited color', (source, property) => {
        const start = source.indexOf('hello');
        expect(colorTextRange(source, start, start + 5, property, null)?.text).toBe('hello');
    });

    it('preserves semantic marks and arbitrary attributes while styling their text', () => {
        const source = '<mark>hello</mark> <font color="#ff0000" data-custom="x">other</font>';
        const result = colorTextRange(source, 0, source.length, 'background-color', '#ffff00')!;
        expect(result.text).toContain('<mark><span style="background-color:#ffff00">hello</span></mark>');
        expect(result.text).toContain('<font color="#ff0000" data-custom="x">');
    });

    it.each(['[site]', '[site][]', '[site][ref]'])('keeps reference link targets when styling %s', (link) => {
        const definition = link.endsWith('[ref]') ? 'ref' : 'site';
        const muya = boot(`${link}\n\n[${definition}]: https://example.com`);
        const leaf = firstLeaf(muya);
        select(muya, leaf, 1, 5);
        muya.applyTextColor('color', '#ff0000');
        expect(leaf.text).toBe(`[<span style="color:#ff0000">site</span>][${definition}]`);
        expect(leaf.domNode!.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
        const reopened = boot(muya.getMarkdown());
        expect(firstLeaf(reopened).domNode!.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    });

    it.each(['https://example.com', '<https://example.com>'])('colors URL %s atomically without changing its link target', (url) => {
        const muya = boot(url);
        const leaf = firstLeaf(muya);
        select(muya, leaf, 1, leaf.text.length - 1);
        muya.applyTextColor('color', '#ff0000');
        expect(leaf.text).toBe(`<span style="color:#ff0000">${url}</span>`);
        expect(leaf.domNode!.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
        expect(leaf.domNode!.querySelector('.mu-text-color')).not.toBeNull();
    });
});

describe('paragraph alignment', () => {
    it.each(['left', 'center', 'right', 'justify'] as const)('replaces nested and split alignments with one %s alignment without losing colors or selection', (alignment) => {
        const muya = boot('<span style="display:block;text-align:center"><span style="color:#ff0000"><span style="display:block;text-align:right">hello</span></span></span> world');
        const leaf = firstLeaf(muya);
        const start = leaf.text.indexOf('hello');
        const before = muya.getMarkdown();
        select(muya, leaf, start, start + 5);
        muya.alignParagraph(alignment);
        expect(leaf.text.match(/text-align:/g)).toHaveLength(1);
        expect(leaf.text).toBe(`<span style="display:block;text-align:${alignment}"><span style="color:#ff0000">hello</span> world</span>`);
        expect(muya.getSelectedText()).toBe('hello');
        const after = muya.getMarkdown();
        muya.undo();
        expect(muya.getMarkdown()).toBe(before);
        muya.redo();
        expect(muya.getMarkdown()).toBe(after);
    });

    it('switches all alignments consecutively, preserving styled text, then clears alignment', () => {
        const muya = boot('before **hello** after');
        const leaf = firstLeaf(muya);
        select(muya, leaf, 9, 14);
        for (const alignment of ['center', 'right', 'left', 'justify', 'center', 'left'] as const) {
            muya.alignParagraph(alignment);
            expect(leaf.text.match(/text-align:/g)).toHaveLength(1);
            expect(leaf.text).toContain(`text-align:${alignment}`);
            expect(muya.getSelectedText()).toBe('hello');
        }
        muya.alignParagraph(null);
        expect(leaf.text).toBe('before **hello** after');
        expect(muya.getSelectedText()).toBe('hello');
    });

    it('retains editable colored paragraphs and heading syntax after alignment changes and reopen', () => {
        const muya = boot('# hello');
        const leaf = firstLeaf(muya);
        select(muya, leaf, 2, 7);
        muya.applyTextColor('color', '#ff0000');
        muya.alignParagraph('center');
        expect(leaf.text).toBe('# <span style="display:block;text-align:center"><span style="color:#ff0000">hello</span></span>');
        expect(leaf.domNode!.querySelectorAll('.mu-raw-html')).toHaveLength(2);
        expect(tokenizer(leaf.text).find(token => token.type === 'html_tag')?.raw).toContain('</span></span>');
        const reopened = boot(muya.getMarkdown());
        expect(firstLeaf(reopened).parent!.blockName).toBe('atx-heading');
        expect(firstLeaf(reopened).text).toBe(leaf.text);
        muya.alignParagraph('right');
        expect(leaf.text.match(/display:block/g)).toHaveLength(1);
        muya.alignParagraph(null);
        expect(leaf.text).toBe('# <span style="color:#ff0000">hello</span>');
    });

    it('aligns the paragraph at a caret and makes the change independently undoable', () => {
        const muya = boot('hello world');
        const leaf = firstLeaf(muya);
        select(muya, leaf, 3, 3);
        muya.alignParagraph('center');
        expect(leaf.text).toContain('text-align:center');
        expect(muya.editor.selection.anchor!.offset).toBe(leaf.text.indexOf('hello') + 3);
        muya.undo();
        expect(firstLeaf(muya).text).toBe('hello world');
    });

    it('resets and realigns a combined color/alignment span without retaining the prior style', () => {
        const muya = boot('<span style="color:red;display:block;text-align:center">hello</span>');
        const leaf = firstLeaf(muya);
        const start = leaf.text.indexOf('hello');
        select(muya, leaf, start, start + 5);
        muya.alignParagraph('right');
        expect(leaf.text).toBe('<span style="display:block;text-align:right"><span style="color:red">hello</span></span>');
        expect(muya.editor.selection.anchor!.offset).toBe(leaf.text.indexOf('hello'));
        muya.applyTextColor('color', null);
        expect(leaf.text).toBe('<span style="display:block;text-align:right">hello</span>');
        expect(leaf.domNode!.querySelector('span[style]')?.getAttribute('style')).toContain('text-align:right');
    });

    it('leaves reference definitions unchanged when alignment is requested', () => {
        const muya = boot('[ref]: https://example.com');
        const leaf = firstLeaf(muya);
        select(muya, leaf, 0, leaf.text.length);
        muya.alignParagraph('center');
        expect(leaf.text).toBe('[ref]: https://example.com');
    });
});

describe('html copy and paste', () => {
    it('preserves color, background, alignment and semantic formatting when converting rich HTML to Markdown', () => {
        const result = new HtmlToMarkdown().generate('<p><span style="display:block;text-align:center"><span style="color:#ff0000;background-color:#ffff00;font-weight:bold">hello</span></span></p>');
        expect(result).toContain('color:');
        expect(result).toContain('background-color:');
        expect(result).toContain('text-align: center');
        expect(result).toContain('**hello**');
        expect(result).not.toContain('font-weight:');
    });

    it('can realign a pasted alignment wrapper without nesting it', () => {
        const result = new HtmlToMarkdown().generate('<p><span style="display:block;text-align:center">hello</span></p>');
        const muya = boot(result);
        const leaf = firstLeaf(muya);
        const start = leaf.text.indexOf('hello');
        select(muya, leaf, start, start + 5);
        muya.alignParagraph('right');
        expect(leaf.text).toBe('<span style="display:block;text-align:right">hello</span>');
    });
});
