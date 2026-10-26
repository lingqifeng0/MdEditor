/** Snapshots belong to the caller and must not be mutated after recording. */
export class HtmlLayoutHistory<T> {
  private past: T[] = []
  private future: T[] = []
  private group = ''
  private changedAt = 0

  constructor(private key: (state: T) => string, private limit = 80) {}

  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }

  record(before: T, after: T, group = '', now = Date.now()) {
    if (this.key(before) === this.key(after)) return false
    if (!group || group !== this.group || now - this.changedAt > 800 || this.future.length) {
      this.past.push(before)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.future = []
    this.group = group
    this.changedAt = now
    return true
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop()
    if (previous === undefined) return undefined
    this.future.push(current)
    this.breakGroup()
    return previous
  }

  redo(current: T): T | undefined {
    const next = this.future.pop()
    if (next === undefined) return undefined
    this.past.push(current)
    this.breakGroup()
    return next
  }

  breakGroup() { this.group = '' }

  clear() {
    this.past = []
    this.future = []
    this.breakGroup()
  }
}
