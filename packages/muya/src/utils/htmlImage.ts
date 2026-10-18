import type HTMLBlock from '../block/commonMark/html';
import type { Muya } from '../muya';
import type { IImageActionState } from '../types';
import type { IImageInfo } from './image';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../config';
import { findScrollContainer, getBlock } from './dom';
import { getImageSrc } from './image';
import { getUniqueId, sanitize } from './index';

interface ISourceImage {
    start: number;
    end: number;
    raw: string;
}

interface ISourceAttribute {
    name: string;
    start: number;
    end: number;
    valueStart: number;
    valueEnd: number;
    quote: string;
    hasValue: boolean;
}

export interface IHtmlImageTarget {
    image: HTMLImageElement;
    imageInfo: IImageInfo;
    replace: (state: IImageActionState) => boolean;
    remove: () => boolean;
    isValid: () => boolean;
}

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

function tagEnd(html: string, start: number): number {
    let quote = '';
    for (let i = start; i < html.length; i++) {
        const char = html[i];
        if (quote) {
            if (char === quote)
                quote = '';
        }
        else if (char === '"' || char === '\'') {
            quote = char;
        }
        else if (char === '>') {
            return i + 1;
        }
    }
    return -1;
}

/** Source offsets exclude comments and raw-text contents, without serializing the surrounding HTML. */
export function sourceImages(html: string): ISourceImage[] {
    const images: ISourceImage[] = [];
    let offset = 0;
    while (offset < html.length) {
        const start = html.indexOf('<', offset);
        if (start < 0)
            break;
        if (html.startsWith('<!--', start)) {
            const end = html.indexOf('-->', start + 4);
            if (end < 0)
                break;
            offset = end + 3;
            continue;
        }
        const name = html.slice(start).match(/^<([a-z][\w:-]*)\b/i)?.[1].toLowerCase();
        const end = tagEnd(html, start + 1);
        if (end < 0)
            return [];
        offset = end;
        if (name === 'img')
            images.push({ start, end, raw: html.slice(start, end) });
        if (name && RAW_TEXT_TAGS.has(name)) {
            const close = new RegExp(`</${name}\\s*>`, 'gi');
            close.lastIndex = end;
            const match = close.exec(html);
            offset = match ? close.lastIndex : html.length;
        }
    }
    return images;
}

function skipSpace(tag: string, offset: number): number {
    while (offset < tag.length && /\s/.test(tag[offset]))
        offset++;
    return offset;
}

