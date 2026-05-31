import type { IWorkbookData } from '@univerjs/core'

export interface ExcelWorkbookViewProps {
  ariaLabel?: string
  className?: string
  onError?: (error: Error) => void
  readOnly?: boolean
  workbookData: IWorkbookData
}
