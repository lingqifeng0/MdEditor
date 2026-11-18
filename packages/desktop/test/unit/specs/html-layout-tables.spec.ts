import { describe, expect, it } from 'vitest'
import {
  appendHtmlLayoutTable,
  applyHtmlLayoutEdits,
  createHtmlLayoutDocument,
  editHtmlLayoutTableStructure,
  removeHtmlLayoutTable
} from '@/util/htmlLayout'
import { HTML_LAYOUT_GRID_COLOR, proportionalHtmlLayoutTracks } from '@/util/htmlLayoutTableStyles'

const parseTable = (source: string) =>
  new DOMParser().parseFromString(source, 'text/html').querySelector('table')!

describe('HTML layout table source edits', () => {
  it('uses complete, independent tracks and selects both empty and rich cells without flattening markup', () => {
    const source = '<table><tr><th>项目</th><th>值</th></tr><tr><td></td><td><b>富文本</b></td></tr></table>'
    const model = createHtmlLayoutDocument(source)
    const table = model.tables[0]!
    const [empty, rich] = table.rows[1]!.cells.map(id => model.targets.find(target => target.id === id)!)
    expect(table.editableTracks).toBe(true)
    expect(empty?.textEditable).toBe(true)
    expect(rich?.textEditable).toBe(false)
    expect(() => applyHtmlLayoutEdits(model, [{ id: rich!.id, text: '转换' }])).toThrow()
    const html = applyHtmlLayoutEdits(model, [{ id: rich!.id, backgroundColor: '#224466' }])
    expect(html).toContain('<b>富文本</b>')
    expect(parseTable(html).rows[1]!.cells[1]!.style.backgroundColor).toBe('rgb(34, 68, 102)')
  })

  it('persists grid, scoped font and fill, row sizes and existing column styles as localized patches', () => {
    const source = '<div><!-- 保留 --><table aria-label="参数"><caption>原说明</caption><colgroup><col data-original="first"><col width="120"></colgroup><tbody><tr><td style="border:2px dotted blue!important">名字</td><td>3.3 V</td></tr></tbody></table><p id="outside">保持</p></div>'
    const model = createHtmlLayoutDocument(source)
    const table = model.tables[0]!
    const cell = table.rows[0]!.cells[1]!
    const html = applyHtmlLayoutEdits(model, [
      { id: table.id, gridColor: '#d98a42', width: 330, columnWidths: [120, 210], rowHeights: [60] },
      { id: cell, text: '\n电压\n\n<值>&', textFlow: true, fontSize: 22, fontFamily: 'monospace', color: '#225577', backgroundColor: '#3b815f' }
    ])
    const result = parseTable(html)
    expect(result.style.getPropertyValue(HTML_LAYOUT_GRID_COLOR)).toBe('#d98a42')
    expect(result.querySelector('col[data-original=first]')?.getAttribute('style')).toContain('width: 120px')
    expect(result.querySelector('col[width="120"]')?.getAttribute('style')).toContain('width: 210px')
    expect(result.rows[0]!.style.height).toBe('60px')
    expect(result.rows[0]!.cells[1]!.textContent).toBe('\n电压\n\n<值>&')
    expect(result.rows[0]!.cells[1]!.style.fontFamily).toBe('monospace')
    expect(result.rows[0]!.cells[1]!.style.backgroundColor).toBe('rgb(59, 129, 95)')
    expect(html).toContain('border:2px dotted blue!important')
    expect(html).toContain('<!-- 保留 -->')
    expect(html).toContain('<p id="outside">保持</p>')
    expect(html).toContain('&#10;&#10;&lt;值&gt;&amp;')
    expect(html).not.toContain(model.markerAttribute)
  })

  it('inserts and removes whole rows and columns alongside authored markup and tracks', () => {
    let model = createHtmlLayoutDocument('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><em>C</em></td><td>D</td></tr></tbody></table>')
    let table = model.tables[0]!
    model = createHtmlLayoutDocument(applyHtmlLayoutEdits(model, [{ id: table.id, width: 200, columnWidths: [95, 105], gridColor: '#ff8822' }]))
    table = model.tables[0]!
    const addedColumn = editHtmlLayoutTableStructure(model, table.id, 'add-column', table.rows[1]!.cells[0])
    expect(parseTable(addedColumn).querySelectorAll('col')).toHaveLength(3)
    expect(parseTable(addedColumn).rows[0]!.cells).toHaveLength(3)
    expect(addedColumn).toContain('<em>C</em>')
    expect(addedColumn).toContain(`var(${HTML_LAYOUT_GRID_COLOR}, #808080)`)
    model = createHtmlLayoutDocument(addedColumn)
    table = model.tables[0]!
    const addedRow = editHtmlLayoutTableStructure(model, table.id, 'add-row', table.rows[1]!.cells[1])
    model = createHtmlLayoutDocument(addedRow)
    table = model.tables[0]!
    expect(table.rows.map(row => row.cells.length)).toEqual([3, 3, 3])
    const removedRow = editHtmlLayoutTableStructure(model, table.id, 'remove-row', table.rows[2]!.cells[0])
    expect(removedRow).toBe(addedColumn)
    model = createHtmlLayoutDocument(removedRow)
    table = model.tables[0]!
    const removedColumn = editHtmlLayoutTableStructure(model, table.id, 'remove-column', table.rows[1]!.cells[1])
    expect(parseTable(removedColumn).querySelectorAll('col')).toHaveLength(2)
    expect(removedColumn).toContain('<em>C</em>')
  })

  it('places a new table inside a legal outer frame and leaves other HTML in the same block', () => {
    const before = '<p id="group" style="display:flex"><!-- 原注释 --><img src="diagram.png"><span>说明</span></p>'
    const html = appendHtmlLayoutTable(createHtmlLayoutDocument(before), 'position: absolute; top: 110px; width: 280px;')
    const model = createHtmlLayoutDocument(html)
    const table = model.tables[0]!
    expect(html).toContain('<div id="group" style="display:flex"><!-- 原注释 --><img src="diagram.png"><span>说明</span>')
    expect(model.rootContainer).toBe(true)
    expect(table.rows).toHaveLength(3)
    expect(removeHtmlLayoutTable(model, table.id)).toContain('<img src="diagram.png"><span>说明</span>')
    expect(html).not.toMatch(/\n\s*\n/)
  })

  it('preserves merged cells and permits whole-table styling without enabling destructive track edits', () => {
    const source = '<table><tr><th colspan="2"><b>完整标题</b></th></tr><tr><td>A</td><td>B</td></tr></table>'
    const model = createHtmlLayoutDocument(source)
    const table = model.tables[0]!
    expect(table.editableTracks).toBe(false)
    expect(editHtmlLayoutTableStructure(model, table.id, 'add-column')).toBe(source)
    expect(applyHtmlLayoutEdits(model, [{ id: table.id, gridColor: '#112233' }])).toContain('colspan="2"')
    expect(removeHtmlLayoutTable(model, table.id)).toBe('<div></div>')
    expect(proportionalHtmlLayoutTracks([80, 120], [50, 50], 180)).toEqual([72, 108])
    expect(proportionalHtmlLayoutTracks([80, 120], [65, 45], 90)).toEqual([65, 45])
  })
})
