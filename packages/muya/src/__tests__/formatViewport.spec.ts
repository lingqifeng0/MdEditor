// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const editors: Muya[] = [];
afterEach(() => {
    editors.splice(0).forEach(muya => muya.destroy());
    document.getSelection()?.removeAllRanges();
});

function boot() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: 'before\n\ntarget word\n\nafter' });
    muya.init();
    editors.push(muya);
    const leaf = muya.editor.scrollPage!.firstContentInDescendant()!.nextContentInContext()!;
    leaf.setCursor(0, leaf.text.length, true);
    muya.domNode.scrollTop = 1200;
    return muya;
}

describe('formatting viewport ownership', () => {
    const commands: Array<[string, (muya: Muya) => void]> = [
        ['code block', muya => muya.toggleSelectedBlock('code-block')],
        ['math block', muya => muya.toggleSelectedBlock('math-block')],
        ['heading', muya => muya.updateParagraph('heading 2')],
        ['table', muya => muya.createTable({ rows: 3, columns: 2 })],
        ['bold', muya => muya.format('strong')],
        ['font color', muya => muya.applyTextColor('color', '#123456')],
        ['alignment', muya => muya.alignParagraph('center')],
    ];

    it.each(commands)('blocks transient caret scrolling during %s', async (_name, command) => {
        const muya = boot();
        const guards: boolean[] = [];
        muya.on('selection-change', () => {
            guards.push(muya.isViewportPreserved);
            if (!muya.isViewportPreserved)
                muya.domNode.scrollTop = 0;
        });
        command(muya);
        expect(guards.length).toBeGreaterThan(0);
        expect(guards.every(Boolean)).toBe(true);
        expect(muya.domNode.scrollTop).toBe(1200);
        expect(muya.getMarkdown()).toContain('target word');
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(muya.isViewportPreserved).toBe(false);
    });

    it('restores browser range scrolling on the next frame and releases protection for new input', async () => {
        const muya = boot();
        muya.toggleSelectedBlock('math-block');
        muya.domNode.scrollTop = 0;
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(muya.domNode.scrollTop).toBe(1200);
        document.dispatchEvent(new Event('wheel'));
        expect(muya.isViewportPreserved).toBe(false);
        muya.domNode.scrollTop = 900;
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(muya.domNode.scrollTop).toBe(900);
    });

    it('starts consecutive commands at the current viewport rather than an older saved position', () => {
        const muya = boot();
        muya.format('strong');
        muya.domNode.scrollTop = 800;
        muya.applyTextColor('color', '#abcdef');
        expect(muya.domNode.scrollTop).toBe(800);
        expect(muya.getMarkdown()).toContain('#abcdef');
    });
});
