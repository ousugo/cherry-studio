import type { ExcelImportDiagnostic, ExcelWorkbookPreviewData } from '@shared/excelPreview'
import {
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  type IBorderStyleData,
  type ICellData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData,
  LocaleType,
  VerticalAlign,
  WrapStrategy
} from '@univerjs/core'
import type ExcelJS from 'exceljs'

const UNIVER_MODEL_VERSION = '0.25.0'
const DEFAULT_ROW_COUNT = 100
const DEFAULT_COLUMN_COUNT = 26
const DEFAULT_ROW_HEIGHT = 23
const DEFAULT_COLUMN_WIDTH = 88
const DEFAULT_ROW_HEADER_WIDTH = 46
const DEFAULT_COLUMN_HEADER_HEIGHT = 20
const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXCEL_UNIX_EPOCH_OFFSET_DAYS = 25569
const EXCEL_1904_OFFSET_DAYS = 1462

type CellMatrix = NonNullable<IWorksheetData['cellData']>
type RowData = NonNullable<IWorksheetData['rowData']>
type ColumnData = NonNullable<IWorksheetData['columnData']>
type MergeRange = NonNullable<IWorksheetData['mergeData']>[number]

export interface ExcelWorkbookPreviewBudget {
  maxCells?: number
  maxColumnsPerSheet?: number
  maxMerges?: number
  maxPayloadBytes?: number
  maxRowsPerSheet?: number
  maxSheets?: number
  maxStyles?: number
}

type NormalizedExcelWorkbookPreviewBudget = Required<ExcelWorkbookPreviewBudget>

export const DEFAULT_EXCEL_WORKBOOK_PREVIEW_BUDGET: NormalizedExcelWorkbookPreviewBudget = {
  maxCells: 200_000,
  maxColumnsPerSheet: 5_000,
  maxMerges: 10_000,
  maxPayloadBytes: 20 * 1024 * 1024,
  maxRowsPerSheet: 100_000,
  maxSheets: 50,
  maxStyles: 50_000
}

interface WorkbookBuildCounters {
  cells: number
  merges: number
  payloadBytes: number
  styles: number
}

interface WorkbookBuildContext {
  budget: NormalizedExcelWorkbookPreviewBudget
  counters: WorkbookBuildCounters
  date1904: boolean
  styles: IWorkbookData['styles']
  styleIdsByKey: Map<string, string>
}

export class ExcelWorkbookPreviewBudgetExceededError extends Error {
  readonly code = 'excel_preview_too_complex'

  constructor(message = 'Excel workbook is too complex to preview.') {
    super(message)
    this.name = 'ExcelWorkbookPreviewBudgetExceededError'
  }
}

const normalizeBudget = (budget?: ExcelWorkbookPreviewBudget): NormalizedExcelWorkbookPreviewBudget => ({
  ...DEFAULT_EXCEL_WORKBOOK_PREVIEW_BUDGET,
  ...budget
})

const assertBudget = (condition: boolean, message: string): void => {
  if (!condition) throw new ExcelWorkbookPreviewBudgetExceededError(message)
}

const registerPayloadBytes = (context: WorkbookBuildContext, bytes: number): void => {
  context.counters.payloadBytes += bytes
  assertBudget(
    context.counters.payloadBytes <= context.budget.maxPayloadBytes,
    'Excel workbook preview payload is too large.'
  )
}

const estimateCellPayloadBytes = (cell: ICellData): number => {
  let size = 32
  if (cell.v !== undefined) size += String(cell.v).length * 2
  if (cell.f) size += cell.f.length * 2
  if (cell.s) size += String(cell.s).length
  return size
}

const dateToExcelSerial = (value: Date, date1904: boolean): number => {
  return EXCEL_UNIX_EPOCH_OFFSET_DAYS + value.getTime() / MS_PER_DAY - (date1904 ? EXCEL_1904_OFFSET_DAYS : 0)
}

