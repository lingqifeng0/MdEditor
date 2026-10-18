const animations = new WeakMap<HTMLElement, number>()

export const cancelAnimatedScrollTo = (element: HTMLElement): void => {
  const frame = animations.get(element)
  if (frame !== undefined) cancelAnimationFrame(frame)
  animations.delete(element)
}

export const animatedScrollTo = (
  element: HTMLElement,
  to: number,
  duration: number,
  callback?: () => void
): void => {
  cancelAnimatedScrollTo(element)
  const start = element.scrollTop
  const change = to - start
  const animationStart = Date.now()
  if (Math.abs(change) <= 6 || duration === 0) {
    element.scrollTop = to
    return
  }
  const animate = (): void => {
    const elapsed = Math.min(Date.now() - animationStart, duration)
    const progress = elapsed / (duration / 2)
    const eased = progress < 1
      ? change / 2 * progress * progress + start
      : -change / 2 * ((progress - 1) * (progress - 3) - 1) + start
    element.scrollTop = Math.floor(eased)
    if (elapsed >= duration) {
      animations.delete(element)
      element.scrollTop = to
      callback?.()
    } else {
      animations.set(element, requestAnimationFrame(animate))
    }
  }
  animations.set(element, requestAnimationFrame(animate))
}
