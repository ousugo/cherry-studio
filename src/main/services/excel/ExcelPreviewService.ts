import { promises as fs } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { AbsolutePathSchema } from '@shared/data/types/file'
import type {
  ExcelImportDiagnosticCode,
  ExcelWorkbookPreviewRequest,
  ExcelWorkbookPreviewResult
} from '@shared/excelPreview'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import type { ExcelWorkbookPreviewBudget } from './excelToUniverWorkbook'

export const EXCEL_PREVIEW_MAX_SIZE_BYTES = 25 * 1024 * 1024

const SUPPORTED_EXCEL_PREVIEW_EXTENSIONS = new Set(['.xlsx', '.xlsm'])

const ExcelWorkbookPreviewRequestSchema = z.strictObject({
  filePath: AbsolutePathSchema,
  fileName: z.string().min(1).optional()
})

const logger = loggerService.withContext('ExcelPreviewService')

const fail = (code: ExcelImportDiagnosticCode, message: string): ExcelWorkbookPreviewResult => ({
  success: false,
  error: { code, message },
  diagnostics: [{ code, message, severity: 'error' }]
})

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))

const normalizeFileName = (request: ExcelWorkbookPreviewRequest) => {
  return request.fileName || path.basename(request.filePath)
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

    const [{ default: ExcelJS }, { excelJsWorkbookToPreviewData }] = await Promise.all([
      import('exceljs'),
      import('./excelToUniverWorkbook')
    ])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(normalizedRequest.filePath)

    return {
      success: true,
      data: excelJsWorkbookToPreviewData(
        workbook,
        normalizeFileName(normalizedRequest),
        options.budget ?? EXCEL_PREVIEW_COMPLEXITY_BUDGET
      )
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
