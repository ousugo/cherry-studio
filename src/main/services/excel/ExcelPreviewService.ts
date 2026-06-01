import { promises as fs } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { AbsolutePathSchema } from '@shared/data/types/file'
import type {
  ExcelImportDiagnostic,
  ExcelImportDiagnosticCode,
  ExcelWorkbookPreviewRequest,
  ExcelWorkbookPreviewResult
} from '@shared/excelPreview'
import { IpcChannel } from '@shared/IpcChannel'
import { XMLParser } from 'fast-xml-parser'
import StreamZip from 'node-stream-zip'
import * as z from 'zod'

import type {
  ExcelStreamSheetMetadata,
  ExcelStreamSheetMetadataIndex,
  ExcelWorkbookPreviewBudget,
  ExcelWorksheetColumnData,
  ExcelWorksheetMergeData
} from './excelToUniverWorkbook'

export const EXCEL_PREVIEW_MAX_SIZE_BYTES = 25 * 1024 * 1024

const SUPPORTED_EXCEL_PREVIEW_EXTENSIONS = new Set(['.xlsx', '.xlsm'])

const ExcelWorkbookPreviewRequestSchema = z.strictObject({
  filePath: AbsolutePathSchema,
  fileName: z.string().min(1).optional()
})

const logger = loggerService.withContext('ExcelPreviewService')
const XLSX_CHART_ENTRY_PATTERN = /^xl\/charts\/[^/]+[.]xml$/i
const excelArchiveXmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseAttributeValue: false,
  removeNSPrefix: true
})

interface ParsedWorkbookSheet {
  id?: string
  name?: string
  sheetId?: string
  state?: string
}

interface ParsedWorkbookXml {
  workbook?: {
    sheets?: {
      sheet?: ParsedWorkbookSheet | ParsedWorkbookSheet[]
    }
  }
}

interface ParsedWorkbookRelationship {
  Id?: string
  Target?: string
  Type?: string
}

interface ParsedWorkbookRelationshipsXml {
  Relationships?: {
    Relationship?: ParsedWorkbookRelationship | ParsedWorkbookRelationship[]
  }
}

interface ParsedWorksheetMergeCell {
  ref?: string
}

interface ParsedWorksheetColumn {
  hidden?: boolean | number | string
  max?: number | string
  min?: number | string
  width?: number | string
}

interface ParsedWorksheetXml {
  worksheet?: {
    cols?: {
      col?: ParsedWorksheetColumn | ParsedWorksheetColumn[]
    }
    mergeCells?: {
      mergeCell?: ParsedWorksheetMergeCell | ParsedWorksheetMergeCell[]
    }
  }
}

interface ExcelArchiveWorksheetMetadata {
  columnData: ExcelWorksheetColumnData
  mergeData: ExcelWorksheetMergeData
}

interface ExcelArchiveMetadata {
  diagnostics: ExcelImportDiagnostic[]
  sheetMetadataIndex: ExcelStreamSheetMetadataIndex
}

const fail = (code: ExcelImportDiagnosticCode, message: string): ExcelWorkbookPreviewResult => ({
  success: false,
  error: { code, message },
  diagnostics: [{ code, message, severity: 'error' }]
})

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))

const normalizeFileName = (request: ExcelWorkbookPreviewRequest) => {
  return request.fileName || path.basename(request.filePath)
}

const isUnsupportedExcelDrawingError = (error: Error): boolean => {
  return error.message.includes("reading 'anchors'") || error.message.includes('reading "anchors"')
}

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

const readArchiveEntryText = async (zip: StreamZip.StreamZipAsync, entryName: string): Promise<string | undefined> => {
  try {
    const entry = await zip.entry(entryName)
    if (!entry) return undefined

    return (await zip.entryData(entry)).toString('utf8')
  } catch (err) {
    logger.warn(`Failed to read Excel archive entry: ${entryName}`, toError(err))
    return undefined
  }
}

