export const HTML_LAYOUT_GRID_COLOR = '--mt-layout-grid-color'
export const HTML_LAYOUT_FONT_FAMILIES = ['inherit', '"Microsoft YaHei UI"', 'serif', 'monospace'] as const

export function htmlLayoutTableCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return Array.from(table.rows).flatMap(row => Array.from(row.cells))
}

export function tableCellGridStyles(cell: HTMLTableCellElement): [string, string][] {
  const styles: [string, string][] = [['border-color', `var(${HTML_LAYOUT_GRID_COLOR})`]]
  const hasBorder = ['top', 'right', 'bottom', 'left'].some(side => {
    const style = cell.style.getPropertyValue(`border-${side}-style`)
    return style && style !== 'none' && style !== 'hidden'
  })
  if (!hasBorder) styles.push(['border-style', 'solid'], ['border-width', '1px'])
  return styles
}

export function previewHtmlLayoutTableGrid(table: HTMLTableElement, color: string | null): void {
  table.style.setProperty(HTML_LAYOUT_GRID_COLOR, color ?? '#808080', 'important')
  if (table.style.getPropertyValue('border-style')) {
    table.style.setProperty('border-color', `var(${HTML_LAYOUT_GRID_COLOR})`, 'important')
  }
  for (const cell of htmlLayoutTableCells(table)) {
    for (const [property, value] of tableCellGridStyles(cell)) cell.style.setProperty(property, value, 'important')
  }
}

export function previewHtmlLayoutTableTracks(table: HTMLTableElement, widths?: number[], heights?: number[]): void {
  if (widths) {
    let columns = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'))
    if (!columns.length) {
      const group = document.createElement('colgroup')
      columns = widths.map(() => group.appendChild(document.createElement('col')))
      if (table.caption) table.caption.after(group)
      else table.prepend(group)
    }
    table.style.setProperty('table-layout', 'fixed', 'important')
    columns.forEach((column, index) => column.style.setProperty('width', `${widths[index]}px`, 'important'))
  }
  if (heights) {
    table.style.setProperty('height', 'auto', 'important')
    Array.from(table.rows).forEach((row, index) => row.style.setProperty('height', `${heights[index]}px`, 'important'))
  }
}

export function proportionalHtmlLayoutTracks(sizes: number[], minimums: number[], requested: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  const proportional = sizes.map(size => size * requested / total)
  if (proportional.every((size, index) => size >= minimums[index]!)) return proportional
  const minimum = minimums.reduce((sum, size) => sum + size, 0)
  const remainder = Math.max(0, requested - minimum)
  const weights = sizes.map((size, index) => Math.max(0, size - minimums[index]!))
  const weight = weights.reduce((sum, size) => sum + size, 0)
  return minimums.map((size, index) => size + remainder * (weight ? weights[index]! / weight : 1 / sizes.length))
}
