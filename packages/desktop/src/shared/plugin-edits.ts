import { PluginError, type EditTransaction, type TextSelection } from '@shared/plugin-api'

export function applyTextChanges(markdown: string, transaction: EditTransaction): string {
  if (!Number.isSafeInteger(transaction.expectedRevision) || transaction.expectedRevision < 0 || !Array.isArray(transaction.changes) || transaction.changes.length > 10000) {
    throw new PluginError('INVALID_ARGUMENT', '编辑事务的版本或修改列表无效。')
  }
  const changes = [...transaction.changes].sort((a, b) => a.from - b.from || a.to - b.to)
  let end = 0
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!
    if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < end || change.to < change.from || change.to > markdown.length || typeof change.text !== 'string' || (index > 0 && change.from === changes[index - 1]!.from)) {
      throw new PluginError('INVALID_ARGUMENT', '修改范围无效或互相重叠。')
    }
    end = change.to
  }
  let result = markdown
  for (const change of changes.reverse()) result = result.slice(0, change.from) + change.text + result.slice(change.to)
  if (result.length > 20 * 1024 * 1024) throw new PluginError('INVALID_ARGUMENT', '正文超过插件编辑上限。')
  if (transaction.selection) validateSelection(transaction.selection, result.length)
  if (transaction.viewport && !['preserve', 'reveal-selection'].includes(transaction.viewport)) throw new PluginError('INVALID_ARGUMENT', '视口选项无效。')
  return result
}

export function validateSelection(selection: TextSelection, length: number): void {
  if (!selection || ![selection.anchor, selection.head].every(n => Number.isSafeInteger(n) && n >= 0 && n <= length)) throw new PluginError('INVALID_ARGUMENT', '选区偏移无效。')
}
