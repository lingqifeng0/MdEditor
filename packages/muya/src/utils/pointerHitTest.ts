/** The browser already hit-tested a mouse event; hover tools can reuse its ancestor path. */
export function pointerElements(event: MouseEvent, offsetX = 0, offsetY = 0): Element[] {
    const target = event.target;
    if (!offsetX && !offsetY && target instanceof Element && target.isConnected) {
        const elements: Element[] = [];
        for (let element: Element | null = target; element; element = element.parentElement)
            elements.push(element);
        return elements;
    }
    // Table-edge and paragraph-margin probes use different coordinates and
    // still need a real hit test. Do not infer them from the target's rectangle.
    const owner = target instanceof Node ? target.ownerDocument ?? document : document;
    return owner.elementsFromPoint(event.clientX + offsetX, event.clientY + offsetY);
}
