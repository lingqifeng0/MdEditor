import { afterEach, describe, expect, it } from 'vitest'
import { askImageOperation, confirmImageOperation, finishImageOperation, imageOperationPrompt } from '@/util/imageOperationDialog'

afterEach(() => finishImageOperation(false))
describe('persistent single image operation prompt', () => {
  it('retains only the first pending operation and never auto-dismisses', async() => {
    const first = askImageOperation({ title: 'first', message: 'pending' })
    expect(await askImageOperation({ title: 'second', message: 'ignored' })).toBe(false)
    expect(imageOperationPrompt.value?.title).toBe('first')
    finishImageOperation(false)
    expect(await first).toBe(false)
    expect(imageOperationPrompt.value).toBeNull()
  })
  it('stays open after save picker cancellation or an operation error', async() => {
    let attempt = 0
    const pending = askImageOperation({
      title: 'save',
      message: 'pending',
      onConfirm: async() => {
        attempt++
        if (attempt === 1) return false
        if (attempt === 2) throw new Error('cannot write')
        return true
      }
    })
    await confirmImageOperation()
    expect(imageOperationPrompt.value?.busy).toBe(false)
    await confirmImageOperation()
    expect(imageOperationPrompt.value?.error).toBe('cannot write')
    await confirmImageOperation()
    expect(await pending).toBe(true)
  })
  it('cannot dispatch the same filesystem operation twice while confirmation is running', async() => {
    let complete: (value: boolean) => void = () => {}
    const pending = askImageOperation({ title: 'save', message: 'pending', onConfirm: () => new Promise(resolve => { complete = resolve }) })
    const confirm = confirmImageOperation()
    await confirmImageOperation()
    finishImageOperation(false)
    expect(imageOperationPrompt.value?.busy).toBe(true)
    complete(true)
    await confirm
    expect(await pending).toBe(true)
  })
})
