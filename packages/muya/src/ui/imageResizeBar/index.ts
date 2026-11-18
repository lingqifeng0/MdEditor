import type Format from '../../block/base/format';
import type { Muya } from '../../index';
import type { ImageToken } from '../../inlineRenderer/types';
import { isHTMLElement, isMouseEvent } from '../../utils';
import './index.css';

const VERTICAL_BAR = ['left', 'right'];

export class ImageResizeBar {
    static pluginName = 'transformer';
    private _reference: HTMLElement | null = null;
    private _block: Format | null = null;
    private _imageInfo: {
        token: ImageToken;
        imageId: string;
    } | null = null;

    private _width: number | null = null;
    // Pointer position and image width as of mousedown. Writing a width moves
    // the image's own edges, so live geometry is not a usable reference while
    // dragging — only this snapshot is (#5392).
    private _dragStart: {
        image: HTMLImageElement;
        side: 'left' | 'right';
        clientX: number;
        width: number;
        previousWidth: string | null;
    } | null = null;

    private _eventId: string[] = [];
    private _container: HTMLSpanElement;

    constructor(public muya: Muya) {
        const container = (this._container = document.createElement('span'));
        container.classList.add('mu-transformer');
        container.setAttribute('aria-hidden', 'true');
        for (const side of VERTICAL_BAR) {
            const bar = document.createElement('span');
            bar.classList.add('bar', side);
            bar.setAttribute('data-position', side);
            container.appendChild(bar);
        }
        this._listen();
    }

    private _listen() {
        const { eventCenter } = this.muya;

        eventCenter.on('muya-transformer', ({ block, reference, imageInfo }) => {
            if (this._reference !== reference)
                this.hide();
            this._reference = reference;
            if (reference) {
                this._block = block;
                this._imageInfo = imageInfo;
                // Resizing rewrites the image. Attach to the new node after the
                // click that follows mouseup has finished.
                setTimeout(() => {
                    if (this._reference === reference)
                        this._render();
                });
            }
            else {
                this._block = null;
                this._imageInfo = null;
            }
        });

        eventCenter.attachDOMEvent(document, 'click', this.hide.bind(this));
        eventCenter.attachDOMEvent(this._container, 'click', event =>
            event.stopPropagation());
        eventCenter.attachDOMEvent(this._container, 'dragstart', event =>
            event.preventDefault());
        eventCenter.attachDOMEvent(this._container, 'mousedown', this._mouseDown);
    }

    private _render() {
        const reference = this._reference;
        if (!reference?.isConnected)
            return;
        // The contenteditable=false image wrapper already participates in the
        // editor's clipping and alignment. Its outline needs no scroll listener.
        reference.appendChild(this._container);
        this.muya.eventCenter.emit('muya-float', this, true);
    }

    private _mouseDown = (event: Event) => {
        if (!isMouseEvent(event) || event.button !== 0 || this._dragStart)
            return;

        const { target } = event;
        const handle = isHTMLElement(target) ? target.closest('.bar') : null;
        const side = handle?.getAttribute('data-position');
        const image = this._reference?.querySelector('img');
        if (!image || (side !== 'left' && side !== 'right'))
            return;

        const { eventCenter } = this.muya;
        event.preventDefault();
        event.stopPropagation();
        this._dragStart = {
            image,
            side,
            clientX: event.clientX,
            width: image.getBoundingClientRect().width,
            previousWidth: image.getAttribute('width'),
        };
        // A pointer dragged past the window's edge keeps driving the resize,
        // but those out-of-viewport coordinates hit test to `<html>`, whose
        // bubble path skips `<body>`. Listening on the document keeps the
        // release outside the window a normal release instead of a silently
        // dropped width (#5393).
        const mouseMoveId = eventCenter.attachDOMEvent(
            document,
            'mousemove',
            this._mouseMove,
        );
        const mouseUpId = eventCenter.attachDOMEvent(
            document,
            'mouseup',
            this._mouseUp,
        );
        // Hide image toolbar
        eventCenter.emit('muya-image-toolbar', { reference: null });
        this._eventId.push(mouseMoveId, mouseUpId);
    };

    private _mouseMove = (event: Event) => {
        if (!isMouseEvent(event))
            return;

        event.preventDefault();
        const dragStart = this._dragStart;
        if (!dragStart || !dragStart.image.isConnected)
            return;

        const delta = event.clientX - dragStart.clientX;
        const width = Math.trunc(Math.max(dragStart.width + (dragStart.side === 'right' ? delta : -delta), 50));
        this._width = width;
        dragStart.image.setAttribute('width', String(width));
    };

    private _mouseUp = (event: Event) => {
        event.preventDefault();
        const { _width: width, _block: block, _imageInfo: imageInfo, _dragStart: dragStart } = this;
        if (width !== null && block && imageInfo && dragStart?.image.isConnected) {
            this._dragStart = null;
            this.hide();
            block.updateImage(imageInfo, 'width', String(width));
        }
        else {
            this._detachResizeListeners();
            this._dragStart = null;
            this._width = null;
        }
    };

    private _detachResizeListeners() {
        const { eventCenter } = this.muya;
        for (const id of this._eventId)
            eventCenter.detachDOMEvent(id);

        this._eventId = [];
    }

    hide() {
        const { eventCenter } = this.muya;
        this._detachResizeListeners();
        const drag = this._dragStart;
        if (this._width !== null && drag?.image.isConnected) {
            if (drag.previousWidth === null)
                drag.image.removeAttribute('width');
            else
                drag.image.setAttribute('width', drag.previousWidth);
        }
        this._width = null;
        this._dragStart = null;
        if (this._container.parentElement) {
            this._container.remove();
            eventCenter.emit('muya-float', this, false);
        }
    }

    destroy() {
        this._reference = null;
        this._block = null;
        this._imageInfo = null;
        this.hide();
    }
}
