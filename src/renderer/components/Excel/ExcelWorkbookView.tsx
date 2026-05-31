import '@univerjs/preset-sheets-core/lib/index.css'

import { loggerService } from '@logger'
import type { IDisposable, Plugin, PluginCtor } from '@univerjs/core'
import { LocaleType, mergeLocales, Univer } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { useCallback, useEffect, useRef } from 'react'

import { configureExcelWorkbookReadOnly, installExcelWorkbookCommandGuard } from './excelWorkbookProtection'
import type { ExcelWorkbookViewProps } from './types'

const logger = loggerService.withContext('ExcelWorkbookView')

type UniverPlugins = Parameters<Univer['registerPlugins']>[0]
type PresetPlugin = PluginCtor<Plugin> | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]]
type ExcelWorkbookViewInstance = { commandGuard?: IDisposable; univer: Univer }

const normalizePresetPlugins = (plugins: PresetPlugin[]): UniverPlugins => {
  return plugins.map((plugin) => (Array.isArray(plugin) ? plugin : [plugin])) as UniverPlugins
}

const ExcelWorkbookView = ({
  ariaLabel,
  className,
  onError,
  readOnly = false,
  workbookData
}: ExcelWorkbookViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const onErrorRef = useRef(onError)
  const univerRef = useRef<ExcelWorkbookViewInstance | null>(null)

  const disposeUniver = useCallback(() => {
    univerRef.current?.commandGuard?.dispose()
    univerRef.current?.univer.dispose()
    univerRef.current = null
    containerRef.current?.replaceChildren()
  }, [])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => disposeUniver, [disposeUniver])

  useEffect(() => {
    const container = containerRef.current

    disposeUniver()

    if (!container) return

    let pendingUniver: Univer | null = null

    try {
      const univer = new Univer({
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS)
        }
      })
      pendingUniver = univer
      const preset = UniverSheetsCorePreset({
        container,
        header: false,
        toolbar: false,
        formulaBar: true,
        contextMenu: false,
        disableAutoFocus: true,
        sheets: {
          disableForceStringAlert: true,
          disableForceStringMark: true
        },
        footer: {
          sheetBar: true,
          statisticBar: false,
          menus: false,
          zoomSlider: true,
          addSheetButtonConfig: {
            show: false
          }
        }
      })
      univer.registerPlugins(normalizePresetPlugins(preset.plugins))
      if (readOnly) {
        configureExcelWorkbookReadOnly(univer)
      }
      const univerAPI = FUniver.newAPI(univer)

      univerAPI.createWorkbook(workbookData)
      univerRef.current = {
        univer,
        commandGuard: readOnly ? installExcelWorkbookCommandGuard(univerAPI) : undefined
      }
      pendingUniver = null
    } catch (err) {
      pendingUniver?.dispose()
      const normalized = err instanceof Error ? err : new Error(String(err))
      logger.error('Failed to initialize Excel workbook view', normalized)
      onErrorRef.current?.(normalized)
    }

    return disposeUniver
  }, [disposeUniver, readOnly, workbookData])

  return (
    <div
      data-testid="excel-workbook-view"
      aria-label={ariaLabel}
      className={['relative h-full w-full bg-background', className].filter(Boolean).join(' ')}>
      <div ref={containerRef} data-testid="univer-excel-container" className="h-full w-full" />
    </div>
  )
}

export default ExcelWorkbookView
export type { ExcelWorkbookViewProps }
