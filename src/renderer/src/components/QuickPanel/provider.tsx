import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  QuickPanelCallBackOptions,
  QuickPanelCloseAction,
  QuickPanelContextType,
  QuickPanelFilterFn,
  QuickPanelKeyDownEvent,
  QuickPanelKeyDownHandler,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelSortFn,
  QuickPanelTriggerInfo
} from './types'
const QuickPanelContext = createContext<QuickPanelContextType | null>(null)

export const QuickPanelProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [symbol, setSymbol] = useState<string>('')

  const [list, setList] = useState<QuickPanelListItem[]>([])
  const [title, setTitle] = useState<string | undefined>()
  const [defaultIndex, setDefaultIndex] = useState<number>(-1)
  const [pageSize, setPageSize] = useState<number>(7)
  const [multiple, setMultiple] = useState<boolean>(false)
  const [manageListExternally, setManageListExternally] = useState<boolean>(false)
  const [triggerInfo, setTriggerInfo] = useState<QuickPanelTriggerInfo | undefined>()
  const [queryAnchor, setQueryAnchor] = useState<number | undefined>()
  const [parentPanel, setParentPanel] = useState<QuickPanelOpenOptions | undefined>()
  const [filterFn, setFilterFn] = useState<QuickPanelFilterFn | undefined>()
  const [sortFn, setSortFn] = useState<QuickPanelSortFn | undefined>()
  const [onClose, setOnClose] = useState<((Options: Partial<QuickPanelCallBackOptions>) => void) | undefined>()
  const [beforeAction, setBeforeAction] = useState<((Options: QuickPanelCallBackOptions) => void) | undefined>()
  const [afterAction, setAfterAction] = useState<((Options: QuickPanelCallBackOptions) => void) | undefined>()
  const [lastCloseAction, setLastCloseAction] = useState<QuickPanelCloseAction | undefined>(undefined)

  const clearTimer = useRef<NodeJS.Timeout | null>(null)
  const keyDownHandlerRef = useRef<QuickPanelKeyDownHandler | undefined>(undefined)
  const panelGenerationRef = useRef(0)

  // 添加更新item选中状态的方法
  const updateItemSelection = useCallback((targetItem: QuickPanelListItem, isSelected: boolean) => {
    setList((prevList) => {
      // 先尝试引用匹配（快速路径）
      const refIndex = prevList.findIndex((item) => item === targetItem)
      if (refIndex !== -1) {
        return prevList.map((item, idx) => (idx === refIndex ? { ...item, isSelected } : item))
      }

      // 如果引用匹配失败，使用内容匹配（兜底方案）
      // 通过 label 和 filterText 来识别同一个item
      return prevList.map((item) => {
        const isSameItem =
          (item.label === targetItem.label || item.filterText === targetItem.filterText) &&
          (!targetItem.filterText || item.filterText === targetItem.filterText)
        return isSameItem ? { ...item, isSelected } : item
      })
    })
  }, [])

  // 添加更新整个列表的方法
  const updateList = useCallback((newList: QuickPanelListItem[]) => {
    setList(newList)
  }, [])

  const open = useCallback((options: QuickPanelOpenOptions) => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current)
      clearTimer.current = null
    }

    panelGenerationRef.current += 1
    setLastCloseAction(undefined)
    setTitle(options.title)
    setList(options.list)
    const nextDefaultIndex = typeof options.defaultIndex === 'number' ? Math.max(-1, options.defaultIndex) : -1
    setDefaultIndex(nextDefaultIndex)
    setPageSize(options.pageSize ?? 7)
    setMultiple(options.multiple ?? false)
    setManageListExternally(options.manageListExternally ?? false)
    setSymbol(options.symbol)
    setTriggerInfo(options.triggerInfo)
    setQueryAnchor(options.queryAnchor ?? options.triggerInfo?.position)
    setParentPanel(options.parentPanel)

    setOnClose(() => options.onClose)
    setBeforeAction(() => options.beforeAction)
    setAfterAction(() => options.afterAction)
    setFilterFn(() => options.filterFn)
    setSortFn(() => options.sortFn)

    setIsVisible(true)
  }, [])

  const close = useCallback(
    (action?: QuickPanelCloseAction, searchText?: string) => {
      setIsVisible(false)
      setManageListExternally(false)
      setLastCloseAction(action)
      onClose?.({ action, searchText, item: {} as QuickPanelListItem, context: this })

      clearTimer.current = setTimeout(() => {
        setList([])
        setOnClose(undefined)
        setBeforeAction(undefined)
        setAfterAction(undefined)
        setFilterFn(undefined)
        setSortFn(undefined)
        setTitle(undefined)
        setSymbol('')
        setTriggerInfo(undefined)
        setQueryAnchor(undefined)
        setParentPanel(undefined)
        setManageListExternally(false)
      }, 200)
    },
    [onClose]
  )

  useEffect(() => {
    return () => {
      if (clearTimer.current) {
        clearTimeout(clearTimer.current)
        clearTimer.current = null
      }
    }
  }, [])

  const registerKeyDownHandler = useCallback((handler: QuickPanelKeyDownHandler | undefined) => {
    keyDownHandlerRef.current = handler

    return () => {
      if (keyDownHandlerRef.current === handler) {
        keyDownHandlerRef.current = undefined
      }
    }
  }, [])

  const dispatchKeyDown = useCallback((event: QuickPanelKeyDownEvent) => {
    return keyDownHandlerRef.current?.(event) ?? false
  }, [])

  const getPanelGeneration = useCallback(() => panelGenerationRef.current, [])

  const value = useMemo(
    () => ({
      open,
      close,
      updateItemSelection,
      updateList,

      isVisible,
      symbol,

      list,
      title,
      defaultIndex,
      pageSize,
      multiple,
      manageListExternally,
      triggerInfo,
      queryAnchor,
      parentPanel,
      lastCloseAction,
      filterFn,
      sortFn,
      dispatchKeyDown,
      getPanelGeneration,
      registerKeyDownHandler,
      onClose,
      beforeAction,
      afterAction
    }),
    [
      open,
      close,
      updateItemSelection,
      updateList,
      dispatchKeyDown,
      getPanelGeneration,
      registerKeyDownHandler,
      isVisible,
      symbol,
      list,
      title,
      defaultIndex,
      pageSize,
      multiple,
      manageListExternally,
      triggerInfo,
      queryAnchor,
      parentPanel,
      lastCloseAction,
      filterFn,
      sortFn,
      onClose,
      beforeAction,
      afterAction
    ]
  )

  return <QuickPanelContext value={value}>{children}</QuickPanelContext>
}

export { QuickPanelContext }
