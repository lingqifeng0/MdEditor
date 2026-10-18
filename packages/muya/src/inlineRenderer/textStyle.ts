import type { TColors, TParagraphAlignment, TTextColorProperty } from './portableTextStyle';
import type { ITokenizerOptions, Token } from './types';
import { tokenizer } from './lexer';
import { normalizeTextColor, openAlignmentSpan, openColorSpan, readPortableTextStyle } from './portableTextStyle';

export type { TParagraphAlignment, TTextColorProperty } from './portableTextStyle';
export { normalizeTextColor } from './portableTextStyle';

interface ITextStyleResult {
    text: string;
    start: number;
    end: number;
}

/** Splits a source-offset range without leaving an unclosed inline carrier. */
export function sliceInlineText(text: string, start: number, end: number, preserveFormatting: boolean, context: ITokenizerOptions = {}): string {
    const slice = (tokens: Token[]): string => tokens.map((token) => {
        const lo = Math.max(start, token.range.start);
        const hi = Math.min(end, token.range.end);
        if (hi <= lo)
            return '';
        const children = 'children' in token ? token.children : null;
        if (!children?.length)
            return text.slice(lo, hi);
        const content = slice(children);
        if (!content || !preserveFormatting)
            return content;
        return text.slice(token.range.start, children[0].range.start) + content + text.slice(children[children.length - 1].range.end, token.range.end);
    }).join('');
    return slice(tokenizer(text, context));
}

/** Applies a color to visible content in a source-offset range; null removes that property. */
export function colorTextRange(
    text: string,
    start: number,
    end: number,
    property: TTextColorProperty,
    value: string | null,
    context: ITokenizerOptions = {},
): ITextStyleResult | null {
    if (start >= end || (property !== 'color' && property !== 'background-color'))
        return null;
    const color = value === null ? null : normalizeTextColor(value);
    if (value !== null && color === null)
        return null;

    let output = '';
    let selectedStart: number | null = null;
    let selectedEnd = 0;

    const emit = (raw: string, colors: TColors, selected: boolean) => {
        if (!raw)
            return;
        const nextColors = { ...colors };
        if (selected) {
            if (color === null)
                delete nextColors[property];
            else
                nextColors[property] = color;
        }
        const opening = openColorSpan(nextColors);
        output += opening;
        if (selected && selectedStart === null)
            selectedStart = output.length;
        output += raw;
        if (selected)
            selectedEnd = output.length;
        if (opening)
            output += '</span>';
    };

    const render = (tokens: Token[], inherited: TColors) => {
        for (const token of tokens) {
            if (token.type === 'html_tag') {
                const style = readPortableTextStyle(token);
                if (style && token.children) {
                    const alignment = openAlignmentSpan(style.alignment);
                    output += alignment;
                    render(token.children, { ...inherited, ...style.colors });
                    if (alignment)
                        output += '</span>';
                    continue;
                }
            }
            if ('children' in token && token.children?.length) {
                const children = token.children;
                output += text.slice(token.range.start, children[0].range.start);
                render(children, inherited);
                const needsExplicitLabel = token.type === 'reference_link' && !token.isFullLink
                    && (Object.keys(inherited).length > 0 || (start < children[children.length - 1].range.end && end > children[0].range.start));
                output += needsExplicitLabel && token.type === 'reference_link'
                    ? `${token.backlash.first}][${token.label}]`
                    : text.slice(children[children.length - 1].range.end, token.range.end);
                continue;
            }

            const lo = Math.max(start, token.range.start);
            const hi = Math.min(end, token.range.end);
            if (token.type === 'text' && hi > lo) {
                emit(text.slice(token.range.start, lo), inherited, false);
                emit(text.slice(lo, hi), inherited, true);
                emit(text.slice(hi, token.range.end), inherited, false);
            }
            else {
                const selected = hi > lo && ['inline_code', 'html_escape', 'backlash', 'emoji', 'auto_link', 'auto_link_extension'].includes(token.type);
                emit(token.raw, inherited, selected);
            }
        }
    };

    render(tokenizer(text, context), {});
    return selectedStart === null ? null : { text: output, start: selectedStart, end: selectedEnd };
}

/** Keeps alignment in inline HTML so reopening the file retains a Markdown paragraph. */
export function alignTextParagraph(text: string, alignment: TParagraphAlignment | null): { text: string; mapOffset: (offset: number) => number } {
    let content = '';
    const offsets: number[] = [];
    const copy = (start: number, end: number) => {
        for (let index = start; index <= end; index++)
            offsets[index] = content.length + index - start;
        content += text.slice(start, end);
    };
    const render = (tokens: Token[]) => {
        for (const token of tokens) {
            const children = 'children' in token ? token.children : null;
            const style = token.type === 'html_tag' ? readPortableTextStyle(token) : null;
            if (style?.alignment && token.type === 'html_tag') {
                const colorOpening = openColorSpan(style.colors);
                content += colorOpening;
                for (let index = token.range.start; index <= token.range.start + token.openTag.length; index++)
                    offsets[index] = content.length;
                if (children?.length)
                    render(children);
                for (let index = token.range.end - (token.closeTag?.length ?? 0); index <= token.range.end; index++)
                    offsets[index] = content.length;
                if (colorOpening)
                    content += '</span>';
            }
            else if (children?.length) {
                copy(token.range.start, children[0].range.start);
                render(children);
                copy(children[children.length - 1].range.end, token.range.end);
            }
            else {
                copy(token.range.start, token.range.end);
            }
        }
    };
    // Color operations may split an aligned span into several carriers. Remove
    // every old alignment before applying one paragraph-wide alignment.
    render(tokenizer(text));
    const opening = openAlignmentSpan(alignment);
    return {
        text: opening + content + (opening ? '</span>' : ''),
        mapOffset: offset => opening.length + (offsets[Math.max(0, Math.min(offset, text.length))] ?? 0),
    };
}