const getWorksheetFileNumberFromRelationshipTarget = (target: string | undefined): string | undefined => {
  if (!target) return undefined

  const normalizedTarget = target.startsWith('/')
    ? target.slice(1)
    : path.posix.normalize(path.posix.join('xl', target.replace(/\\/g, '/')))
  const match = /^xl\/worksheets\/sheet(\d+)[.]xml$/i.exec(normalizedTarget)
  return match?.[1]
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

const decodeMergeRange = (range: string): ExcelWorksheetMergeData[number] | null => {
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

const parseExcelBooleanAttribute = (value: boolean | number | string | undefined): boolean => {
  return value === true || value === 1 || value === '1' || value === 'true'
}

const parseExcelNumberAttribute = (value: number | string | undefined): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseExcelIntegerAttribute = (value: number | string | undefined): number | undefined => {
  const parsed = parseExcelNumberAttribute(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

const parseWorksheetColumnData = (worksheet: ParsedWorksheetXml): ExcelWorksheetColumnData => {
  const columnData: ExcelWorksheetColumnData = {}
  const columnDefinitions = asArray(worksheet.worksheet?.cols?.col)

  columnDefinitions.forEach((columnDefinition) => {
    const min = parseExcelIntegerAttribute(columnDefinition.min)
    const max = parseExcelIntegerAttribute(columnDefinition.max)
    if (!min || !max || min < 1 || max < min) return

    const width = parseExcelNumberAttribute(columnDefinition.width)
    const hidden = parseExcelBooleanAttribute(columnDefinition.hidden)
    if (!width && !hidden) return

    for (let column = min; column <= max; column += 1) {
      columnData[column - 1] = {
        ...(width ? { w: Math.round(width * 8) } : {}),
        ...(hidden ? { hd: 1 } : {})
      }
    }
  })

  return columnData
}

const parseWorksheetMergeData = (worksheet: ParsedWorksheetXml): ExcelWorksheetMergeData => {
  const mergeCells = asArray(worksheet.worksheet?.mergeCells?.mergeCell)

  return mergeCells.flatMap((mergeCell) => {
    const merge = decodeMergeRange(mergeCell.ref ?? '')
    return merge ? [merge] : []
  })
}

const collectArchiveWorksheetMetadata = async (
  zip: StreamZip.StreamZipAsync,
  fileNumber: string
): Promise<ExcelArchiveWorksheetMetadata> => {
  const worksheetXml = await readArchiveEntryText(zip, `xl/worksheets/sheet${fileNumber}.xml`)
  if (!worksheetXml) return { columnData: {}, mergeData: [] }

  const worksheet = excelArchiveXmlParser.parse(worksheetXml) as ParsedWorksheetXml

  return {
    columnData: parseWorksheetColumnData(worksheet),
    mergeData: parseWorksheetMergeData(worksheet)
  }
}

const collectArchiveSheetMetadata = async (zip: StreamZip.StreamZipAsync): Promise<ExcelStreamSheetMetadataIndex> => {
  const [workbookXml, workbookRelsXml] = await Promise.all([
    readArchiveEntryText(zip, 'xl/workbook.xml'),
    readArchiveEntryText(zip, 'xl/_rels/workbook.xml.rels')
  ])
  const sheetMetadataIndex: ExcelStreamSheetMetadataIndex = {
    byFileNumber: {},
    bySheetId: {}
  }
  if (!workbookXml) return sheetMetadataIndex

  const workbook = excelArchiveXmlParser.parse(workbookXml) as ParsedWorkbookXml
  const sheets = asArray(workbook.workbook?.sheets?.sheet)
  if (!sheets.length) return sheetMetadataIndex

  const relationships = workbookRelsXml
    ? asArray(
        (excelArchiveXmlParser.parse(workbookRelsXml) as ParsedWorkbookRelationshipsXml).Relationships?.Relationship
      )
    : []
  const relationshipsById = new Map(relationships.map((relationship) => [relationship.Id, relationship]))

  for (const [index, sheet] of sheets.entries()) {
    if (!sheet.name) continue

    const relationship = sheet.id ? relationshipsById.get(sheet.id) : undefined
    const fileNumber = getWorksheetFileNumberFromRelationshipTarget(relationship?.Target) ?? String(index + 1)
    const worksheetMetadata = await collectArchiveWorksheetMetadata(zip, fileNumber)
    const metadata: ExcelStreamSheetMetadata = {
      ...(Object.keys(worksheetMetadata.columnData).length ? { columnData: worksheetMetadata.columnData } : {}),
      ...(worksheetMetadata.mergeData.length ? { mergeData: worksheetMetadata.mergeData } : {}),
      name: sheet.name,
      ...(sheet.state ? { state: sheet.state } : {})
    }
    sheetMetadataIndex.byFileNumber[fileNumber] = metadata
    if (sheet.sheetId) {
      sheetMetadataIndex.bySheetId[sheet.sheetId] = metadata
    }
  }

  return sheetMetadataIndex
}

const collectArchiveMetadata = async (filePath: string): Promise<ExcelArchiveMetadata> => {
  const zip = new StreamZip.async({ file: filePath })

  try {
    const entries = await zip.entries()
    const entryNames = Object.keys(entries)
    const chartCount = entryNames.filter((entryName) => XLSX_CHART_ENTRY_PATTERN.test(entryName)).length

    return {
      diagnostics: [
        ...(chartCount
          ? [
              {
                code: 'unsupported_excel_charts' as const,
                count: chartCount,
                message: 'Charts are not rendered in Excel preview yet.',
                severity: 'warning' as const
              }
            ]
          : [])
      ],
      sheetMetadataIndex: await collectArchiveSheetMetadata(zip)
    }
  } finally {
    await zip.close()
  }
}

const getArchiveMetadata = async (filePath: string): Promise<ExcelArchiveMetadata> => {
  try {
    return await collectArchiveMetadata(filePath)
  } catch (err) {
    logger.warn(`Failed to inspect Excel archive metadata: ${filePath}`, toError(err))
    return { diagnostics: [], sheetMetadataIndex: { byFileNumber: {}, bySheetId: {} } }
  }
}

export const EXCEL_PREVIEW_COMPLEXITY_BUDGET = {
  maxCells: 200_000,
  maxColumnsPerSheet: 5_000,
  maxMerges: 10_000,
  maxPayloadBytes: 20 * 1024 * 1024,
  maxRowsPerSheet: 100_000,
  maxSheets: 50,
  maxStyles: 50_000
}

export interface ReadExcelWorkbookPreviewOptions {
  budget?: ExcelWorkbookPreviewBudget
}

export async function readExcelWorkbookPreview(
  request: ExcelWorkbookPreviewRequest,
  options: ReadExcelWorkbookPreviewOptions = {}
): Promise<ExcelWorkbookPreviewResult> {
  const parsed = ExcelWorkbookPreviewRequestSchema.safeParse(request)
  if (!parsed.success) {
    return fail('invalid_excel_preview_request', 'Invalid Excel preview request.')
  }

  const normalizedRequest = parsed.data
  const extension = path.extname(normalizedRequest.filePath).toLowerCase()

  if (extension === '.xls') {
    return fail('unsupported_xls_format', 'Legacy .xls files are not supported by Excel preview.')
  }

  if (!SUPPORTED_EXCEL_PREVIEW_EXTENSIONS.has(extension)) {
    return fail('unsupported_excel_extension', 'Only .xlsx and .xlsm files can be previewed.')
  }

  try {
    const stats = await fs.stat(normalizedRequest.filePath)
    if (stats.size > EXCEL_PREVIEW_MAX_SIZE_BYTES) {
      return fail('excel_file_too_large', 'Excel preview supports files up to 25 MB.')
    }

    const archiveMetadata = await getArchiveMetadata(normalizedRequest.filePath)
    const [
      { default: ExcelJS },
      { excelJsStreamingWorkbookToPreviewData, excelJsWorkbookToPreviewData, mergeExcelImportDiagnostics }
    ] = await Promise.all([import('exceljs'), import('./excelToUniverWorkbook')])
    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.readFile(normalizedRequest.filePath)
    } catch (err) {
      const error = toError(err)
      const hasUnsupportedCharts = archiveMetadata.diagnostics.some(
        (diagnostic) => diagnostic.code === 'unsupported_excel_charts'
      )
      if (!hasUnsupportedCharts || !isUnsupportedExcelDrawingError(error)) {
        throw error
      }

      logger.warn(
        `Excel workbook contains unsupported chart drawings; using cell-only preview: ${normalizedRequest.filePath}`
      )
      return {
        success: true,
        data: await excelJsStreamingWorkbookToPreviewData(
          normalizedRequest.filePath,
          normalizeFileName(normalizedRequest),
          options.budget ?? EXCEL_PREVIEW_COMPLEXITY_BUDGET,
          archiveMetadata.diagnostics,
          archiveMetadata.sheetMetadataIndex
        )
      }
    }

    const data = excelJsWorkbookToPreviewData(
      workbook,
      normalizeFileName(normalizedRequest),
      options.budget ?? EXCEL_PREVIEW_COMPLEXITY_BUDGET
    )
    data.diagnostics = mergeExcelImportDiagnostics(data.diagnostics, archiveMetadata.diagnostics)

    return {
      success: true,
      data
    }
  } catch (err) {
    const error = toError(err)
    logger.error(`Failed to read Excel workbook preview: ${normalizedRequest.filePath}`, error)
    if (error.name === 'ExcelWorkbookPreviewBudgetExceededError') {
      return fail('excel_preview_too_complex', 'Excel workbook is too complex to preview.')
    }
    return fail('excel_parse_error', 'Failed to read Excel workbook preview.')
  }
}

@Injectable('ExcelPreviewService')
@ServicePhase(Phase.WhenReady)
export class ExcelPreviewService extends BaseService {
  protected override onInit(): void {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Excel_ReadWorkbookPreview, async (_event, params: unknown) => {
      const parsed = ExcelWorkbookPreviewRequestSchema.safeParse(params)
      if (!parsed.success) {
        return fail('invalid_excel_preview_request', 'Invalid Excel preview request.')
      }

      return readExcelWorkbookPreview(parsed.data)
    })
  }
}
