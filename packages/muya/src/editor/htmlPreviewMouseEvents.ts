import type { Muya } from '../muya';
import { CLASS_NAMES } from '../config';

const PREVIEW_SELECTOR = `.${CLASS_NAMES.MU_HTML_PREVIEW}`;
const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, summary, video, audio, [contenteditable="true"]';

export function isHtmlPreviewTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(PREVIEW_SELECTOR);
}

export function isHtmlPreviewMarginTarget(muya: Muya, event: MouseEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement))
        return false;

    const isHtmlShell = target.classList.contains(CLASS_NAMES.MU_HTML_BLOCK);
    if (target !== muya.domNode && target !== muya.editor.scrollPage?.domNode && !isHtmlShell)
        return false;

    const editorRect = muya.domNode.getBoundingClientRect();
    const clientLeft = editorRect.left + muya.domNode.clientLeft;
    const clientTop = editorRect.top + muya.domNode.clientTop;
    if (event.clientX < clientLeft || event.clientX >= clientLeft + muya.domNode.clientWidth
        || event.clientY < clientTop || event.clientY >= clientTop + muya.domNode.clientHeight) {
        return false;
    }

    const previews = (isHtmlShell ? target : muya.domNode).querySelectorAll(PREVIEW_SELECTOR);
    // Side margins have no text caret of their own. Limit the guard to rendered
    // HTML rows so ordinary text and the document's trailing insert area still work.
    return Array.from(previews).some((preview) => {
        const style = preview.ownerDocument.defaultView?.getComputedStyle(preview);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
            return false;
        const rect = preview.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
}

export function attachHtmlPreviewMouseHandlers(muya: Muya): void {
    muya.eventCenter.attachDOMEvent(muya.domNode, 'mousedown', (event) => {
        const target = event.target;
        if (!(event instanceof MouseEvent) || !(target instanceof HTMLElement))
            return;
        if (isHtmlPreviewMarginTarget(muya, event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!isHtmlPreviewTarget(target) || target.textContent?.trim()) {
            return;
        }
        const preview = target.closest(PREVIEW_SELECTOR)!;
        const interactive = target.closest(INTERACTIVE_SELECTOR);
        if (interactive && preview.contains(interactive))
            return;

        // Chromium can move a contenteditable caret to a distant paragraph when
        // a noneditable image group's background has no text position to select.
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

export function shouldSkipHtmlPreviewClick(muya: Muya, event: Event): boolean {
    return event.type === 'click' && (isHtmlPreviewTarget(event.target)
        || (event instanceof MouseEvent && isHtmlPreviewMarginTarget(muya, event)));
}
