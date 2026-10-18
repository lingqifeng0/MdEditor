export interface ZoomState {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 16
export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 }

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * Scale `state` by `factor` while the content point currently under
 * (`px`, `py`) stays there. (`cx`, `cy`) is where the content's own centre sits
 * when untransformed — the transform is `translate(x, y) scale(scale)` with
 * `transform-origin: center`.
 */
export function zoomAt(
  state: ZoomState,
  factor: number,
  px: number,
  py: number,
  cx: number,
  cy: number
): ZoomState {
  const scale = clampScale(state.scale * factor)
  const k = scale / state.scale
  if (k === 1) return state

  return {
    scale,
    x: (px - cx) * (1 - k) + k * state.x,
    y: (py - cy) * (1 - k) + k * state.y
  }
}

/** The scale that makes `content` fit inside `viewport`, never enlarging it. */
export function fitScale(content: Size, viewport: Size): number {
  if (content.width <= 0 || content.height <= 0) return 1

  const scale = Math.min(viewport.width / content.width, viewport.height / content.height)

  return clampScale(Math.min(1, scale))
}

export function pan(state: ZoomState, dx: number, dy: number): ZoomState {
  return { ...state, x: state.x + dx, y: state.y + dy }
}

export function toTransform(state: ZoomState): string {
  return `translate(${state.x}px, ${state.y}px) scale(${state.scale})`
}

/** Wheel deltas use pixels, lines, or pages; 120 pixels changes scale by 10%. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, viewportHeight: number): number {
  const unit = deltaMode === 1 ? 40 : deltaMode === 2 ? viewportHeight : 1
  const pixels = Math.max(-1200, Math.min(1200, deltaY * unit))
  return Math.exp(-pixels * Math.log(1.1) / 120)
}

export interface ZoomPanOptions {
  onChange?: (state: ZoomState) => void
  /**
   * Where wheel events are listened for. Defaults to the viewport, which is
   * wrong wherever something is layered on top of it: the wheel would then be
   * dead over exactly the controls the pointer tends to rest on.
   */
  wheelSurface?: HTMLElement
}

/**
 * Wheel-zoom and drag-pan for one element inside a viewport. Writes a CSS
 * transform onto the content and owns nothing else about the DOM.
 */
export class ZoomPanController {
  private _state: ZoomState = IDENTITY
  private _pointerId: number | null = null
  private _originX = 0
  private _originY = 0
  private readonly _wheelSurface: HTMLElement
  private readonly _onWheel: (event: WheelEvent) => void
  private readonly _onPointerDown: (event: PointerEvent) => void
  private readonly _onPointerMove: (event: PointerEvent) => void
  private readonly _onPointerEnd: (event: PointerEvent) => void
  private readonly _onBlur: () => void

  constructor(
    private readonly viewport: HTMLElement,
    private readonly content: HTMLElement,
    private readonly options: ZoomPanOptions = {}
  ) {
    this.content.style.transformOrigin = 'center center'
    this._wheelSurface = options.wheelSurface ?? viewport
    this.viewport.style.cursor = 'grab'

    this._onWheel = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.deltaY === 0) return
      const [cx, cy] = this._centre()
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode, this.viewport.clientHeight)
      this._apply(zoomAt(this._state, factor, event.clientX, event.clientY, cx, cy))
    }
    this._onPointerDown = (event) => {
      if (event.button !== 0 || this._pointerId !== null) return
      this._pointerId = event.pointerId
      this._originX = event.clientX - this._state.x
      this._originY = event.clientY - this._state.y
      this.viewport.style.cursor = 'grabbing'
      // Chromium releases capture on cancellation; a hidden or detached stage
      // can also stop being a valid capture target between pointer events.
      try { this.viewport.setPointerCapture(event.pointerId) } catch {}
      event.preventDefault()
    }
    this._onPointerMove = (event) => {
      if (event.pointerId !== this._pointerId) return
      this._apply({
        ...this._state,
        x: event.clientX - this._originX,
        y: event.clientY - this._originY
      })
    }
    this._onPointerEnd = (event) => {
      if (event.pointerId === this._pointerId) this._endDrag()
    }
    this._onBlur = () => this._endDrag()

    this._wheelSurface.addEventListener('wheel', this._onWheel, { passive: false })
    this.viewport.addEventListener('pointerdown', this._onPointerDown)
    this.viewport.addEventListener('lostpointercapture', this._onPointerEnd)
    document.addEventListener('pointermove', this._onPointerMove)
    document.addEventListener('pointerup', this._onPointerEnd)
    document.addEventListener('pointercancel', this._onPointerEnd)
    window.addEventListener('blur', this._onBlur)
  }

  get scale(): number {
    return this._state.scale
  }

  zoomBy(factor: number): void {
    const [cx, cy] = this._centre()
    this._apply(zoomAt(this._state, factor, cx, cy, cx, cy))
  }

  panBy(dx: number, dy: number): void {
    this._apply(pan(this._state, dx, dy))
  }

  fit(): void {
    const scale = fitScale(
      { width: this.content.offsetWidth, height: this.content.offsetHeight },
      { width: this.viewport.clientWidth, height: this.viewport.clientHeight }
    )
    this._apply({ ...IDENTITY, scale })
  }

  actualSize(): void {
    this._apply(IDENTITY)
  }

  destroy(): void {
    // A drag can outlive the controller — the viewport element is reused by
    // the next open, and `grabbing` would be stuck on it.
    this._endDrag()
    this._wheelSurface.removeEventListener('wheel', this._onWheel)
    this.viewport.removeEventListener('pointerdown', this._onPointerDown)
    this.viewport.removeEventListener('lostpointercapture', this._onPointerEnd)
    document.removeEventListener('pointermove', this._onPointerMove)
    document.removeEventListener('pointerup', this._onPointerEnd)
    document.removeEventListener('pointercancel', this._onPointerEnd)
    window.removeEventListener('blur', this._onBlur)
  }

  private _endDrag(): void {
    const pointerId = this._pointerId
    this._pointerId = null
    this.viewport.style.cursor = 'grab'
    if (pointerId !== null && this.viewport.hasPointerCapture?.(pointerId)) {
      this.viewport.releasePointerCapture(pointerId)
    }
  }

  private _centre(): [number, number] {
    const { left, top, width, height } = this.viewport.getBoundingClientRect()
    return [left + width / 2, top + height / 2]
  }

  private _apply(state: ZoomState): void {
    this._state = state
    this.content.style.transform = toTransform(state)
    this.options.onChange?.(state)
  }
}