function attributeValue(tag: string, offset: number) {
    offset = skipSpace(tag, offset);
    const quote = /["']/.test(tag[offset] ?? '') ? tag[offset++] : '';
    const start = offset;
    if (quote) {
        const end = tag.indexOf(quote, offset);
        return end < 0 ? null : { start, end, next: end + 1, quote };
    }
    const value = tag.slice(offset).match(/^[^\s"'=<>`]+/)?.[0];
    if (!value)
        return null;
    return { start, end: offset + value.length, next: offset + value.length, quote };
}

function sourceAttributes(tag: string): ISourceAttribute[] | null {
    const attributes: ISourceAttribute[] = [];
    let offset = tag.match(/^<img\b/i)?.[0].length ?? 0;
    if (!offset)
        return null;
    while (offset < tag.length) {
        offset = skipSpace(tag, offset);
        if (/^\/?\s*>$/.test(tag.slice(offset)))
            return attributes;
        const start = offset;
        const name = tag.slice(offset).match(/^[^\s"'<>/=]+/)?.[0];
        if (!name)
            return null;
        offset += name.length;
        const nameEnd = offset;
        offset = skipSpace(tag, offset);
        const hasValue = tag[offset] === '=';
        let quote = '';
        let valueStart = nameEnd;
        let valueEnd = nameEnd;
        if (hasValue) {
            const value = attributeValue(tag, offset + 1);
            if (!value)
                return null;
            quote = value.quote;
            valueStart = value.start;
            valueEnd = value.end;
            offset = value.next;
        }
        else {
            offset = nameEnd;
        }
        attributes.push({ name: name.toLowerCase(), start, end: offset, valueStart, valueEnd, quote, hasValue });
    }
    return null;
}

function escapeAttribute(value: string, quote: string): string {
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return quote === '\'' ? escaped.replace(/'/g, '&#39;') : escaped.replace(/"/g, '&quot;');
}

/** Changes only src/alt/title values; every other source byte, including attribute case and spacing, survives. */
export function replaceSourceImage(tag: string, state: IImageActionState): string | null {
    const attributes = sourceAttributes(tag);
    if (!attributes)
        return null;
    const parsed = new DOMParser().parseFromString(tag, 'text/html').querySelector('img');
    if (!parsed)
        return null;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let added = '';
    for (const name of ['src', 'alt', 'title'] as const) {
        if ((parsed.getAttribute(name) ?? '') === state[name])
            continue;
        const matches = attributes.filter(attribute => attribute.name === name);
        if (matches.length > 1)
            return null;
        const attribute = matches[0];
        if (!attribute) {
            added += ` ${name}="${escapeAttribute(state[name], '"')}"`;
        }
        else if (attribute.hasValue) {
            const escaped = escapeAttribute(state[name], attribute.quote);
            edits.push({ start: attribute.valueStart, end: attribute.valueEnd, text: attribute.quote ? escaped : `"${escaped}"` });
        }
        else {
            const text = `${tag.slice(attribute.start, attribute.start + name.length)}="${escapeAttribute(state[name], '"')}"`;
            edits.push({ start: attribute.start, end: attribute.end, text });
        }
    }
    const close = tag.match(/\/?\s*>$/);
    if (added && close)
        edits.push({ start: close.index!, end: close.index!, text: added });
    for (const edit of edits.sort((a, b) => b.start - a.start))
        tag = tag.slice(0, edit.start) + edit.text + tag.slice(edit.end);
    return tag;
}

function isHtmlBlock(block: ReturnType<typeof getBlock>): block is HTMLBlock {
    return block?.blockName === 'html-block';
}

function previewSource(src: string): string {
    if (!/^file:/i.test(src))
        return src;
    try {
        const url = new URL(src);
        url.searchParams.delete('mucache');
        return url.href;
    }
    catch {
        return src;
    }
}

function sourceImageForPreview(muya: Muya, html: string, preview: HTMLElement, image: HTMLImageElement): ISourceImage | null {
    const images = sourceImages(html);
    // Temporary markers pass through the same render transform and sanitizer,
    // so removed/reordered images still map to their original source tags.
    let marker = `data-${getUniqueId().toLowerCase()}-image-source`;
    while (html.toLowerCase().includes(marker))
        marker += '-x';
    let marked = html;
    for (let i = images.length - 1; i >= 0; i--) {
        const entry = images[i];
        marked = `${marked.slice(0, entry.start + 4)} ${marker}="${i}"${marked.slice(entry.start + 4)}`;
    }
    const { transformHtmlPreview, disableHtml } = muya.options;
    if (disableHtml)
        return null;
    const transformed = transformHtmlPreview ? transformHtmlPreview(marked) : marked;
    const sanitized = sanitize(transformed, { ...PREVIEW_DOMPURIFY_CONFIG, ADD_ATTR: [marker] }, false) as string;
    const parsed = new DOMParser().parseFromString(sanitized, 'text/html');
    const mapped = Array.from(parsed.body.querySelectorAll('img'));
    const live = Array.from(preview.querySelectorAll('img'));
    const index = live.indexOf(image);
    if (index < 0 || mapped.length !== live.length || mapped.some((img, i) => previewSource(getImageSrc(img.getAttribute('src') ?? '').src) !== previewSource(live[i].getAttribute('src') ?? '')
        || ['alt', 'title'].some(name => img.getAttribute(name) !== live[i].getAttribute(name)))) {
        return null;
    }
    const id = mapped[index].getAttribute(marker);
    if (id === null || !/^\d+$/.test(id))
        return null;
    // A host transform may duplicate an image; a source edit would then affect
    // several visible images rather than only the one the user chose.
    if (mapped.filter(img => img.getAttribute(marker) === id).length !== 1)
        return null;
    return images[Number(id)] ?? null;
}

/** Returns a source-guarded editor target only for an image belonging to this live HTML preview. */
export function createHtmlImageTarget(muya: Muya, image: HTMLImageElement): IHtmlImageTarget | null {
    const preview = image.closest<HTMLElement>(`.${CLASS_NAMES.MU_HTML_PREVIEW}`);
    const block = getBlock(preview?.parentElement);
    if (!preview || !muya.domNode.contains(preview) || !isHtmlBlock(block))
        return null;
    const content = block.firstContentInDescendant();
    if (!content)
        return null;
    const original = content.text;
    const source = sourceImageForPreview(muya, original, preview, image);
    if (!source)
        return null;
    const sourceImage = new DOMParser().parseFromString(source.raw, 'text/html').querySelector('img');
    if (!sourceImage)
        return null;
    const attrs = {
        src: sourceImage.getAttribute('src') ?? '',
        alt: sourceImage.getAttribute('alt') ?? '',
        title: sourceImage.getAttribute('title') ?? '',
    };
    const imageInfo: IImageInfo = {
        imageId: image.id || getUniqueId(),
        token: { type: 'image', raw: source.raw, range: { start: source.start, end: source.end }, parent: [], marker: '', srcAndTitle: '', backlash: { first: '', second: '' }, ...attrs, attrs },
    };
    const isValid = (): boolean => content.text === original && !!block.domNode?.isConnected
        && muya.editor.scrollPage?.queryBlock(block.path) === block && block.firstContentInDescendant() === content;
    const apply = (replacement: string | null): boolean => {
        if (replacement === null || !isValid()) {
            return false;
        }
        const node = block.domNode;
        if (!node)
            return false;
        let start = source.start;
        let end = source.end;
        if (replacement === '') {
            const lineStart = original.lastIndexOf('\n', start - 1) + 1;
            const lineEnd = original.indexOf('\n', end);
            const tail = original.slice(end, lineEnd < 0 ? original.length : lineEnd);
            if (!original.slice(lineStart, start).trim() && !tail.trim()) {
                start = lineStart;
                end = lineEnd < 0 ? original.length : lineEnd + 1;
            }
        }
        const next = original.slice(0, start) + replacement + original.slice(end);
        if (next === original)
            return true;
        const container = findScrollContainer(muya.domNode);
        const top = node.getBoundingClientRect().top;
        const left = container.scrollLeft;
        const { jsonState, history } = muya.editor;
        jsonState.flush();
        history.cutoff();
        content.text = next;
        content.update();
        jsonState.flush();
        history.cutoff();
        container.scrollTop += node.getBoundingClientRect().top - top;
        container.scrollLeft = left;
        return true;
    };
    return { image, imageInfo, isValid, replace: state => apply(replaceSourceImage(source.raw, state)), remove: () => apply('') };
}
