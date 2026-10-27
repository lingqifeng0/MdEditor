// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pointerElements, pointerHasBlock } from '../pointerHitTest';

let nativeDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
    nativeDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    if (nativeDescriptor)
        Object.defineProperty(document, 'elementsFromPoint', nativeDescriptor);
    else
        Reflect.deleteProperty(document, 'elementsFromPoint');
});

function mouseOn(element: Element) {
    const event = new MouseEvent('mousemove', { clientX: 120, clientY: 60 });
    element.dispatchEvent(event);
    return event;
}

describe('hover pointer hit testing', () => {
    it('uses the real event target and ancestors without an expensive document hit test', () => {
        document.body.innerHTML = '<figure><div><img src="image.png"></div></figure>';
        const image = document.querySelector('img')!;
        const native = vi.spyOn(document, 'elementsFromPoint');
        const elements = pointerElements(mouseOn(image));
        expect(elements.slice(0, 3)).toEqual([image, image.parentElement, image.parentElement!.parentElement]);
        expect(native).not.toHaveBeenCalled();
    });

    it('recognizes a table cell in the primary path so edge probes can be skipped', () => {
        document.body.innerHTML = '<table><tr><td>cell</td></tr></table>';
        const cell = document.querySelector('td')!;
        Object.defineProperty(cell, '__MUYA_BLOCK__', { value: { blockName: 'table.cell' } });
        const elements = pointerElements(mouseOn(cell));

        expect(pointerHasBlock(elements, 'table.cell')).toBe(true);
        expect(pointerHasBlock(elements, 'paragraph')).toBe(false);
    });

    it('does not show a background block through a foreground overlay', () => {
        document.body.innerHTML = '<figure id="background"></figure><section id="modal"><button>undo</button></section>';
        const button = document.querySelector('button')!;
        const elements = pointerElements(mouseOn(button));
        expect(elements).toContain(document.querySelector('#modal'));
        expect(elements).not.toContain(document.querySelector('#background'));
    });

    it('keeps actual offset hit tests for table edges and paragraph margins', () => {
        document.body.innerHTML = '<p>paragraph</p><table><tr><td>cell</td></tr></table>';
        const cell = document.querySelector('td')!;
        const native = vi.spyOn(document, 'elementsFromPoint').mockReturnValue([cell]);
        expect(pointerElements(mouseOn(document.querySelector('p')!), 0, 27)).toEqual([cell]);
        expect(native).toHaveBeenCalledWith(120, 87);
    });

    it('rechecks coordinates if a deferred hover target was removed', () => {
        document.body.innerHTML = '<p>old</p><p>new</p>';
        const target = document.querySelector('p')!;
        const event = mouseOn(target);
        target.remove();
        const replacement = document.querySelector('p')!;
        const native = vi.spyOn(document, 'elementsFromPoint').mockReturnValue([replacement]);
        expect(pointerElements(event)).toEqual([replacement]);
        expect(native).toHaveBeenCalledWith(120, 60);
    });
});
