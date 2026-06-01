import '@univerjs/preset-sheets-core/lib/index.css'

import { loggerService } from '@logger'
import type { ExcelPreviewCellCustom, ExcelPreviewImageAnchor, ExcelPreviewImageRenderData } from '@shared/excelPreview'
import type { ICellCustomRender, IDisposable, Plugin, PluginCtor } from '@univerjs/core'
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
type ExcelWorkbookViewInstance = { commandGuard?: IDisposable; imageRenderer?: IDisposable; univer: Univer }
type ExcelSheetHooksApi = {
  getSheetHooks?: () => {
    onCellRender?: (customRender: ICellCustomRender[]) => IDisposable
  }
}

const normalizePresetPlugins = (plugins: PresetPlugin[]): UniverPlugins => {
  return plugins.map((plugin) => (Array.isArray(plugin) ? plugin : [plugin])) as UniverPlugins
}

const getExcelCellImages = (custom: unknown): ExcelPreviewImageRenderData[] => {
  if (!custom || typeof custom !== 'object') return []

  const images = (custom as ExcelPreviewCellCustom).excelImages
  return Array.isArray(images) ? images : []
}

const getAnchorPoint = (
  skeleton: { getCellWithCoordByIndex?: (row: number, column: number, header?: boolean) => unknown },
  anchor: ExcelPreviewImageAnchor,
  fallbackCell: { endX: number; endY: number; startX: number; startY: number }
) => {
  const cell = skeleton.getCellWithCoordByIndex?.(anchor.row, anchor.column, false) as
    | { endX: number; endY: number; startX: number; startY: number }
    | undefined
  const anchorCell = cell ?? fallbackCell
  const width = anchorCell.endX - anchorCell.startX
  const height = anchorCell.endY - anchorCell.startY

  return {
    x: anchorCell.startX + width * anchor.columnOffset,
    y: anchorCell.startY + height * anchor.rowOffset
  }
}

const createExcelImageCellRenderer = (): ICellCustomRender => {
  const imageCache = new Map<string, HTMLImageElement>()

  const getImage = (imageData: ExcelPreviewImageRenderData, markDirty: () => void) => {
    const cached = imageCache.get(imageData.id)
    if (cached) return cached

    const image = new Image()
    image.onload = markDirty
    image.onerror = markDirty
    image.src = imageData.source
    imageCache.set(imageData.id, image)
    return image
  }

  return {
    drawWith: (ctx, info, skeleton, spreadsheets) => {
      const images = getExcelCellImages(info.data?.custom)
      if (!images.length) return

      const markDirty =
        spreadsheets && typeof spreadsheets.makeDirty === 'function' ? () => spreadsheets.makeDirty() : () => {}

      images.forEach((imageData) => {
        const image = getImage(imageData, markDirty)
        if (!image.complete || image.naturalWidth === 0) return

        const from = getAnchorPoint(skeleton, imageData.from, info.primaryWithCoord)
        const to = imageData.to ? getAnchorPoint(skeleton, imageData.to, info.primaryWithCoord) : undefined
        const width = imageData.size?.width ?? (to ? to.x - from.x : image.naturalWidth)
        const height = imageData.size?.height ?? (to ? to.y - from.y : image.naturalHeight)
        if (width <= 0 || height <= 0) return

        ctx.drawImage(image, from.x, from.y, width, height)
      })
    },
    zIndex: 100
  }
}

const installExcelImageCellRenderer = (univerAPI: ReturnType<typeof FUniver.newAPI>): IDisposable | undefined => {
  return (univerAPI as unknown as ExcelSheetHooksApi)
    .getSheetHooks?.()
    ?.onCellRender?.([createExcelImageCellRenderer()])
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
    univerRef.current?.imageRenderer?.dispose()
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
    let pendingImageRenderer: IDisposable | undefined

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
      pendingImageRenderer = installExcelImageCellRenderer(univerAPI)
      univerRef.current = {
        univer,
        imageRenderer: pendingImageRenderer,
        commandGuard: readOnly ? installExcelWorkbookCommandGuard(univerAPI) : undefined
      }
      pendingImageRenderer = undefined
      pendingUniver = null
    } catch (err) {
      pendingImageRenderer?.dispose()
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
