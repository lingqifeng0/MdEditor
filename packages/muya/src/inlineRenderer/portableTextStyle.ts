import type { HTMLTagToken } from './types';

export type TTextColorProperty = 'color' | 'background-color';
export type TParagraphAlignment = 'left' | 'center' | 'right' | 'justify';
export type TColors = Partial<Record<TTextColorProperty, string>>;

interface IPortableTextStyle {
    colors: TColors;
    alignment?: TParagraphAlignment;
}

export function normalizeTextColor(value: string): string | null {
    if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
        return null;
    const hex = value.slice(1).toLowerCase();
    return `#${hex.length <= 4 ? [...hex].map(char => char.repeat(2)).join('') : hex}`;
}

function readCssColor(value: string): string | null {
    const hex = normalizeTextColor(value);
    if (hex)
        return hex;
    if (!/^(?:[a-z]+|(?:rgba?|hsla?)\([\d\s.,%+\-/]*\))$/i.test(value))
        return null;
    const probe = document.createElement('span');
    probe.style.color = value;
    const parsed = probe.style.color;
    if (!parsed)
        return null;
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(parsed);
    const channels = rgb?.slice(1).map(Number);
    return channels?.every(channel => channel <= 255)
        ? `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
        : parsed;
}

/** Only consumes toolbar style carriers; semantic marks and unrelated HTML remain untouched. */
export function readPortableTextStyle(token: Pick<HTMLTagToken, 'tag' | 'attrs' | 'openTag' | 'closeTag'>): IPortableTextStyle | null {
    if (!token.closeTag)
        return null;
    const tag = token.tag.toLowerCase();
    if (!['span', 'mark', 'font'].includes(tag))
        return null;
    const element = new DOMParser().parseFromString(token.openTag, 'text/html').body.firstElementChild;
    const attributes = element?.getAttributeNames() ?? Object.keys(token.attrs);
    if (tag === 'font' && attributes.length === 1 && attributes[0] === 'color') {
        const color = readCssColor(token.attrs.color ?? '');
        return color ? { colors: { color } } : null;
    }
    if ((tag !== 'span' && tag !== 'mark') || attributes.some(key => key !== 'style'))
        return null;
    const result: IPortableTextStyle = { colors: {} };
    let block = false;
    for (const declaration of (token.attrs.style ?? '').split(';').filter(part => part.trim())) {
        const separator = declaration.indexOf(':');
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = declaration.slice(separator + 1).trim();
        if (separator < 0)
            return null;
        if (property === 'color' || property === 'background-color' || (tag === 'mark' && property === 'background')) {
            const color = readCssColor(value);
            if (!color)
                return null;
            result.colors[property === 'background' ? 'background-color' : property] = color;
        }
        else if (tag === 'span' && property === 'display' && value === 'block') {
            block = true;
        }
        else if (tag === 'span' && property === 'text-align' && /^(?:left|center|right|justify)$/.test(value)) {
            result.alignment = value as TParagraphAlignment;
        }
        else {
            return null;
        }
    }
    if (block !== !!result.alignment)
        return null;
    return Object.keys(result.colors).length || result.alignment ? result : null;
}

export function openColorSpan(colors: TColors): string {
    const style = (['color', 'background-color'] as const)
        .filter(property => colors[property])
        .map(property => `${property}:${colors[property]}`)
        .join(';');
    return style ? `<span style="${style}">` : '';
}

export function openAlignmentSpan(alignment?: TParagraphAlignment | null): string {
    return alignment ? `<span style="display:block;text-align:${alignment}">` : '';
}
