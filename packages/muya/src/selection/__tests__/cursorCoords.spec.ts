// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCursorCoords } from '../cursorCoords';

afterEach(() => {
    vi.restoreAllMocks();
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

function selectText(): void {
    const text = document.createTextNode('你好');
    document.body.appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()!.addRange(range);
}

function rects(values: DOMRect[]): DOMRectList {
    return Object.assign(values, { item: (index: number) => values[index] ?? null }) as unknown as DOMRectList;
}

describe('visible cursor coordinates', () => {
    it.each([false, true])('ignores hidden source boxes at both ends (preferEnd: %s)', (preferEnd) => {
        selectText();
        const visible = new DOMRect(12, 80, 32, 22);
        vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects([
            new DOMRect(12, 1400, 0, 0),
            visible,
            new DOMRect(44, 1600, 0, 0),
        ]));

        expect(getCursorCoords(preferEnd)).toBe(visible);
    });

    it('keeps a zero-width visible caret', () => {
        selectText();
        document.getSelection()!.collapseToStart();
        const caret = new DOMRect(12, 80, 0, 22);
        vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects([caret]));

        expect(getCursorCoords()).toBe(caret);
    });

    it('returns no scrolling coordinate for an entirely hidden range', () => {
        selectText();
        vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects([new DOMRect(12, 1400, 0, 0)]));

        expect(getCursorCoords()).toBeNull();
    });
});
