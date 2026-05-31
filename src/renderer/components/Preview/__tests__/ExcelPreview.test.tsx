import { act, render, screen, waitFor } from '@testing-library/react'
import type { IWorkbookData } from '@univerjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ExcelPreview from '../ExcelPreview'

const mocks = vi.hoisted(() => ({
  excelWorkbookView: vi.fn(),
  readWorkbookPreview: vi.fn(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ label }: { label: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ description, message, type }: { description?: string; message?: string; type?: string }) => (
    <div data-testid="excel-preview-alert" data-type={type}>
      <span>{message}</span>
      <span>{description}</span>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('@renderer/components/Excel', () => ({
  ExcelWorkbookView: (props: {
    ariaLabel?: string
    onError?: (error: Error) => void
    readOnly?: boolean
    workbookData: IWorkbookData
  }) => {
    mocks.excelWorkbookView(props)

    return <div data-testid="excel-workbook-view" data-aria-label={props.ariaLabel} />
  }
}))

const workbookData = { id: 'workbook-1', sheetOrder: ['sheet-1'] } as IWorkbookData

describe('ExcelPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readWorkbookPreview.mockResolvedValue({
      success: true,
      data: {
        diagnostics: [],
        fileName: 'report.xlsx',
        workbookData
      }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        excel: {
          readWorkbookPreview: mocks.readWorkbookPreview
        }
      }
    })
  })

  it('requests a workbook preview from main and renders the workbook view', async () => {
    render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" refreshKey={3} />)

    expect(screen.getByTestId('loading-state')).toHaveTextContent('common.loading')
    await waitFor(() => expect(screen.getByTestId('excel-workbook-view')).toBeInTheDocument())
    expect(mocks.readWorkbookPreview).toHaveBeenCalledWith({
      filePath: '/tmp/workspace/report.xlsx',
      fileName: 'report.xlsx'
    })
    expect(mocks.excelWorkbookView).toHaveBeenCalledWith(
      expect.objectContaining({
        ariaLabel: 'report.xlsx',
        readOnly: true,
        workbookData
      })
    )
  })

  it('does not send fileName when the caller does not provide one', async () => {
    render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" />)

    await waitFor(() => expect(screen.getByTestId('excel-workbook-view')).toBeInTheDocument())
    expect(mocks.readWorkbookPreview).toHaveBeenCalledWith({
      filePath: '/tmp/workspace/report.xlsx'
    })
    expect(mocks.excelWorkbookView).toHaveBeenCalledWith(
      expect.objectContaining({
        ariaLabel: '/tmp/workspace/report.xlsx'
      })
    )
  })

  it('re-requests the preview when refreshKey changes', async () => {
    const { rerender } = render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" />)

    await waitFor(() => expect(mocks.readWorkbookPreview).toHaveBeenCalledTimes(1))

    rerender(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" refreshKey={1} />)

    await waitFor(() => expect(mocks.readWorkbookPreview).toHaveBeenCalledTimes(2))
  })

  it('renders an empty state for empty converted workbooks', async () => {
    mocks.readWorkbookPreview.mockResolvedValueOnce({
      success: true,
      data: {
        diagnostics: [],
        fileName: 'empty.xlsx',
        workbookData: { id: 'empty', sheetOrder: [] } as IWorkbookData
      }
    })

    render(<ExcelPreview filePath="/tmp/workspace/empty.xlsx" fileName="empty.xlsx" />)

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.title'))
    expect(mocks.excelWorkbookView).not.toHaveBeenCalled()
  })

  it('renders an error state when main returns an error result', async () => {
    mocks.readWorkbookPreview.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'excel_parse_error',
        message: 'parse failed'
      }
    })

    render(<ExcelPreview filePath="/tmp/workspace/broken.xlsx" fileName="broken.xlsx" />)

    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.excel.errors.parse_failed')
    )
    expect(mocks.excelWorkbookView).not.toHaveBeenCalled()
  })

  it('renders import diagnostics as a preview warning', async () => {
    mocks.readWorkbookPreview.mockResolvedValueOnce({
      success: true,
      data: {
        diagnostics: [
          {
            code: 'unsupported_excel_images',
            count: 2,
            message: 'Images are not rendered in Excel preview yet.',
            severity: 'warning'
          }
        ],
        fileName: 'images.xlsx',
        workbookData
      }
    })

    render(<ExcelPreview filePath="/tmp/workspace/images.xlsx" fileName="images.xlsx" />)

    await waitFor(() => expect(screen.getByTestId('excel-preview-alert')).toBeInTheDocument())
    expect(screen.getByTestId('excel-preview-alert')).toHaveTextContent('agent.preview_pane.excel.warnings.title')
    expect(screen.getByTestId('excel-preview-alert')).toHaveTextContent(
      'agent.preview_pane.excel.warnings.unsupported_images'
    )
    expect(screen.getByTestId('excel-workbook-view')).toBeInTheDocument()
  })

  it('renders an error state when the workbook view reports an initialization failure', async () => {
    render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" />)

    await waitFor(() => expect(mocks.excelWorkbookView).toHaveBeenCalled())
    const latestProps = mocks.excelWorkbookView.mock.calls.at(-1)?.[0]
    expect(latestProps?.onError).toEqual(expect.any(Function))

    act(() => {
      latestProps?.onError?.(new Error('create failed'))
    })

    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.excel.errors.parse_failed')
  })
})