const toBooleanNumber = (value: boolean | undefined) => (value ? BooleanNumber.TRUE : BooleanNumber.FALSE)

const toWorkbookName = (fileName?: string): string => {
  if (!fileName) return 'Workbook'
  return fileName.replace(/\.(xlsx|xlsm)$/i, '') || fileName
}

const normalizeFormula = (formula: string | undefined): string | undefined => {
  if (!formula) return undefined
  return formula.startsWith('=') ? formula : `=${formula}`
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isErrorValue = (value: ExcelJS.CellValue): value is ExcelJS.CellErrorValue => {
  return isObject(value) && typeof value.error === 'string'
}

const isRichTextValue = (value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue => {
  return isObject(value) && Array.isArray(value.richText)
}

const isHyperlinkValue = (value: ExcelJS.CellValue): value is ExcelJS.CellHyperlinkValue => {
  return isObject(value) && typeof value.hyperlink === 'string'
}

const isFormulaValue = (
  value: ExcelJS.CellValue
): value is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue => {
  return isObject(value) && ('formula' in value || 'sharedFormula' in value)
}

const toCellScalar = (value: ExcelJS.CellValue, date1904: boolean): Pick<ICellData, 't' | 'v'> => {
  if (value === null || value === undefined) return {}

  if (typeof value === 'number') {
    return Number.isFinite(value) ? { t: CellValueType.NUMBER, v: value } : {}
  }

  if (typeof value === 'boolean') {
    return { t: CellValueType.BOOLEAN, v: value }
  }

  if (typeof value === 'string') {
    return { t: CellValueType.STRING, v: value }
  }

  if (value instanceof Date) {
    return { t: CellValueType.NUMBER, v: dateToExcelSerial(value, date1904) }
  }

  if (isErrorValue(value)) {
    return { t: CellValueType.STRING, v: value.error }
  }

  if (isRichTextValue(value)) {
    return { t: CellValueType.STRING, v: value.richText.map((part) => part.text).join('') }
  }

  if (isHyperlinkValue(value)) {
    return { t: CellValueType.STRING, v: value.text || value.hyperlink }
  }

  return {}
}

const toFormulaCell = (
  cell: ExcelJS.Cell,
  value: ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue,
  date1904: boolean
) => {
  const formula = normalizeFormula(value.formula ?? cell.formula)
  const scalar = toCellScalar(value.result, date1904)

  return {
    ...scalar,
    ...(formula ? { f: formula } : {})
  }
}

const colorToRgb = (color: Partial<ExcelJS.Color> | undefined): string | undefined => {
  const raw = color?.argb?.replace(/^#/, '')
  if (!raw) return undefined

  const rgb = raw.length === 8 ? raw.slice(2) : raw.length === 6 ? raw : undefined
  return rgb ? `#${rgb.toUpperCase()}` : undefined
}

const toColorStyle = (color: Partial<ExcelJS.Color> | undefined): NonNullable<IStyleData['cl']> | undefined => {
  const rgb = colorToRgb(color)
  return rgb ? { rgb } : undefined
}

const toTextDecoration = (enabled: boolean | undefined): NonNullable<IStyleData['ul']> | undefined => {
  return enabled ? { s: BooleanNumber.TRUE } : undefined
}

const toBorderStyle = (style: ExcelJS.BorderStyle | undefined): BorderStyleTypes | undefined => {
  switch (style) {
    case 'dashDot':
      return BorderStyleTypes.DASH_DOT
    case 'dashDotDot':
      return BorderStyleTypes.DASH_DOT_DOT
    case 'dashed':
      return BorderStyleTypes.DASHED
    case 'dotted':
      return BorderStyleTypes.DOTTED
    case 'double':
      return BorderStyleTypes.DOUBLE
    case 'hair':
      return BorderStyleTypes.HAIR
    case 'medium':
      return BorderStyleTypes.MEDIUM
    case 'mediumDashDot':
      return BorderStyleTypes.MEDIUM_DASH_DOT
    case 'mediumDashDotDot':
      return BorderStyleTypes.MEDIUM_DASH_DOT_DOT
    case 'mediumDashed':
      return BorderStyleTypes.MEDIUM_DASHED
    case 'slantDashDot':
      return BorderStyleTypes.SLANT_DASH_DOT
    case 'thick':
      return BorderStyleTypes.THICK
    case 'thin':
      return BorderStyleTypes.THIN
    default:
      return undefined
  }
}

const toBorderSide = (border: Partial<ExcelJS.Border> | undefined): IBorderStyleData | undefined => {
  const style = toBorderStyle(border?.style)
  if (style === undefined) return undefined

  return {
    s: style,
    cl: toColorStyle(border?.color) ?? { rgb: '#000000' }
  }
}

const toBorderData = (border: Partial<ExcelJS.Borders> | undefined): IStyleData['bd'] | undefined => {
  const top = toBorderSide(border?.top)
  const right = toBorderSide(border?.right)
  const bottom = toBorderSide(border?.bottom)
  const left = toBorderSide(border?.left)

  if (!top && !right && !bottom && !left) return undefined

  return {
    ...(top ? { t: top } : {}),
    ...(right ? { r: right } : {}),
    ...(bottom ? { b: bottom } : {}),
    ...(left ? { l: left } : {})
  }
}

const toHorizontalAlign = (alignment: Partial<ExcelJS.Alignment> | undefined): HorizontalAlign | undefined => {
  switch (alignment?.horizontal) {
    case 'center':
    case 'centerContinuous':
      return HorizontalAlign.CENTER
    case 'distributed':
      return HorizontalAlign.DISTRIBUTED
    case 'justify':
      return HorizontalAlign.JUSTIFIED
    case 'left':
      return HorizontalAlign.LEFT
    case 'right':
      return HorizontalAlign.RIGHT
    default:
      return undefined
  }
}

const toVerticalAlign = (alignment: Partial<ExcelJS.Alignment> | undefined): VerticalAlign | undefined => {
  switch (alignment?.vertical) {
    case 'bottom':
      return VerticalAlign.BOTTOM
    case 'middle':
      return VerticalAlign.MIDDLE
    case 'top':
      return VerticalAlign.TOP
    default:
      return undefined
  }
}

const toFillColor = (fill: ExcelJS.Fill | undefined): NonNullable<IStyleData['bg']> | undefined => {
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return undefined
  return toColorStyle(fill.fgColor) ?? toColorStyle(fill.bgColor)
}

const toCellStyle = (cell: ExcelJS.Cell): IStyleData | null => {
  const font = cell.font
  const alignment = cell.alignment
  const style: IStyleData = {
    ...(font?.name ? { ff: font.name } : {}),
    ...(typeof font?.size === 'number' ? { fs: font.size } : {}),
    ...(font?.bold ? { bl: BooleanNumber.TRUE } : {}),
    ...(font?.italic ? { it: BooleanNumber.TRUE } : {}),
    ...(font?.strike ? { st: { s: BooleanNumber.TRUE } } : {}),
    ...(font?.underline && font.underline !== 'none' ? { ul: toTextDecoration(true) } : {}),
    ...(toColorStyle(font?.color) ? { cl: toColorStyle(font?.color) } : {}),
    ...(toFillColor(cell.fill) ? { bg: toFillColor(cell.fill) } : {}),
    ...(toBorderData(cell.border) ? { bd: toBorderData(cell.border) } : {}),
    ...(toHorizontalAlign(alignment) ? { ht: toHorizontalAlign(alignment) } : {}),
    ...(toVerticalAlign(alignment) ? { vt: toVerticalAlign(alignment) } : {}),
    ...(alignment?.wrapText ? { tb: WrapStrategy.WRAP } : {}),
    ...(cell.numFmt ? { n: { pattern: cell.numFmt } } : {})
  }

  return Object.keys(style).length ? style : null
}

const getStyleId = (cell: ExcelJS.Cell, context: WorkbookBuildContext): string | undefined => {
  const style = toCellStyle(cell)
  if (!style) return undefined

  const key = JSON.stringify(style)
  const existing = context.styleIdsByKey.get(key)
  if (existing) return existing

  const id = `style-${context.styleIdsByKey.size + 1}`
  context.styleIdsByKey.set(key, id)
  context.styles[id] = style
  context.counters.styles += 1
  assertBudget(context.counters.styles <= context.budget.maxStyles, 'Excel workbook has too many unique styles.')
  registerPayloadBytes(context, JSON.stringify(style).length + id.length + 16)
  return id
}

const toUniverCell = (cell: ExcelJS.Cell, context: WorkbookBuildContext): ICellData | null => {
  const value = cell.value
  const scalar = isFormulaValue(value)
    ? toFormulaCell(cell, value, context.date1904)
    : toCellScalar(value, context.date1904)
  const styleId = getStyleId(cell, context)
  const univerCell: ICellData = {
    ...scalar,
    ...(styleId ? { s: styleId } : {})
  }

  return univerCell.v === undefined && !univerCell.f && !univerCell.s ? null : univerCell
}

const toRowData = (worksheet: ExcelJS.Worksheet): RowData => {
  const rowData: RowData = {}

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    if (!row.height && !row.hidden) continue

    rowData[rowNumber - 1] = {
      ...(row.height ? { h: Math.round((row.height * 96) / 72) } : {}),
      ...(row.hidden ? { hd: BooleanNumber.TRUE } : {})
    }
  }

  return rowData
}

const toColumnData = (worksheet: ExcelJS.Worksheet, columnCount: number): ColumnData => {
  const columnData: ColumnData = {}

  for (let index = 1; index <= columnCount; index += 1) {
    const column = worksheet.getColumn(index)
    const width = column.width ? Math.round(column.width * 8) : undefined
    if (!width && !column.hidden) continue

    columnData[index - 1] = {
      ...(width ? { w: width } : {}),
      ...(column.hidden ? { hd: BooleanNumber.TRUE } : {})
    }
  }

  return columnData
}

const decodeColumn = (letters: string): number | null => {
  let column = 0
  for (const char of letters.toUpperCase()) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) return null
    column = column * 26 + code - 64
  }
  return column - 1
}

