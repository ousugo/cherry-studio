import type { IWorkbookData } from '@univerjs/core'

export type ExcelImportDiagnosticCode =
  | 'invalid_excel_preview_request'
  | 'unsupported_excel_extension'
  | 'unsupported_xls_format'
  | 'excel_file_too_large'
  | 'excel_preview_too_complex'
  | 'unsupported_excel_images'
  | 'excel_parse_error'

export type ExcelImportDiagnosticSeverity = 'warning' | 'error'

export interface ExcelImportDiagnostic {
  code: ExcelImportDiagnosticCode
  count?: number
  message?: string
  severity: ExcelImportDiagnosticSeverity
}

export interface ExcelWorkbookPreviewRequest {
  fileName?: string
  filePath: string
}

export interface ExcelWorkbookPreviewData {
  diagnostics: ExcelImportDiagnostic[]
  fileName: string
  workbookData: IWorkbookData
}

export type ExcelWorkbookPreviewResult =
  | {
      data: ExcelWorkbookPreviewData
      success: true
    }
  | {
      diagnostics?: ExcelImportDiagnostic[]
      error: {
        code: ExcelImportDiagnosticCode
        message: string
      }
      success: false
    }
