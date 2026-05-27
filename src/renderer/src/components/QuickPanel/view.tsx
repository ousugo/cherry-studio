import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { isMac } from '@renderer/config/constant'
import { classNames } from '@renderer/utils'
import { t } from 'i18next'
import { Check, ChevronRight } from 'lucide-react'
import React, { use, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultFilterFn, defaultSortFn } from './defaultStrategies'
import { QuickPanelFooter } from './list'
import { QuickPanelContext } from './provider'
import type {
  QuickPanelCallBackOptions,
  QuickPanelCloseAction,
  QuickPanelInputAdapter,
  QuickPanelKeyDownEvent,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelScrollTrigger
} from './types'

const ITEM_HEIGHT = 31

const firstSelectableIndex = (items: readonly QuickPanelListItem[]) => items.findIndex((item) => !item.disabled)
const INPUT_TRIGGER_SYMBOLS = new Set(['/', '@'])

interface Props {
  inputAdapter?: QuickPanelInputAdapter
}

/**
 * @description 快捷面板内容视图;
 * 请不要往这里添加入参，避免耦合;
 * 这里只读取来自上下文QuickPanelContext的数据
 */
export const QuickPanelView: React.FC<Props> = ({ inputAdapter }) => {
  const ctx = use(QuickPanelContext)

  if (!ctx) {
    throw new Error('QuickPanel must be used within a QuickPanelProvider')
  }

  const closePanel = ctx.close
  const isPanelVisible = ctx.isVisible
  const registerKeyDownHandler = ctx.registerKeyDownHandler

  const ASSISTIVE_KEY = isMac ? '⌘' : 'Ctrl'
  const [isAssistiveKeyPressed, setIsAssistiveKeyPressed] = useState(false)

  // 避免上下翻页时，鼠标干扰
  const [isMouseOver, setIsMouseOver] = useState(false)

  const scrollTriggerRef = useRef<QuickPanelScrollTrigger>('initial')
  const [_index, setIndex] = useState(-1)
  const index = useDeferredValue(_index)

  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  const [inputSearchText, setInputSearchText] = useState('')
  const searchText = useDeferredValue(inputSearchText)
  const queryAnchorRef = useRef<number | undefined>(undefined)
  const inputTriggerConsumedRef = useRef(false)

  // 缓存：按 item 缓存拼音文本，避免重复转换
  const pinyinCacheRef = useRef<WeakMap<QuickPanelListItem, string>>(new WeakMap())

  // 跟踪上一次的搜索文本和符号，用于判断是否需要重置index
  const prevSearchTextRef = useRef('')
  const prevSymbolRef = useRef('')

  // Use injected filter and sort functions, or fall back to defaults
  const filterFn = ctx.filterFn || defaultFilterFn
  const sortFn = ctx.sortFn || defaultSortFn
  // 处理搜索，过滤列表（始终保留 alwaysVisible 项在顶部）
  const list = useMemo(() => {
    // Reset stale state when panel fully closes (both isVisible false AND symbol cleared)
    if (!ctx.isVisible && !ctx.symbol) {
      prevSymbolRef.current = ''
      prevSearchTextRef.current = ''
      queryAnchorRef.current = undefined
      inputTriggerConsumedRef.current = false
      setIndex(-1)
      return []
    }

    const baseList = (ctx.list || []).filter((item) => !item.hidden)

    if (ctx.manageListExternally) {
      const combinedLength = baseList.length
      const isSymbolChanged = prevSymbolRef.current !== ctx.symbol
      if (isSymbolChanged) {
        setIndex(firstSelectableIndex(baseList))
      } else {
        setIndex((prevIndex) => {
          if (prevIndex >= combinedLength) {
            return combinedLength > 0 ? combinedLength - 1 : -1
          }
          return prevIndex
        })
      }

      prevSearchTextRef.current = ''
      prevSymbolRef.current = ctx.symbol

      return baseList
    }

    const _searchText = searchText.replace(/^[/@]/, '')
    const lowerSearchText = _searchText.toLowerCase()
    const fuzzyPattern = lowerSearchText
      .split('')
      .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    const fuzzyRegex = new RegExp(fuzzyPattern, 'ig')

    // 拆分：固定显示项（不参与过滤）与普通项
    const pinnedItems = baseList.filter((item) => item.alwaysVisible)
    const normalItems = baseList.filter((item) => !item.alwaysVisible)

    // Filter normal items using injected filter function
    const filteredNormalItems = normalItems.filter((item) => {
      return filterFn(item, _searchText, fuzzyRegex, pinyinCacheRef.current)
    })

    // Sort filtered items using injected sort function
    const sortedNormalItems = sortFn(filteredNormalItems, _searchText)

    // 只有在搜索文本变化或面板符号变化时才重置index
    const isSearchChanged = prevSearchTextRef.current !== searchText
    const isSymbolChanged = prevSymbolRef.current !== ctx.symbol

    if (isSearchChanged || isSymbolChanged) {
      setIndex(firstSelectableIndex([...pinnedItems, ...sortedNormalItems]))
    } else {
      // 如果当前index超出范围，调整到有效范围内
      setIndex((prevIndex) => {
        const combinedLength = pinnedItems.length + sortedNormalItems.length
        if (prevIndex >= combinedLength) {
          return combinedLength > 0 ? combinedLength - 1 : -1
        }
        return prevIndex
      })
    }

    prevSearchTextRef.current = searchText
    prevSymbolRef.current = ctx.symbol

    // 固定项置顶 + 排序后的普通项
    return [...pinnedItems, ...sortedNormalItems]
  }, [ctx.isVisible, ctx.symbol, ctx.manageListExternally, ctx.list, searchText, filterFn, sortFn])

  const handleClose = useCallback(
    (action?: QuickPanelCloseAction) => {
      const cleanSearchText = searchText.trim()
      ctx.close(action, cleanSearchText)
      scrollTriggerRef.current = 'initial'
    },
    [ctx, searchText]
  )

  const getCurrentPanelOptions = useCallback(
    (defaultIndex?: number): QuickPanelOpenOptions => ({
      title: ctx.title,
      list: ctx.list,
      symbol: ctx.symbol,
      multiple: ctx.multiple,
      defaultIndex,
      pageSize: ctx.pageSize,
      queryAnchor: queryAnchorRef.current ?? ctx.queryAnchor,
      parentPanel: ctx.parentPanel,
      triggerInfo: ctx.triggerInfo,
      beforeAction: ctx.beforeAction,
      afterAction: ctx.afterAction,
      onClose: ctx.onClose,
      manageListExternally: ctx.manageListExternally,
      filterFn: ctx.filterFn,
      sortFn: ctx.sortFn
    }),
    [ctx]
  )

  const consumeInputQuery = useCallback(() => {
    if (!inputAdapter) return

    const queryAnchor = queryAnchorRef.current ?? ctx.queryAnchor
    if (queryAnchor === undefined) return

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    if (cursorOffset < queryAnchor) return

    inputAdapter.deleteTriggerRange({ from: queryAnchor, to: cursorOffset })
  }, [ctx.queryAnchor, inputAdapter])

  const consumeInputTriggerSymbol = useCallback(() => {
    if (!inputAdapter) return

    const queryAnchor = queryAnchorRef.current ?? ctx.queryAnchor
    if (queryAnchor === undefined) return

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    if (cursorOffset <= queryAnchor) return

    const triggerSymbol = text.slice(queryAnchor, queryAnchor + 1)
    if (triggerSymbol !== '/' && triggerSymbol !== '@') return

    inputTriggerConsumedRef.current = true
    inputAdapter.deleteTriggerRange({ from: queryAnchor, to: queryAnchor + 1 })
    queryAnchorRef.current = queryAnchor
    setInputSearchText(text.slice(queryAnchor + 1, cursorOffset))
  }, [ctx.queryAnchor, inputAdapter])

  const handleItemAction = useCallback(
    (item: QuickPanelListItem, action?: QuickPanelCloseAction) => {
      if (item.disabled) return
      const cleanSearchText = searchText.replace(/^[/@]/, '')
      const parentPanel = getCurrentPanelOptions(index)
      const queryAnchor = queryAnchorRef.current ?? ctx.queryAnchor
      const panelGenerationBeforeAction = ctx.getPanelGeneration()

      // 在多选模式下，先更新选中状态
      if (ctx.multiple && !item.isMenu) {
        const newSelectedState = !item.isSelected
        ctx.updateItemSelection(item, newSelectedState)

        // 创建更新后的item对象用于回调
        const updatedItem = { ...item, isSelected: newSelectedState }
        const quickPanelCallBackOptions: QuickPanelCallBackOptions = {
          context: ctx,
          action,
          item: updatedItem,
          parentPanel,
          queryAnchor,
          searchText: cleanSearchText,
          inputAdapter
        }

        consumeInputQuery()
        ctx.beforeAction?.(quickPanelCallBackOptions)
        item?.action?.(quickPanelCallBackOptions)
        ctx.afterAction?.(quickPanelCallBackOptions)
        queryAnchorRef.current = inputAdapter?.getCursorOffset?.() ?? queryAnchor
        setInputSearchText('')
        return
      }

      const quickPanelCallBackOptions: QuickPanelCallBackOptions = {
        context: ctx,
        action,
        item,
        parentPanel,
        queryAnchor,
        searchText: cleanSearchText,
        inputAdapter
      }

      if (item.isMenu) {
        consumeInputTriggerSymbol()
      } else {
        consumeInputQuery()
      }
      ctx.beforeAction?.(quickPanelCallBackOptions)
      item?.action?.(quickPanelCallBackOptions)
      ctx.afterAction?.(quickPanelCallBackOptions)

      if (item.isMenu) {
        return
      }

      // 多选模式下不关闭面板
      if (ctx.multiple) return

      if (ctx.getPanelGeneration() !== panelGenerationBeforeAction) {
        return
      }

      handleClose(action)
    },
    [
      ctx,
      searchText,
      getCurrentPanelOptions,
      index,
      consumeInputTriggerSymbol,
      consumeInputQuery,
      inputAdapter,
      handleClose
    ]
  )

  const updateSearchFromInput = useCallback(() => {
    if (!isPanelVisible || !inputAdapter) return

    const queryAnchor = queryAnchorRef.current
    if (queryAnchor === undefined) return

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    const triggerSymbol = ctx.triggerInfo?.originalText?.slice(0, 1)
    const shouldRequireInputTrigger =
      ctx.triggerInfo?.type === 'input' && triggerSymbol !== undefined && INPUT_TRIGGER_SYMBOLS.has(triggerSymbol)

    if (cursorOffset < queryAnchor) {
      closePanel('input_session_invalid')
      return
    }

    if (
      shouldRequireInputTrigger &&
      !inputTriggerConsumedRef.current &&
      text.slice(queryAnchor, queryAnchor + 1) !== triggerSymbol
    ) {
      closePanel('input_trigger_removed')
      return
    }

    setInputSearchText(text.slice(queryAnchor, cursorOffset))
  }, [closePanel, ctx.triggerInfo?.originalText, ctx.triggerInfo?.type, inputAdapter, isPanelVisible])

  useEffect(() => {
    if (!ctx.isVisible) return

    if (!inputAdapter) {
      queryAnchorRef.current = undefined
      setInputSearchText('')
      return
    }

    const text = inputAdapter.getText()
    const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
    const queryAnchor = Math.max(
      0,
      Math.min(ctx.queryAnchor ?? ctx.triggerInfo?.position ?? cursorOffset, cursorOffset)
    )
    const triggerSymbol = ctx.triggerInfo?.originalText?.slice(0, 1)

    if (
      ctx.triggerInfo?.type === 'input' &&
      triggerSymbol !== undefined &&
      INPUT_TRIGGER_SYMBOLS.has(triggerSymbol) &&
      text.slice(queryAnchor, queryAnchor + 1) === triggerSymbol
    ) {
      inputTriggerConsumedRef.current = false
    }

    queryAnchorRef.current = queryAnchor
    setInputSearchText(text.slice(queryAnchor, cursorOffset))
    inputAdapter.focus()

    return inputAdapter.subscribeInput?.((event) => {
      if (event?.isComposing) return
      updateSearchFromInput()
    })
  }, [
    ctx.isVisible,
    ctx.queryAnchor,
    ctx.symbol,
    ctx.triggerInfo?.originalText,
    ctx.triggerInfo?.position,
    ctx.triggerInfo?.type,
    inputAdapter,
    updateSearchFromInput
  ])

  useEffect(() => {
    if (ctx.isVisible) return

    const timer = setTimeout(() => {
      setInputSearchText('')
      queryAnchorRef.current = undefined
      inputTriggerConsumedRef.current = false
    }, 200)

    return () => clearTimeout(timer)
  }, [ctx.isVisible])

  useLayoutEffect(() => {
    if (!listRef.current || index < 0 || scrollTriggerRef.current === 'none') return

    const alignment = scrollTriggerRef.current === 'keyboard' ? 'auto' : 'center'
    listRef.current?.scrollToIndex(index, { align: alignment })

    scrollTriggerRef.current = 'none'
  }, [index])

  const handlePanelKeyDown = useCallback(
    (e: QuickPanelKeyDownEvent) => {
      const assistivePressed = isMac ? e.metaKey : e.ctrlKey

      if (assistivePressed) {
        setIsAssistiveKeyPressed(true)
      }

      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }
      if (e.key === 'ArrowRight' && assistivePressed) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      switch (e.key) {
        case 'ArrowUp':
          scrollTriggerRef.current = 'keyboard'
          if (assistivePressed) {
            setIndex((prev) => {
              if (prev === -1) return list.length > 0 ? list.length - 1 : -1
              const newIndex = prev - ctx.pageSize
              if (prev === 0) return list.length - 1
              return newIndex < 0 ? 0 : newIndex
            })
          } else {
            setIndex((prev) => {
              if (prev === -1) return list.length > 0 ? list.length - 1 : -1
              return prev > 0 ? prev - 1 : list.length - 1
            })
          }
          return true

        case 'ArrowDown':
          scrollTriggerRef.current = 'keyboard'
          if (assistivePressed) {
            setIndex((prev) => {
              if (prev === -1) return list.length > 0 ? 0 : -1
              const newIndex = prev + ctx.pageSize
              if (prev + 1 === list.length) return 0
              return newIndex >= list.length ? list.length - 1 : newIndex
            })
          } else {
            setIndex((prev) => {
              if (prev === -1) return list.length > 0 ? 0 : -1
              return prev < list.length - 1 ? prev + 1 : 0
            })
          }
          return true

        case 'PageUp':
          scrollTriggerRef.current = 'keyboard'
          setIndex((prev) => {
            if (prev === -1) return list.length > 0 ? Math.max(0, list.length - ctx.pageSize) : -1
            const newIndex = prev - ctx.pageSize
            return newIndex < 0 ? 0 : newIndex
          })
          return true

        case 'PageDown':
          scrollTriggerRef.current = 'keyboard'
          setIndex((prev) => {
            if (prev === -1) return list.length > 0 ? Math.min(ctx.pageSize - 1, list.length - 1) : -1
            const newIndex = prev + ctx.pageSize
            return newIndex >= list.length ? list.length - 1 : newIndex
          })
          return true

        case 'ArrowRight':
          if (!assistivePressed) return false
          if (!list?.[index]?.isMenu) return false
          scrollTriggerRef.current = 'initial'
          handleItemAction(list[index], 'enter')
          return true

        case 'Enter':
        case 'NumpadEnter': {
          const isComposing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
          if (isComposing) return false

          if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setIsMouseOver(false)
            return false
          }

          // 折叠/软隐藏时也要拦截，避免把查询输入当作发送消息。
          const hasSearch = searchText.length > 0
          const nonPinnedCount = list.filter((i) => !i.alwaysVisible).length
          const isCollapsed = hasSearch && nonPinnedCount === 0
          if (isCollapsed) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)
            return true
          }

          // 面板可见且未折叠时：拦截所有 Enter 变体；
          // 纯 Enter 选择项，带修饰键仅拦截不处理
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)
            return true
          }

          if (list?.[index]) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)

            handleItemAction(list[index], 'enter')
          } else {
            e.preventDefault()
            e.stopPropagation()
          }
          return true
        }
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          handleClose('esc')
          return true
      }

      return false
    },
    [index, ctx, list, handleItemAction, handleClose, searchText]
  )

  useEffect(() => {
    if (!isPanelVisible) return
    return registerKeyDownHandler(handlePanelKeyDown)
  }, [isPanelVisible, registerKeyDownHandler, handlePanelKeyDown])

  const handlePanelKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isMac ? !e.metaKey : !e.ctrlKey) {
      setIsAssistiveKeyPressed(false)
    }
  }, [])

  useEffect(() => {
    if (!ctx.isVisible) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('#inputbar')) return
      if (bodyRef.current && !bodyRef.current.contains(target)) {
        handleClose('outsideclick')
      }
    }

    window.addEventListener('click', handleClickOutside, true)

    return () => {
      window.removeEventListener('click', handleClickOutside, true)
    }
  }, [ctx.isVisible, handleClose])

  const [footerWidth, setFooterWidth] = useState(0)

  useEffect(() => {
    if (!footerRef.current || !ctx.isVisible) return
    const footerWidth = footerRef.current.clientWidth
    setFooterWidth(footerWidth)

    const handleResize = () => {
      const footerWidth = footerRef.current!.clientWidth
      setFooterWidth(footerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [ctx.isVisible])

  const listHeight = useMemo(() => {
    return Math.min(ctx.pageSize, list.length) * ITEM_HEIGHT
  }, [ctx.pageSize, list.length])
  const hasSearchText = useMemo(() => searchText.length > 0, [searchText])
  // 折叠仅依据“非固定项”的匹配数；仅剩固定项（如“清除”）时仍视为无匹配，保持折叠
  const visibleNonPinnedCount = useMemo(() => list.filter((i) => !i.alwaysVisible).length, [list])
  const collapsed = !ctx.manageListExternally && hasSearchText && visibleNonPinnedCount === 0
  const panelMaxHeight = ctx.isVisible ? (collapsed ? 98 : ctx.pageSize * ITEM_HEIGHT + 98) : 0

  const estimateSize = useCallback(() => ITEM_HEIGHT, [])

  const rowRenderer = useCallback(
    (item: QuickPanelListItem, itemIndex: number) => {
      if (!item) return null

      return (
        <div
          className={classNames(
            'mx-[5px] mb-px flex h-[30px] items-center justify-between gap-5 rounded-md p-[5px] transition-colors duration-100',
            item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-accent',
            item.isSelected && 'bg-muted',
            item.isSelected && itemIndex === index && 'bg-accent',
            item.isSelected && !item.disabled && 'hover:bg-accent',
            !item.isSelected && itemIndex === index && 'bg-accent',
            {
              focused: itemIndex === index,
              selected: item.isSelected,
              disabled: item.disabled
            }
          )}
          data-id={itemIndex}
          onClick={(e) => {
            e.stopPropagation()
            handleItemAction(item, 'click')
          }}>
          <div className="flex max-w-[60%] flex-1 shrink-0 items-center gap-[5px]">
            <span className="flex items-center justify-center text-[13px] text-muted-foreground [&>svg]:size-[1em] [&>svg]:text-muted-foreground">
              {item.icon}
            </span>
            <span className="flex-1 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-4">
              {item.label}
            </span>
          </div>

          <div className="flex min-w-[20%] items-center justify-end gap-0.5 text-[11px] text-muted-foreground">
            {item.description && (
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.description}</span>
            )}
            <span className="flex min-w-3 shrink-0 items-center justify-end gap-[3px] [&>svg]:size-[1em] [&>svg]:text-muted-foreground">
              {item.suffix ? (
                item.suffix
              ) : item.isSelected ? (
                <Check />
              ) : (
                item.isMenu && !item.disabled && <ChevronRight size={14} />
              )}
            </span>
          </div>
        </div>
      )
    },
    [index, handleItemAction]
  )

  return (
    <div
      style={{ maxHeight: panelMaxHeight }}
      className={classNames(
        '-translate-y-full pointer-events-none absolute top-px right-0 left-0 w-full origin-bottom overflow-hidden transition-[max-height] duration-200 ease-in-out',
        ctx.isVisible && 'visible',
        ctx.isVisible && 'pointer-events-auto'
      )}
      data-testid="quick-panel">
      <div
        ref={bodyRef}
        data-testid="quick-panel-body"
        className="relative isolate rounded-xl border border-border/80 bg-background py-[5px] [&::-webkit-scrollbar]:w-[3px]"
        onKeyDown={handlePanelKeyDown}
        onKeyUp={handlePanelKeyUp}
        onMouseMove={() =>
          setIsMouseOver((prev) => {
            scrollTriggerRef.current = 'initial'
            return prev ? prev : true
          })
        }>
        {collapsed ? (
          <div className="p-4 text-center text-[13px] text-muted-foreground">
            {t('settings.quickPanel.noResult', 'No results')}
          </div>
        ) : (
          <DynamicVirtualList
            ref={listRef}
            list={list}
            size={listHeight}
            estimateSize={estimateSize}
            overscan={5}
            scrollerStyle={{
              pointerEvents: isMouseOver ? 'auto' : 'none'
            }}>
            {rowRenderer}
          </DynamicVirtualList>
        )}
        <QuickPanelFooter
          containerRef={footerRef}
          title={ctx.title}
          assistiveKey={footerWidth >= 500 ? ASSISTIVE_KEY : undefined}
          assistiveKeyActive={isAssistiveKeyPressed}
          showPageHint
          confirmLabel={ctx.multiple ? t('settings.quickPanel.multiple') : undefined}
        />
      </div>
    </div>
  )
}
