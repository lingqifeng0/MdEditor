// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTextColor } from '../../../inlineRenderer/portableTextStyle';
import { Muya } from '../../../muya';
import * as selectionCoords from '../../../selection';
import { withOpacity } from '../colorPalette';
import { InlineFormatToolbar } from '../index';

const editors: Array<{ muya: Muya; toolbar: InlineFormatToolbar }> = [];
beforeEach(() => {
    window.MUYA_VERSION = 'test';
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
    for (const { muya, toolbar } of editors.splice(0)) {
        toolbar.destroy();
        muya.destroy();
    }
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function boot(markdown = 'target word', scrollable = false) {
    const host = document.createElement('div');
    if (scrollable)
        host.style.overflowY = 'auto';
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, superSubScript: false });
    muya.init();
    const toolbar = new InlineFormatToolbar(muya);
    editors.push({ muya, toolbar });
    const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
    leaf.setCursor(0, leaf.text.length, true);
    toolbar.status = true;
    muya.eventCenter.emit('selection-change', { formats: [], isCollapsed: false, isSelectionInSameBlock: true });
    return { muya, toolbar, leaf };
}

function click(toolbar: InlineFormatToolbar, selector: string): void {
    const button = toolbar.container!.querySelector<HTMLElement>(selector)!;
    expect(button, selector).not.toBeNull();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('extended editing toolbar', () => {
    it('keeps a visible selected range through automatic scrolling but hides after it leaves the viewport', () => {
        const { muya, toolbar } = boot('target word', true);
        const scroller = muya.domNode;
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
        const reference = vi.spyOn(selectionCoords, 'getCursorReference');
        reference.mockReturnValue({ getBoundingClientRect: () => new DOMRect(100, 320, 120, 20), clientWidth: 120, clientHeight: 20 });
        scroller.scrollTop = 100;
        scroller.dispatchEvent(new Event('scroll'));
        scroller.scrollTop = 250;
        scroller.dispatchEvent(new Event('scroll'));
        expect(toolbar.status).toBe(true);
        expect(muya.getSelectedText()).toBe('target word');
        reference.mockReturnValue({ getBoundingClientRect: () => new DOMRect(100, -120, 120, 20), clientWidth: 120, clientHeight: 20 });
        scroller.scrollTop = 700;
        scroller.dispatchEvent(new Event('scroll'));
        expect(toolbar.status).toBe(false);
    });

    it('keeps a custom color picker through automatic scrolling and still dismisses it on an outside click', () => {
        const { muya, toolbar, leaf } = boot('target word', true);
        const scroller = muya.domNode;
        click(toolbar, '.text-color .mu-color-dropdown');
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
        vi.spyOn(leaf.domNode!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 320, 120, 20));
        toolbar.container!.querySelector('[data-slot="0"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        toolbar.container!.querySelector<HTMLInputElement>('.mu-color-hex')!.focus();
        document.getSelection()?.removeAllRanges();
        scroller.scrollTop = 100;
        scroller.dispatchEvent(new Event('scroll'));
        scroller.scrollTop = 250;
        scroller.dispatchEvent(new Event('scroll'));
        expect(toolbar.status).toBe(true);
        expect(toolbar.container!.querySelector('.save-custom')).not.toBeNull();
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(toolbar.status).toBe(false);
        expect(toolbar.floatBox!.style.opacity).toBe('0');
    });

    it('shows a fresh selection after a temporary missing cursor rectangle without treating it as user dismissal', async () => {
        const { muya, toolbar } = boot();
        const reference = vi.spyOn(selectionCoords, 'getCursorReference').mockReturnValue(null);
        muya.setContent('<span style="display:block;text-align:center"><span style="display:block;text-align:right">target word</span></span>');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        leaf.setCursor(0, leaf.text.length, true);
        muya.eventCenter.emit('muya-format-picker', { reference: null, block: leaf });
        expect(toolbar.status).toBe(false);
        reference.mockReturnValue({ getBoundingClientRect: () => new DOMRect(20, 100, 120, 20), clientWidth: 120, clientHeight: 20 });
        document.dispatchEvent(new Event('selectionchange'));
        await vi.waitFor(() => expect(toolbar.status).toBe(true));
        expect(toolbar.container!.querySelector('.heading-n button')).not.toBeNull();
        expect(muya.getSelection()?.isCollapsed).toBe(false);
    });

    it.each([[3, false], [1, true]])('preserves an already handled selection on mousedown detail=%s prevented=%s', (detail, prevented) => {
        const { muya } = boot('first paragraph\n\ntarget word');
        const target = muya.editor.scrollPage!.lastContentInDescendant()!;
        target.setCursor(0, target.text.length, true);
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail });
        if (prevented)
            event.preventDefault();
        target.domNode!.dispatchEvent(event);
        expect(document.getSelection()?.toString()).toBe('target word');
        expect(muya.getSelection()?.anchor.block).toBe(target);
        expect(muya.getSelection()?.focus.block).toBe(target);
        target.domNode!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        expect(muya.getMarkdown().trim()).toBe('first paragraph\n\ntarget word');
    });

    it.each(['strong', 'em', 'u', 'del', 'mark', 'sup', 'sub', 'inline_code', 'inline_math'])(
        'applies %s to the same text and can undo it',
        (format: string) => {
            const { muya, toolbar, leaf } = boot();
            click(toolbar, `.item.${format}`);
            expect(leaf.text).not.toBe('target word');
            muya.undo();
            expect(leaf.text).toBe('target word');
            expect(muya.getSelection()?.anchor.offset).toBe(0);
            expect(muya.getSelection()?.focus.offset).toBe(11);
        },
    );

    it.each([1, 2, 3])('makes the selected paragraph H%s', (level: number) => {
        const { muya, toolbar } = boot();
        click(toolbar, '.heading-n button');
        click(toolbar, `.mu-heading-menu button[aria-label="标题 H${level}"]`);
        expect(muya.getMarkdown().trim()).toBe(`${'#'.repeat(level)} target word`);
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('target word');
    });

    it('offers H4–H6 and paragraph in Hn without editing on menu open', () => {
        const { muya, toolbar } = boot();
        click(toolbar, '.heading-n button');
        expect(muya.getMarkdown().trim()).toBe('target word');
        click(toolbar, '.mu-heading-menu button[aria-label="标题 H6"]');
        expect(muya.getMarkdown().trim()).toBe('###### target word');
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('target word');
    });

    it.each([['codeblock', 'code-block'], ['mathblock', 'math-block']])('converts the selection into %s and undoes it', (type: string, blockName: string) => {
        const { muya, toolbar } = boot();
        click(toolbar, `.${type} button`);
        expect(muya.getState()).toHaveLength(1);
        expect(muya.getState()[0]).toMatchObject({ name: blockName, text: 'target word' });
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('target word');
    });

    it('inserts a table below selected text without discarding it', () => {
        const { muya, toolbar } = boot();
        click(toolbar, '.item.table button');
        expect(muya.getMarkdown().trim()).toBe('target word');
        click(toolbar, '.mu-table-menu button');
        expect(muya.getMarkdown()).toContain('target word');
        expect(muya.getMarkdown()).toContain('|');
        expect(muya.domNode.querySelectorAll('.mu-table-row')).toHaveLength(4);
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('target word');
    });

    it('clears inline formatting and colors in one undoable action', () => {
        const { muya, toolbar } = boot('**<span style="color:#ff0000;background-color:#ffff0080"><u>target</u></span>**');
        click(toolbar, '.item.clear');
        expect(muya.getMarkdown().trim()).toBe('target');
        muya.undo();
        expect(muya.getMarkdown()).toContain('background-color:#ffff0080');
        expect(muya.getMarkdown()).toContain('<u>target</u>');
    });

    it('opens distinct font and background palettes without changing the document', () => {
        const { muya, toolbar } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        expect(toolbar.container!.querySelectorAll('.mu-color-swatch')).toHaveLength(75);
        expect(toolbar.container!.querySelector('[aria-label="字体颜色"]')).not.toBeNull();
        click(toolbar, '.background-color .mu-color-dropdown');
        expect(toolbar.container!.querySelectorAll('.mu-color-swatch')).toHaveLength(25);
        expect(toolbar.container!.querySelector('.mu-color-palette.background')).not.toBeNull();
        expect(muya.getMarkdown().trim()).toBe('target word');
    });

    it('saves a custom alpha color, applies it only on confirmation, and keeps it across new toolbars', () => {
        const { muya, toolbar, leaf } = boot();
        click(toolbar, '.background-color .mu-color-dropdown');
        toolbar.container!.querySelector('[data-slot="0"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const color = toolbar.container!.querySelector<HTMLInputElement>('.mu-color-hex')!;
        color.value = '#12345680';
        color.dispatchEvent(new Event('input', { bubbles: true }));
        expect(leaf.text).toBe('target word');
        click(toolbar, '.save-custom');
        expect(leaf.text).toBe('target word');
        click(toolbar, '[data-slot="0"]');
        expect(leaf.text).toContain('background-color:#12345680');
        muya.undo();
        expect(leaf.text).toBe('target word');
        const second = boot();
        click(second.toolbar, '.background-color .mu-color-dropdown');
        expect(second.toolbar.container!.querySelector('[data-color="#12345680"]')).not.toBeNull();
    });

    it('updates the opacity draft and preview without editing the selected text', () => {
        const { muya, toolbar, leaf } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        toolbar.container!.querySelector('[data-slot="0"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const slider = toolbar.container!.querySelector<HTMLInputElement>('.mu-opacity-control input')!;
        slider.value = '30';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        expect(leaf.text).toBe('target word');
        expect(toolbar.container!.querySelector<HTMLInputElement>('.mu-color-hex')!.value).toBe('#e0190f4d');
        expect(toolbar.container!.querySelector('.mu-opacity-control')!.textContent).toContain('30%');
        click(toolbar, '.save-custom');
        expect(leaf.text).toBe('target word');
        click(toolbar, '[data-slot="0"]');
        expect(leaf.text).toContain('color:#e0190f4d');
        muya.undo();
        expect(leaf.text).toBe('target word');
    });

    it('has exactly one row, one Hn and separate superscript and subscript icons', () => {
        const { toolbar } = boot();
        expect(toolbar.container!.querySelectorAll('ul.mu-inline-tools')).toHaveLength(1);
        expect(toolbar.container!.querySelector('.mu-paragraph-tools')).toBeNull();
        expect(toolbar.container!.querySelectorAll('.heading-n')).toHaveLength(1);
        expect(toolbar.container!.querySelector('[class*="heading-1"]')).toBeNull();
        expect(toolbar.container!.querySelector('.sup svg')).not.toBeNull();
        expect(toolbar.container!.querySelector('.sub svg')).not.toBeNull();
    });

    it.each(['sup', 'sub'])('renders actual %s formatting with desktop extension defaults disabled', async (type: string) => {
        const { muya, toolbar } = boot();
        click(toolbar, `.item.${type}`);
        expect(muya.getState()[0]).toMatchObject({ text: `<${type}>target word</${type}>` });
        await vi.waitFor(() => expect(muya.domNode.querySelector(`${type}.mu-raw-html`)?.textContent, muya.domNode.innerHTML).toBe('target word'));
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('target word');
        muya.redo();
        await vi.waitFor(() => expect(muya.domNode.querySelector(`${type}.mu-raw-html`)?.textContent).toBe('target word'));
    });

    it('applies the current font and background color directly without opening a palette', () => {
        const { muya, toolbar } = boot();
        click(toolbar, '.text-color .mu-color-button');
        expect(muya.getMarkdown()).toContain('color:#e0190f');
        expect(toolbar.container!.querySelector('.mu-color-palette')).toBeNull();
        toolbar.status = true;
        muya.eventCenter.emit('selection-change', { formats: [], isCollapsed: false, isSelectionInSameBlock: true });
        click(toolbar, '.background-color .mu-color-button');
        expect(muya.getMarkdown()).toContain('background-color:#fff3a3');
        muya.undo();
        expect(muya.getMarkdown()).not.toContain('background-color');
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('target word');
    });

    it('never opens palettes on hover and omits the clear and more-colors buttons', () => {
        const { toolbar } = boot();
        for (const button of toolbar.container!.querySelectorAll('.mu-color-tool button')) {
            button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
        expect(toolbar.container!.querySelector('.mu-color-palette')).toBeNull();
        click(toolbar, '.text-color .mu-color-dropdown');
        expect(toolbar.container!.querySelector('.clear-color, .more-colors')).toBeNull();
    });

    it('keeps a custom picker and the frozen selection through focus and selection loss', () => {
        const { muya, toolbar, leaf } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        toolbar.container!.querySelector('[data-slot="2"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const input = toolbar.container!.querySelector<HTMLInputElement>('.mu-color-hex')!;
        input.focus();
        document.getSelection()?.removeAllRanges();
        muya.eventCenter.emit('muya-format-picker', { reference: null });
        input.value = '#abcdef80';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        click(toolbar, '.save-custom');
        expect(leaf.text).toBe('target word');
        click(toolbar, '[data-slot="2"]');
        expect(leaf.text).toBe('<span style="color:#abcdef80">target word</span>');
    });

    it('ignores a stale custom-save click after closing or changing palettes', () => {
        const { muya, toolbar } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        toolbar.container!.querySelector('[data-slot="0"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const stale = toolbar.container!.querySelector<HTMLElement>('.save-custom')!;
        click(toolbar, '.background-color .mu-color-dropdown');
        expect(() => stale.click()).not.toThrow();
        expect(muya.getMarkdown().trim()).toBe('target word');
        toolbar.hide();
        expect(() => stale.click()).not.toThrow();
    });

    it('discards a popup target from a replaced document and operates on a newly selected range', () => {
        const { muya, toolbar } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        muya.setContent('**new target**');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        toolbar.status = true;
        leaf.setCursor(0, leaf.text.length, true);
        muya.eventCenter.emit('selection-change', { formats: [], isCollapsed: false, isSelectionInSameBlock: true });
        expect(toolbar.container!.querySelector('.mu-color-palette')).toBeNull();
        click(toolbar, '.item.clear');
        expect(muya.getMarkdown().trim()).toBe('new target');
    });

    it('remembers the applied color and uses it after reopening a toolbar', () => {
        const { toolbar } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        click(toolbar, '[data-color="#ffff00"]');
        const second = boot();
        expect(second.toolbar.container!.querySelector('.text-color')!.getAttribute('data-current-color')).toBe('#ffff00');
        click(second.toolbar, '.text-color .mu-color-button');
        expect(second.muya.getMarkdown()).toContain('color:#ffff00');
    });

    it.each([null, [], {}, { color: [] }, { 'color': null, 'background-color': 'invalid' }, { color: [null, 1, 'bad', '#abc'] }])('repairs invalid legacy custom colors %j before editing a slot', (saved) => {
        localStorage.setItem('marktext.toolbar.custom-colors.v1', JSON.stringify(saved));
        const { muya, toolbar } = boot();
        click(toolbar, '.text-color .mu-color-dropdown');
        expect(toolbar.container!.querySelectorAll('[data-slot]')).toHaveLength(5);
        toolbar.container!.querySelector('[data-slot="4"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const input = toolbar.container!.querySelector<HTMLInputElement>('.mu-color-hex')!;
        input.value = '#12345600';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(() => click(toolbar, '.save-custom')).not.toThrow();
        const colors = JSON.parse(localStorage.getItem('marktext.toolbar.custom-colors.v1')!);
        expect(colors.color[4]).toBe('#12345600');
        expect(colors.color[0]).toBe('#e0190f');
        expect(muya.getMarkdown().trim()).toBe('target word');
        click(toolbar, '[data-slot="4"]');
        expect(muya.getMarkdown()).toContain('color:#12345600');
    });
});

describe('alpha color values', () => {
    it.each([['#abc', '#aabbcc'], ['#abcd', '#aabbccdd'], ['#12345680', '#12345680']])('normalizes %s', (value: string, expected: string) => {
        expect(normalizeTextColor(value)).toBe(expected);
    });
    it('handles opaque, half-transparent and fully transparent colors', () => {
        expect(withOpacity('#123456', 100)).toBe('#123456');
        expect(withOpacity('#123456', 50)).toBe('#12345680');
        expect(withOpacity('#123456', 0)).toBe('#12345600');
        expect(normalizeTextColor('#12345680;display:none')).toBeNull();
    });
});
