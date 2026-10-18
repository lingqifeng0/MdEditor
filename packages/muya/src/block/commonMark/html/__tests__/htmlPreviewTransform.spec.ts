// @vitest-environment jsdom

import type { Muya } from '../../../../muya';
import { describe, expect, it, vi } from 'vitest';
import { Muya as MuyaConstructor } from '../../../../muya';

function boot(html: string, transformHtmlPreview?: (html: string) => string, disableHtml = false): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaConstructor(host, {
        json: [{ name: 'html-block', text: html }],
        transformHtmlPreview,
        disableHtml,
    });
    muya.init();
    return muya;
}

describe('html preview host transformation', () => {
    it('changes rendered markup while retaining the original state and Markdown', () => {
        const source = '<div style="width:1372px"><img src="a.png"></div>';
        const transform = vi.fn((html: string) => html.replace('width:1372px', 'width:100%; aspect-ratio:1372/440'));
        const muya = boot(source, transform);
        try {
            const root = muya.domNode.querySelector<HTMLElement>('.mu-html-preview > div')!;
            expect(root.style.width).toBe('100%');
            expect(root.style.aspectRatio).toBe('1372/440');
            expect(transform).toHaveBeenCalledWith(source);
            expect(muya.getState()).toEqual([{ name: 'html-block', text: source }]);
            expect(muya.getMarkdown().trim()).toBe(source);
        }
        finally {
            muya.destroy();
            muya.domNode.remove();
        }
    });

    it('sanitizes host output before mounting it', () => {
        const muya = boot('<div>original</div>', () => '<div onclick="alert(1)">rendered<script>alert(2)</script><img src="javascript:alert(3)"></div>');
        try {
            const preview = muya.domNode.querySelector('.mu-html-preview')!;
            expect(preview.textContent).toContain('rendered');
            expect(preview.querySelector('script')).toBeNull();
            expect(preview.querySelector('[onclick]')).toBeNull();
            expect(preview.innerHTML).not.toContain('javascript:');
            expect(muya.getState()).toEqual([{ name: 'html-block', text: '<div>original</div>' }]);
        }
        finally {
            muya.destroy();
            muya.domNode.remove();
        }
    });

    it('does not invoke the host when HTML rendering is disabled', () => {
        const transform = vi.fn(() => '<div>transformed</div>');
        const muya = boot('<div>original</div>', transform, true);
        try {
            expect(transform).not.toHaveBeenCalled();
            expect(muya.getState()).toEqual([{ name: 'html-block', text: '<div>original</div>' }]);
        }
        finally {
            muya.destroy();
            muya.domNode.remove();
        }
    });
});
