import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CellValueType, HorizontalAlign, VerticalAlign, WrapStrategy } from '@univerjs/core'
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

  it('returns a diagnostic for images without trying to render them', () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Images')
    const imageId = workbook.addImage({ base64: ONE_PIXEL_PNG_BASE64, extension: 'png' })
    worksheet.addImage(imageId, 'A1:B2')

    const preview = excelJsWorkbookToPreviewData(workbook, 'images.xlsx')

    expect(preview.diagnostics).toContainEqual({
      code: 'unsupported_excel_images',
      count: 1,
      message: 'Images are not rendered in Excel preview yet.',
      severity: 'warning'
    })
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
