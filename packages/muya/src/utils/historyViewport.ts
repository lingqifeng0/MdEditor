interface IScrollPosition {
    element: HTMLElement;
    top: number;
    left: number;
}

/** Holds the viewport while commands replace DOM and Chromium restores its range. */
export class HistoryViewport {
    private _positions: IScrollPosition[] = [];
    private _frame: number | null = null;
    private _active = true;
    private _events = ['wheel', 'pointerdown', 'touchstart', 'keydown'];
    private _cancel = () => this.cancel();

    constructor(root: HTMLElement, private _onSettled: () => void) {
        for (let element: HTMLElement | null = root; element; element = element.parentElement) {
            this._positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
        }
        for (const event of this._events)
            document.addEventListener(event, this._cancel, { capture: true, passive: true });
    }

    restore(): void {
        if (!this._active)
            return;
        for (const position of this._positions) {
            if (position.element.isConnected) {
                position.element.scrollTop = position.top;
                position.element.scrollLeft = position.left;
            }
        }
    }

    settle(): void {
        this.restore();
        let remaining = 2;
        const next = () => {
            this._frame = null;
            this.restore();
            if (--remaining > 0)
                this._frame = requestAnimationFrame(next);
            else
                this.cancel();
        };
        this._frame = requestAnimationFrame(next);
    }

    cancel(): void {
        if (!this._active)
            return;
        this._active = false;
        if (this._frame !== null)
            cancelAnimationFrame(this._frame);
        for (const event of this._events)
            document.removeEventListener(event, this._cancel, true);
        this._onSettled();
    }
}
