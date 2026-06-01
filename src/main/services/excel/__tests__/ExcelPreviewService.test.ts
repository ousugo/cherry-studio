import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CellValueType, HorizontalAlign, VerticalAlign, WrapStrategy } from '@univerjs/core'
import AdmZip from 'adm-zip'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EXCEL_PREVIEW_MAX_SIZE_BYTES, readExcelWorkbookPreview } from '../ExcelPreviewService'
import { excelJsWorkbookToPreviewData } from '../excelToUniverWorkbook'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZRtWQAAAABJRU5ErkJggg=='

let tempDir: string

const writeWorkbook = async (fileName: string, workbook: ExcelJS.Workbook): Promise<string> => {
  const filePath = path.join(tempDir, fileName)
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

const writeZipWorkbook = (fileName: string, entries: Record<string, string>): string => {
  const filePath = path.join(tempDir, fileName)
  const zip = new AdmZip()
  Object.entries(entries).forEach(([entryName, content]) => {
    zip.addFile(entryName, Buffer.from(content))
  })
  zip.writeZip(filePath)
  return filePath
}

const writeWorkbookWithChartDrawing = (): string =>
  writeZipWorkbook('chart-drawing.xlsx', {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="7" r:id="rId1"/>
  </sheets>
</workbook>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:C1"/>
  <cols>
    <col min="1" max="1" width="20" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Name</t></is></c>
      <c r="C1"><v>42</v></c>
    </row>
  </sheetData>
  <mergeCells count="1">
    <mergeCell ref="A1:B1"/>
  </mergeCells>
  <drawing r:id="rId1"/>
</worksheet>`,
    'xl/worksheets/_rels/sheet1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml"/>
</Relationships>`,
    'xl/drawings/drawing1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
  <oneCellAnchor>
    <from><col>0</col><colOff>0</colOff><row>2</row><rowOff>0</rowOff></from>
    <ext cx="7560000" cy="4680000"/>
    <graphicFrame>
      <nvGraphicFramePr><cNvPr id="1" name="Chart 1"/><cNvGraphicFramePr/></nvGraphicFramePr>
      <xfrm/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
    </graphicFrame>
    <clientData/>
  </oneCellAnchor>
</wsDr>`,
    'xl/drawings/_rels/drawing1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart1.xml"/>
</Relationships>`,
    'xl/charts/chart1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>`
  })

describe('ExcelPreviewService', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-excel-preview-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  it('reads an xlsx workbook and converts values, formulas, merges, dimensions, and styles', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Summary')
    const hiddenWorksheet = workbook.addWorksheet('Hidden')
    hiddenWorksheet.state = 'hidden'

    worksheet.getColumn(1).width = 12
    worksheet.getColumn(40).width = 20
    worksheet.getRow(1).height = 24
    worksheet.getRow(10).height = 30
    worksheet.getCell('A1').value = 'Header'
    worksheet.getCell('A1').font = {
      bold: true,
      color: { argb: 'FFFF0000' },
      italic: true,
      name: 'Calibri',
      size: 14
    }
    worksheet.getCell('A1').fill = {
      fgColor: { argb: 'FFE2F0D9' },
      pattern: 'solid',
      type: 'pattern'
    }
    worksheet.getCell('A1').border = {
      bottom: { style: 'thin', color: { argb: 'FF00FF00' } }
    }
    worksheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    worksheet.getCell('A2').value = 21
    worksheet.getCell('B2').value = { formula: 'A2*2', result: 42 }
    worksheet.getCell('B2').numFmt = '#,##0'
    worksheet.getCell('C2').value = { error: '#VALUE!' }
    const dateValue = new Date(Date.UTC(2026, 0, 1))
    worksheet.getCell('D2').value = dateValue
    worksheet.getCell('D2').numFmt = 'yyyy-mm-dd'
    worksheet.mergeCells('A1:B1')

    const filePath = await writeWorkbook('report.xlsx', workbook)
    const result = await readExcelWorkbookPreview({ filePath, fileName: 'report.xlsx' })

    expect(result.success).toBe(true)
    if (!result.success) return

    const workbookData = result.data.workbookData
    const sheet = workbookData.sheets['sheet-1']
    const hiddenSheet = workbookData.sheets['sheet-2']
    const headerCell = sheet.cellData?.[0]?.[0]
    const formulaCell = sheet.cellData?.[1]?.[1]
    const errorCell = sheet.cellData?.[1]?.[2]
    const dateCell = sheet.cellData?.[1]?.[3]
    const headerStyle = workbookData.styles[headerCell?.s as string]
    const dateStyle = workbookData.styles[dateCell?.s as string]

    expect(workbookData.name).toBe('report')
    expect(workbookData.sheetOrder).toEqual(['sheet-1', 'sheet-2'])
    expect(sheet.name).toBe('Summary')
    expect(hiddenSheet.hidden).toBe(1)
    expect(headerCell).toMatchObject({ t: CellValueType.STRING, v: 'Header' })
    expect(sheet.cellData?.[1]?.[0]).toMatchObject({ t: CellValueType.NUMBER, v: 21 })
    expect(formulaCell).toMatchObject({ f: '=A2*2', t: CellValueType.NUMBER, v: 42 })
    expect(errorCell).toMatchObject({ t: CellValueType.STRING, v: '#VALUE!' })
    expect(dateCell?.t).toBe(CellValueType.NUMBER)
    expect(dateCell?.v).toBeCloseTo(25569 + dateValue.getTime() / (24 * 60 * 60 * 1000), 5)
    expect(sheet.mergeData).toContainEqual({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 })
    expect(sheet.rowData?.[0]?.h).toBe(32)
    expect(sheet.rowData?.[9]?.h).toBe(40)
    expect(sheet.columnData?.[0]?.w).toBe(96)
    expect(sheet.columnData?.[39]?.w).toBe(160)
    expect(sheet.columnCount).toBeGreaterThanOrEqual(40)
    expect(headerStyle).toMatchObject({
      bl: 1,
      it: 1,
      ff: 'Calibri',
      fs: 14,
      cl: { rgb: '#FF0000' },
      bg: { rgb: '#E2F0D9' },
      ht: HorizontalAlign.CENTER,
      vt: VerticalAlign.MIDDLE,
      tb: WrapStrategy.WRAP
    })
    expect(headerStyle?.bd?.b).toMatchObject({
      cl: { rgb: '#00FF00' }
    })
    expect(formulaCell?.s ? workbookData.styles[formulaCell.s as string] : null).toMatchObject({
      n: { pattern: '#,##0' }
    })
    expect(dateStyle).toMatchObject({
      n: { pattern: 'yyyy-mm-dd' }
    })
  })

  it('serializes worksheet images for canvas rendering', () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Images')
    const imageId = workbook.addImage({ base64: ONE_PIXEL_PNG_BASE64, extension: 'png' })
    worksheet.addImage(imageId, 'A1:B2')

    const preview = excelJsWorkbookToPreviewData(workbook, 'images.xlsx')
    const sheet = preview.workbookData.sheets['sheet-1']

    expect(preview.diagnostics).toEqual([])
    expect(sheet.cellData?.[0]?.[0]?.custom?.excelImages).toEqual([
      {
        from: { column: 0, columnOffset: 0, row: 0, rowOffset: 0 },
        id: 'sheet-1-image-1',
        source: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`,
        to: { column: 2, columnOffset: 0, row: 2, rowOffset: 0 }
      }
    ])
  })

  it('falls back to a cell-only preview when workbook sheet id differs from its sheet file number', async () => {
    const filePath = writeWorkbookWithChartDrawing()

    const result = await readExcelWorkbookPreview({ filePath, fileName: 'chart-drawing.xlsx' })

    expect(result.success).toBe(true)
    if (!result.success) return

    const sheet = result.data.workbookData.sheets['sheet-1']
    expect(result.data.diagnostics).toContainEqual({
      code: 'unsupported_excel_charts',
      count: 1,
      message: 'Charts are not rendered in Excel preview yet.',
      severity: 'warning'
    })
    expect(sheet.name).toBe('Data')
    expect(sheet.cellData?.[0]?.[0]).toMatchObject({ t: CellValueType.STRING, v: 'Name' })
    expect(sheet.cellData?.[0]?.[2]).toMatchObject({ t: CellValueType.NUMBER, v: 42 })
    expect(sheet.columnData?.[0]?.w).toBe(160)
    expect(sheet.mergeData).toContainEqual({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 })
  })

  it('returns unsupported for legacy xls files', async () => {
    const result = await readExcelWorkbookPreview({ filePath: path.join(tempDir, 'legacy.xls') })

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'unsupported_xls_format'
      }
    })
  })

  it('rejects invalid preview requests before reading files', async () => {
    const result = await readExcelWorkbookPreview({ filePath: 'relative/report.xlsx' })

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'invalid_excel_preview_request'
      }
    })
  })

  it('returns a clear error for files above the Excel preview size limit', async () => {
    const filePath = path.join(tempDir, 'huge.xlsx')
    await fs.writeFile(filePath, '')
    await fs.truncate(filePath, EXCEL_PREVIEW_MAX_SIZE_BYTES + 1)

    const result = await readExcelWorkbookPreview({ filePath })

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'excel_file_too_large'
      }
    })
  })

  it('returns a clear error when the workbook exceeds preview complexity limits', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Large')
    worksheet.getCell('A1').value = 1
    worksheet.getCell('A2').value = 2
    const filePath = await writeWorkbook('complex.xlsx', workbook)

    const result = await readExcelWorkbookPreview({ filePath }, { budget: { maxCells: 1 } })

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'excel_preview_too_complex'
      }
    })
  })
})