const decodeCellAddress = (address: string): { column: number; row: number } | null => {
  const match = /^([A-Z]+)(\d+)$/i.exec(address.replace(/\$/g, ''))
  if (!match) return null

  const column = decodeColumn(match[1])
  const row = Number(match[2])
  if (column === null || !Number.isInteger(row) || row < 1) return null

  return { column, row: row - 1 }
}

const decodeMergeRange = (range: string): MergeRange | null => {
  const [startRaw, endRaw = startRaw] = range.split(':')
  const start = decodeCellAddress(startRaw)
  const end = decodeCellAddress(endRaw)
  if (!start || !end) return null

  return {
    startRow: Math.min(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endRow: Math.max(start.row, end.row),
    endColumn: Math.max(start.column, end.column)
  }
}

const toMergeData = (worksheet: ExcelJS.Worksheet): MergeRange[] => {
  return (worksheet.model.merges ?? []).flatMap((range) => {
    const merge = decodeMergeRange(range)
    return merge ? [merge] : []
  })
}

const toWorksheetData = (
  worksheet: ExcelJS.Worksheet,
  sheetId: string,
  context: WorkbookBuildContext
): Partial<IWorksheetData> => {
  const cellData: CellMatrix = {}
  const rowCount = Math.max(worksheet.rowCount, worksheet.actualRowCount, DEFAULT_ROW_COUNT)
  const columnCount = Math.max(
    worksheet.columnCount,
    worksheet.actualColumnCount,
    worksheet.columns?.length ?? 0,
    DEFAULT_COLUMN_COUNT
  )
  assertBudget(rowCount <= context.budget.maxRowsPerSheet, `Worksheet "${worksheet.name}" has too many rows.`)
  assertBudget(columnCount <= context.budget.maxColumnsPerSheet, `Worksheet "${worksheet.name}" has too many columns.`)

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const univerCell = toUniverCell(cell, context)
      if (!univerCell) return

      context.counters.cells += 1
      assertBudget(context.counters.cells <= context.budget.maxCells, 'Excel workbook has too many cells to preview.')
      registerPayloadBytes(context, estimateCellPayloadBytes(univerCell))

      cellData[rowNumber - 1] ??= {}
      cellData[rowNumber - 1][columnNumber - 1] = univerCell
    })
  })

  const mergeData = toMergeData(worksheet)
  context.counters.merges += mergeData.length
  assertBudget(context.counters.merges <= context.budget.maxMerges, 'Excel workbook has too many merged ranges.')
  registerPayloadBytes(context, mergeData.length * 48)

  return {
    id: sheetId,
    name: worksheet.name,
    tabColor: '',
    hidden: toBooleanNumber(worksheet.state !== 'visible'),
    freeze: {
      startRow: -1,
      startColumn: -1,
      ySplit: 0,
      xSplit: 0
    },
    rowCount,
    columnCount,
    zoomRatio: 1,
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    mergeData,
    cellData,
    rowData: toRowData(worksheet),
    columnData: toColumnData(worksheet, columnCount),
    rowHeader: { width: DEFAULT_ROW_HEADER_WIDTH, hidden: BooleanNumber.FALSE },
    columnHeader: { height: DEFAULT_COLUMN_HEADER_HEIGHT, hidden: BooleanNumber.FALSE },
    showGridlines: BooleanNumber.TRUE,
    rightToLeft: BooleanNumber.FALSE
  }
}

