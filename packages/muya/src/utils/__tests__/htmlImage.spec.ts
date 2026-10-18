// @vitest-environment jsdom

import type { IImageActionState } from '../../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';
import { createHtmlImageTarget, replaceSourceImage, sourceImages } from '../htmlImage';

const opened: Muya[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.getSelection()?.removeAllRanges();
});

function boot(html: string, transformHtmlPreview?: (html: string) => string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { json: [{ name: 'html-block', text: html }, { name: 'paragraph', text: 'after' }], transformHtmlPreview });
    muya.init();
    opened.push(muya);
    muya.flush();
    const block = muya.editor.scrollPage!.children.head!;
    const content = muya.editor.scrollPage!.firstContentInDescendant()!;
    const preview = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW}`)!;
    return { muya, block, content, preview };
}

const unchanged: IImageActionState = { src: 'assets/a.png', alt: 'note', title: '' };

describe('html image source patches', () => {
    it('ignores image-shaped text in comments, quoted attributes and raw-text elements', () => {
        const html = '<!-- <img src="comment.png"> --><script>"<img src=script.png>"</script><textarea><img src=text.png></textarea><div title="<img src=fake.png>"><IMG src="real>image.png" alt=note /></div>';
        const images = sourceImages(html);
        expect(images).toHaveLength(1);
        expect(images[0].raw).toBe('<IMG src="real>image.png" alt=note />');
        expect(html.slice(images[0].start, images[0].end)).toBe(images[0].raw);
    });

    it('preserves every unedited byte including quote style, case, spacing and entities', () => {
        const raw = '<IMG  SRC = \'assets/a.png\' ALT=note data-x="a>b" style=\'width:90px\' title="">';
        expect(replaceSourceImage(raw, unchanged)).toBe(raw);
        expect(replaceSourceImage(raw, { src: '图&片.png', alt: 'new " & <note>', title: 'user\'s title' }))
            .toBe('<IMG  SRC = \'图&amp;片.png\' ALT="new &quot; &amp; &lt;note&gt;" data-x="a>b" style=\'width:90px\' title="user\'s title">');
        expect(replaceSourceImage('<img src = assets/a.png ALT \t= note>', { ...unchanged, alt: 'new note' }))
            .toBe('<img src = assets/a.png ALT \t= "new note">');
    });

    it('adds only a changed missing attribute and does not duplicate boolean or existing fields', () => {
        expect(replaceSourceImage('<img src="assets/a.png" alt title=\'\' />', { ...unchanged, alt: 'note' }))
            .toBe('<img src="assets/a.png" alt="note" title=\'\' />');
        expect(replaceSourceImage('<img src="assets/a.png"  />', { ...unchanged, alt: '' }))
            .toBe('<img src="assets/a.png"  />');
        expect(replaceSourceImage('<img src="assets/a.png" />', unchanged))
            .toBe('<img src="assets/a.png"  alt="note"/>');
    });

    it('refuses ambiguous duplicate changed attributes and malformed tags', () => {
        expect(replaceSourceImage('<img src="a.png" SRC="b.png">', { ...unchanged, src: 'c.png' })).toBeNull();
        expect(replaceSourceImage('<img src="broken>', unchanged)).toBeNull();
        expect(sourceImages('<img src="broken>')).toEqual([]);
    });
});

describe('html preview image model actions', () => {
    it('opens and confirms an unchanged image without a JSON change or undo entry', () => {
        const html = '<div  style="width:300px"><IMG SRC=\'assets/a.png\' ALT=note title=""></div>';
        const { muya, content, preview } = boot(html);
        const change = vi.fn();
        muya.on('json-change', change);
        const history = JSON.stringify(muya.getHistory());
        const target = createHtmlImageTarget(muya, preview.querySelector('img')!);
        expect(target).not.toBeNull();
        expect(target!.imageInfo.token.attrs).toEqual(unchanged);
        expect(target!.replace(unchanged)).toBe(true);
        expect(content.text).toBe(html);
        expect(change).not.toHaveBeenCalled();
        expect(JSON.stringify(muya.getHistory())).toBe(history);
        expect(muya.getMarkdown()).not.toContain('image-source');
        expect(preview.innerHTML).not.toContain('image-source');
    });

    it('edits the chosen duplicate source only, preserving other tags and undo/redo', () => {
        const first = '<img SRC=\'assets/a.png\' alt="first" style="left:0">';
        const second = '<IMG  src="assets/a.png" alt=second style=\'left:40px\' data-user="keep">';
        const html = `<div class="canvas">${first}\n<!--keep-->${second}<p>same &amp; text</p></div>`;
        const { muya, content, preview } = boot(html);
        const selected = preview.querySelectorAll('img')[1];
        const target = createHtmlImageTarget(muya, selected)!;
        expect(target.image).toBe(selected);
        expect(target.replace({ src: 'assets/b.png', alt: 'new note', title: '' })).toBe(true);
        const expected = html.replace(second, '<IMG  src="assets/b.png" alt="new note" style=\'left:40px\' data-user="keep">');
        expect(content.text).toBe(expected);
        expect(muya.getState()[0]).toEqual({ name: 'html-block', text: expected });
        expect(preview.querySelectorAll('img')[0].getAttribute('alt')).toBe('first');
        expect(preview.querySelectorAll('img')[1].getAttribute('alt')).toBe('new note');
        muya.undo();
        expect(content.text).toBe(html);
        expect(preview.querySelectorAll('img')[1].getAttribute('alt')).toBe('second');
        muya.redo();
        expect(content.text).toBe(expected);
    });

    it('deletes only the selected tag and refreshes the HTML state and preview in one undo step', () => {
        const removed = '<img src="assets/a.png" alt="remove">';
        const html = `<section>before${removed}\n<img src="assets/b.png">after</section>`;
        const { muya, content, preview } = boot(html);
        const target = createHtmlImageTarget(muya, preview.querySelector('img')!)!;
        expect(target.remove()).toBe(true);
        expect(content.text).toBe(html.replace(removed, ''));
        expect(muya.getState()[0]).toEqual({ name: 'html-block', text: html.replace(removed, '') });
        expect(preview.querySelectorAll('img')).toHaveLength(1);
        muya.undo();
        expect(content.text).toBe(html);
        expect(preview.querySelectorAll('img')).toHaveLength(2);
    });

    it('maps through sanitization and reordered render-only transforms without changing source order', () => {
        const html = '<div><script><img src="hidden.png"></script><img src="assets/a.png" alt="first"><img src="assets/b.png" alt="second"></div>';
        const transform = (source: string) => {
            const template = document.createElement('template');
            template.innerHTML = source;
            template.content.querySelector('script')?.remove();
            const parent = template.content.querySelector('div')!;
            const images = parent.querySelectorAll('img');
            parent.insertBefore(images[1], images[0]);
            return template.innerHTML;
        };
        const { muya, content, preview } = boot(html, transform);
        expect(preview.querySelector('img')!.getAttribute('alt')).toBe('second');
        const target = createHtmlImageTarget(muya, preview.querySelector('img')!)!;
        expect(target.imageInfo.token.attrs.src).toBe('assets/b.png');
        expect(target.replace({ src: 'assets/b.png', alt: 'updated', title: '' })).toBe(true);
        expect(content.text).toBe(html.replace('alt="second"', 'alt="updated"'));
    });

    it('refuses transformed duplicate/injected images, stale source and images outside this editor', () => {
        const html = '<div><img src="assets/a.png"></div>';
        const duplicated = boot(html, source => source.replace(/(<img[^>]*>)/, '$1$1'));
        expect(createHtmlImageTarget(duplicated.muya, duplicated.preview.querySelector('img')!)).toBeNull();
        const injected = boot(html, source => source.replace('</div>', '<img src="assets/injected.png"></div>'));
        expect(createHtmlImageTarget(injected.muya, injected.preview.querySelectorAll('img')[1])).toBeNull();
        const { muya, content, preview } = boot(html);
        expect(createHtmlImageTarget(muya, injected.preview.querySelector('img')!)).toBeNull();
        const target = createHtmlImageTarget(muya, preview.querySelector('img')!)!;
        content.text = html.replace('</div>', '<p>new text</p></div>');
        content.update();
        expect(target.remove()).toBe(false);
        expect(target.replace(unchanged)).toBe(false);
        expect(content.text).toContain('new text');
        const fresh = createHtmlImageTarget(muya, preview.querySelector('img')!)!;
        muya.setContent('replacement document');
        expect(fresh.remove()).toBe(false);
        expect(muya.getMarkdown()).toBe('replacement document\n');
    });

    it('maps refreshed file URLs after removing only the render cache parameter', () => {
        const src = 'file:///C:/Images/图片.png?user=a%20b&other=1#frame';
        const html = `<div><img src="${src}" alt="note"></div>`;
        const { muya, content, preview } = boot(html);
        const image = preview.querySelector('img')!;
        const reload = new URL(image.getAttribute('src')!);
        reload.searchParams.set('mucache', 'fresh-1');
        image.setAttribute('src', reload.href);
        const target = createHtmlImageTarget(muya, image)!;
        expect(target.imageInfo.token.attrs.src).toBe(src);
        expect(content.text).toBe(html);
        reload.searchParams.set('other', 'changed');
        image.setAttribute('src', reload.href);
        expect(createHtmlImageTarget(muya, image)).toBeNull();
    });

    it('does not strip cache-like query parameters from remote image URLs', () => {
        const { muya, preview } = boot('<div><img src="https://example.com/a.png?mucache=original"></div>');
        const image = preview.querySelector('img')!;
        image.setAttribute('src', 'https://example.com/a.png?mucache=changed');
        expect(createHtmlImageTarget(muya, image)).toBeNull();
    });
});
