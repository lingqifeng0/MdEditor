export const TOOLBAR_BUTTONS = [
  'codeblock', 'heading-n', 'strong', 'em', 'u', 'del', 'mark', 'inline_code',
  'inline_math', 'sup', 'sub', 'link', 'clear', 'table', 'mathblock',
  'ul-bullet', 'ol-order', 'ul-task', 'blockquote', 'align-left', 'align-center',
  'align-right', 'align-justify', 'undo', 'redo', 'text-color', 'background-color'
] as const

export type ToolbarButton = typeof TOOLBAR_BUTTONS[number]

// Missing entries are appended so settings from older versions never hide new tools.
export const normalizeToolbarOrder = (value: unknown): ToolbarButton[] => {
  const known = new Set<string>(TOOLBAR_BUTTONS)
  const saved = Array.isArray(value) ? value.filter((id): id is ToolbarButton => typeof id === 'string' && known.has(id)) : []
  return [...new Set([...saved, ...TOOLBAR_BUTTONS])]
}

export const swapToolbarButtons = (value: unknown, id: string, target: string): ToolbarButton[] => {
  const order = normalizeToolbarOrder(value)
  const from = order.indexOf(id as ToolbarButton)
  const to = order.indexOf(target as ToolbarButton)
  if (from < 0 || to < 0 || from === to) return order
  const previous = order[from]
  order[from] = order[to]
  order[to] = previous
  return order
}