const collectImportDiagnostics = (workbook: ExcelJS.Workbook): ExcelImportDiagnostic[] => {
  const imageCount = workbook.worksheets.reduce((count, worksheet) => count + worksheet.getImages().length, 0)

  if (!imageCount) return []

  return [
    {
      code: 'unsupported_excel_images',
      count: imageCount,
      message: 'Images are not rendered in Excel preview yet.',
      severity: 'warning'
    }
  ]
}

export function excelJsWorkbookToUniverWorkbook(
  workbook: ExcelJS.Workbook,
  fileName?: string,
  budget?: ExcelWorkbookPreviewBudget
): IWorkbookData {
  const context: WorkbookBuildContext = {
    budget: normalizeBudget(budget),
    counters: {
      cells: 0,
      merges: 0,
      payloadBytes: 0,
      styles: 0
    },
    date1904: workbook.properties.date1904 === true,
    styles: {},
    styleIdsByKey: new Map()
  }
  const sheets: IWorkbookData['sheets'] = {}
  const sheetOrder: string[] = []

  assertBudget(workbook.worksheets.length <= context.budget.maxSheets, 'Excel workbook has too many sheets to preview.')

  workbook.worksheets.forEach((worksheet, index) => {
    const sheetId = `sheet-${index + 1}`
    sheets[sheetId] = toWorksheetData(worksheet, sheetId, context)
    sheetOrder.push(sheetId)
  })

  return {
    id: 'excel-preview-workbook',
    name: toWorkbookName(fileName),
    appVersion: UNIVER_MODEL_VERSION,
    locale: LocaleType.EN_US,
    styles: context.styles,
    sheetOrder,
    sheets
  }
}

export function excelJsWorkbookToPreviewData(
  workbook: ExcelJS.Workbook,
  fileName: string,
  budget?: ExcelWorkbookPreviewBudget
): ExcelWorkbookPreviewData {
  return {
    diagnostics: collectImportDiagnostics(workbook),
    fileName,
    workbookData: excelJsWorkbookToUniverWorkbook(workbook, fileName, budget)
  }
}

export const isUniverWorkbookEmpty = (workbook: IWorkbookData): boolean => workbook.sheetOrder.length === 0
