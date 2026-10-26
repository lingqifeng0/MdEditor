import { describe, expect, it } from 'vitest'
import { HtmlLayoutHistory } from '@/util/htmlLayoutHistory'

describe('HTML modal history', () => {
  it('keeps modal undo and redo snapshots separate, with no-op edits omitted', () => {
    const history = new HtmlLayoutHistory<string>(value => value)
    expect(history.record('original', 'original')).toBe(false)
    expect(history.canUndo).toBe(false)
    history.record('original', 'added')
    history.record('added', 'moved')
    expect(history.undo('moved')).toBe('added')
    expect(history.undo('added')).toBe('original')
    expect(history.undo('original')).toBeUndefined()
    expect(history.redo('original')).toBe('added')
    expect(history.redo('added')).toBe('moved')
  })

  it('coalesces a burst within one field, while another field is a separate action', () => {
    const history = new HtmlLayoutHistory<string>(value => value)
    history.record('', 'n', 'text:1', 0)
    history.record('n', 'new', 'text:1', 100)
    history.record('new', 'large', 'font:1', 200)
    expect(history.undo('large')).toBe('new')
    expect(history.undo('new')).toBe('')
  })

  it('starts a new typing action after a pause or a mode/focus boundary', () => {
    const history = new HtmlLayoutHistory<string>(value => value)
    history.record('', 'first', 'text', 0)
    history.record('first', 'second', 'text', 900)
    history.breakGroup()
    history.record('second', 'third', 'text', 1000)
    expect(history.undo('third')).toBe('second')
    expect(history.undo('second')).toBe('first')
  })

  it('invalidates redo when editing along a new branch', () => {
    const history = new HtmlLayoutHistory<string>(value => value)
    history.record('a', 'b', 'text', 0)
    expect(history.undo('b')).toBe('a')
    history.record('a', 'c', 'text', 20)
    expect(history.canRedo).toBe(false)
    expect(history.undo('c')).toBe('a')
  })

  it('bounds retained history and clears both stacks between modal sessions', () => {
    const history = new HtmlLayoutHistory<string>(value => value, 2)
    history.record('a', 'b')
    history.record('b', 'c')
    history.record('c', 'd')
    expect(history.undo('d')).toBe('c')
    expect(history.undo('c')).toBe('b')
    expect(history.undo('b')).toBeUndefined()
    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })
})
