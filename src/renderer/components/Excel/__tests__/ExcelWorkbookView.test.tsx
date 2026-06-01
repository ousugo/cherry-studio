import { render, waitFor } from '@testing-library/react'
import { type IWorkbookData, LocaleType } from '@univerjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ExcelWorkbookView from '../ExcelWorkbookView'

const mocks = vi.hoisted(() => ({
  beforeCommandListener: undefined as
    | ((commandInfo: { id: string; type?: number }, options?: { fromChangeset?: boolean; onlyLocal?: boolean }) => void)
    | undefined,
  commandGuardDispose: vi.fn(),
  configSet: vi.fn(),
  createWorkbook: vi.fn(),
  mergeLocales: vi.fn((locale: unknown) => locale),
  onBeforeCommandExecute: vi.fn(),
  presetConfig: undefined as
    | {
        footer?: { addSheetButtonConfig?: { show?: boolean } }
        sheets?: { disableForceStringAlert?: boolean; disableForceStringMark?: boolean }
      }
    | undefined,
  registerPlugins: vi.fn(),
  univerInstances: [] as Array<{
    __getInjector: () => { get: ReturnType<typeof vi.fn> }
    dispose: ReturnType<typeof vi.fn>
    registerPlugins: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('@univerjs/core', () => ({
  BooleanNumber: { FALSE: 0, TRUE: 1 },
  CanceledError: class CanceledError extends Error {},
  CellValueType: { STRING: 1, NUMBER: 2, BOOLEAN: 3 },
  CommandType: { COMMAND: 0, MUTATION: 2, OPERATION: 1 },
  IConfigService: Symbol('IConfigService'),
  LocaleType: { EN_US: 'enUS' },
  mergeLocales: mocks.mergeLocales,
  Univer: vi.fn(function Univer() {
    const instance = {
      __getInjector: () => ({
        get: vi.fn(() => ({
          setConfig: mocks.configSet
        }))
      }),
      dispose: vi.fn(),
      registerPlugins: mocks.registerPlugins
    }
    mocks.univerInstances.push(instance)
    return instance
  })
}))

vi.mock('@univerjs/core/facade', () => ({
  FUniver: {
    newAPI: () => ({
      createWorkbook: mocks.createWorkbook,
      onBeforeCommandExecute: mocks.onBeforeCommandExecute
    })
  }
}))

vi.mock('@univerjs/preset-sheets-core', () => ({
  UniverSheetsCorePreset: (config: {
    footer?: { addSheetButtonConfig?: { show?: boolean } }
    sheets?: { disableForceStringAlert?: boolean; disableForceStringMark?: boolean }
  }) => {
    mocks.presetConfig = config
    return {
      plugins: [class MockPlugin {}, [class ConfiguredMockPlugin {}, { enabled: true }]]
    }
  }
}))

vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({
  default: {}
}))

const makeWorkbookData = (id: string): IWorkbookData => ({
  id,
  name: `${id}.xlsx`,
  appVersion: '0.25.0',
  locale: LocaleType.EN_US,
  sheetOrder: ['sheet-1'],
  sheets: {
    'sheet-1': {
      cellData: {},
      id: 'sheet-1',
      name: 'Sheet1'
    }
  },
  styles: {}
})

describe('ExcelWorkbookView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.beforeCommandListener = undefined
    mocks.presetConfig = undefined
    mocks.onBeforeCommandExecute.mockImplementation(
      (
        listener: (
          commandInfo: { id: string; type?: number },
          options?: { fromChangeset?: boolean; onlyLocal?: boolean }
        ) => void
      ) => {
        mocks.beforeCommandListener = listener
        return { dispose: mocks.commandGuardDispose }
      }
    )
    mocks.univerInstances.length = 0
  })

  it('creates a Univer workbook and disposes stale instances on workbook changes and unmount', async () => {
    const workbookData = makeWorkbookData('report')
    const nextWorkbookData = makeWorkbookData('report-refresh')
    const { rerender, unmount } = render(
      <ExcelWorkbookView workbookData={workbookData} ariaLabel="report.xlsx" readOnly />
    )

    await waitFor(() => expect(mocks.createWorkbook).toHaveBeenCalledTimes(1))
    expect(mocks.createWorkbook).toHaveBeenCalledWith(workbookData)
    expect(mocks.univerInstances).toHaveLength(1)
    expect(mocks.registerPlugins).toHaveBeenCalledWith([
      [expect.any(Function)],
      [expect.any(Function), { enabled: true }]
    ])
    expect(mocks.presetConfig?.footer?.addSheetButtonConfig?.show).toBe(false)
    expect(mocks.presetConfig?.sheets).toEqual({
      disableForceStringAlert: true,
      disableForceStringMark: true
    })
    expect(mocks.configSet).toHaveBeenCalledWith(
      'sheets-ui.config',
      {
        disableEdit: true,
        clipboardConfig: {
          hidePasteOptions: true
        },
        footer: {
          addSheetButtonConfig: {
            show: false
          }
        }
      },
      { merge: true }
    )
    expect(mocks.onBeforeCommandExecute).toHaveBeenCalledTimes(1)
    expect(mocks.createWorkbook.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onBeforeCommandExecute.mock.invocationCallOrder[0]
    )
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.select-range', type: 0 })).not.toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.command.insert-sheet', type: 0 })).toThrow()
    expect(() => mocks.beforeCommandListener?.({ id: 'sheet.mutation.set-range-values', type: 2 })).toThrow()
    expect(() =>
      mocks.beforeCommandListener?.(
        { id: 'formula.mutation.set-formula-calculation-result', type: 2 },
        { onlyLocal: true }
      )
    ).not.toThrow()
    expect(() =>
      mocks.beforeCommandListener?.({ id: 'sheet.mutation.set-range-values', type: 2 }, { fromChangeset: true })
    ).not.toThrow()

    rerender(<ExcelWorkbookView workbookData={nextWorkbookData} ariaLabel="report.xlsx" readOnly />)

    await waitFor(() => expect(mocks.createWorkbook).toHaveBeenCalledTimes(2))
    expect(mocks.createWorkbook).toHaveBeenLastCalledWith(nextWorkbookData)
    expect(mocks.univerInstances).toHaveLength(2)
    expect(mocks.commandGuardDispose).toHaveBeenCalledTimes(1)
    expect(mocks.univerInstances[0].dispose).toHaveBeenCalledTimes(1)

    unmount()

    expect(mocks.commandGuardDispose).toHaveBeenCalledTimes(2)
    expect(mocks.univerInstances[1].dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a pending Univer instance and reports initialization errors', async () => {
    const onError = vi.fn()
    mocks.createWorkbook.mockImplementationOnce(() => {
      throw new Error('create failed')
    })

    render(<ExcelWorkbookView workbookData={makeWorkbookData('broken')} onError={onError} readOnly />)

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'create failed' })))
    expect(mocks.univerInstances).toHaveLength(1)
    expect(mocks.univerInstances[0].dispose).toHaveBeenCalledTimes(1)
    expect(mocks.commandGuardDispose).not.toHaveBeenCalled()
  })
})
