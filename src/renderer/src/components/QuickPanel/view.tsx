import { Flex, Input } from '@cherrystudio/ui'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { isMac } from '@renderer/config/constant'
import { classNames } from '@renderer/utils'
import { t } from 'i18next'
import { Check, ChevronRight } from 'lucide-react'
import React, { use, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultFilterFn, defaultSortFn } from './defaultStrategies'
import { QuickPanelContext } from './provider'
import type {
  QuickPanelCallBackOptions,
  QuickPanelCloseAction,
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelScrollTrigger
} from './types'

const ITEM_HEIGHT = 31

interface Props {
  setInputText: React.Dispatch<React.SetStateAction<string>>
  inputAdapter?: QuickPanelInputAdapter
}

/**
 * @description 快捷面板内容视图;
 * 请不要往这里添加入参，避免耦合;
 * 这里只读取来自上下文QuickPanelContext的数据
 */
export const QuickPanelView: React.FC<Props> = ({ setInputText, inputAdapter }) => {
  const ctx = use(QuickPanelContext)
  void setInputText
  void inputAdapter

  if (!ctx) {
    throw new Error('QuickPanel must be used within a QuickPanelProvider')
  }

  const ASSISTIVE_KEY = isMac ? '⌘' : 'Ctrl'
  const [isAssistiveKeyPressed, setIsAssistiveKeyPressed] = useState(false)

  // 避免上下翻页时，鼠标干扰
  const [isMouseOver, setIsMouseOver] = useState(false)

  const scrollTriggerRef = useRef<QuickPanelScrollTrigger>('initial')
  const [_index, setIndex] = useState(-1)
  const index = useDeferredValue(_index)
  const [historyPanel, setHistoryPanel] = useState<QuickPanelOpenOptions[]>([])

  const bodyRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)

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
      setIndex(-1)
      return []
    }

    const baseList = (ctx.list || []).filter((item) => !item.hidden)

    if (ctx.manageListExternally) {
      const combinedLength = baseList.length
      const isSymbolChanged = prevSymbolRef.current !== ctx.symbol
      if (isSymbolChanged) {
        const maxIndex = combinedLength > 0 ? combinedLength - 1 : -1
        const desiredIndex =
          typeof ctx.defaultIndex === 'number' ? Math.min(Math.max(ctx.defaultIndex, -1), maxIndex) : -1
        setIndex(desiredIndex)
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
      const combinedLength = pinnedItems.length + sortedNormalItems.length
      if (isSymbolChanged) {
        const maxIndex = combinedLength > 0 ? combinedLength - 1 : -1
        const desiredIndex =
          typeof ctx.defaultIndex === 'number' ? Math.min(Math.max(ctx.defaultIndex, -1), maxIndex) : -1
        setIndex(desiredIndex)
      } else {
        setIndex(-1) // 搜索文本变化时不默认高亮
      }
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
  }, [ctx.isVisible, ctx.symbol, ctx.manageListExternally, ctx.list, ctx.defaultIndex, searchText, filterFn, sortFn])

  const canForwardAndBackward = useMemo(() => {
    return list.some((item) => item.isMenu) || historyPanel.length > 0
  }, [list, historyPanel])

  const handleClose = useCallback(
    (action?: QuickPanelCloseAction) => {
      const cleanSearchText = searchText.trim()
      ctx.close(action, cleanSearchText)
      setHistoryPanel([])
      scrollTriggerRef.current = 'initial'
    },
    [ctx, searchText]
  )

  const handleItemAction = useCallback(
    (item: QuickPanelListItem, action?: QuickPanelCloseAction) => {
      if (item.disabled) return

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
          searchText: searchText,
          inputAdapter
        }

        ctx.beforeAction?.(quickPanelCallBackOptions)
        item?.action?.(quickPanelCallBackOptions)
        ctx.afterAction?.(quickPanelCallBackOptions)
        return
      }

      const quickPanelCallBackOptions: QuickPanelCallBackOptions = {
        context: ctx,
        action,
        item,
        searchText: searchText,
        inputAdapter
      }

      ctx.beforeAction?.(quickPanelCallBackOptions)
      item?.action?.(quickPanelCallBackOptions)
      ctx.afterAction?.(quickPanelCallBackOptions)

      if (item.isMenu) {
        // 保存上一个打开的选项，用于回退
        setHistoryPanel((prev) => [
          ...(prev || []),
          {
            title: ctx.title,
            list: ctx.list,
            symbol: ctx.symbol,
            multiple: ctx.multiple,
            defaultIndex: index,
            pageSize: ctx.pageSize,
            onClose: ctx.onClose,
            beforeAction: ctx.beforeAction,
            afterAction: ctx.afterAction
          }
        ])
        setSearchText('')
        return
      }

      // 多选模式下不关闭面板
      if (ctx.multiple) return

      handleClose(action)
    },
    [ctx, searchText, handleClose, index, inputAdapter]
  )

  const prevSearchCallbackTextRef = useRef('')
  const onSearchChangeRef = useRef(ctx.onSearchChange)

  useEffect(() => {
    onSearchChangeRef.current = ctx.onSearchChange
  }, [ctx.onSearchChange])

  useEffect(() => {
    if (!ctx.isVisible) {
      prevSearchCallbackTextRef.current = ''
    }
  }, [ctx.isVisible])

  const triggerSearchChange = useCallback((searchText: string) => {
    const cleanSearchText = searchText.trim()

    if (cleanSearchText === prevSearchCallbackTextRef.current) {
      return
    }

    prevSearchCallbackTextRef.current = cleanSearchText
    onSearchChangeRef.current?.(cleanSearchText)
  }, [])

  useEffect(() => {
    if (ctx.isVisible) {
      searchInputRef.current?.focus()
    }
  }, [ctx.isVisible])

  useEffect(() => {
    if (ctx.isVisible) return

    const timer = setTimeout(() => {
      setSearchText('')
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
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isMac ? e.metaKey : e.ctrlKey) {
        setIsAssistiveKeyPressed(true)
      }

      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }
      if (['ArrowLeft', 'ArrowRight'].includes(e.key) && isAssistiveKeyPressed) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      switch (e.key) {
        case 'ArrowUp':
          scrollTriggerRef.current = 'keyboard'
          if (isAssistiveKeyPressed) {
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
          break

        case 'ArrowDown':
          scrollTriggerRef.current = 'keyboard'
          if (isAssistiveKeyPressed) {
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
          break

        case 'PageUp':
          scrollTriggerRef.current = 'keyboard'
          setIndex((prev) => {
            if (prev === -1) return list.length > 0 ? Math.max(0, list.length - ctx.pageSize) : -1
            const newIndex = prev - ctx.pageSize
            return newIndex < 0 ? 0 : newIndex
          })
          break

        case 'PageDown':
          scrollTriggerRef.current = 'keyboard'
          setIndex((prev) => {
            if (prev === -1) return list.length > 0 ? Math.min(ctx.pageSize - 1, list.length - 1) : -1
            const newIndex = prev + ctx.pageSize
            return newIndex >= list.length ? list.length - 1 : newIndex
          })
          break

        case 'ArrowLeft':
          if (!isAssistiveKeyPressed) return
          if (!historyPanel.length) return
          scrollTriggerRef.current = 'initial'
          setSearchText('')
          if (historyPanel.length > 0) {
            const lastPanel = historyPanel.pop()
            if (lastPanel) {
              ctx.open(lastPanel)
            }
          }
          break

        case 'ArrowRight':
          if (!isAssistiveKeyPressed) return
          if (!list?.[index]?.isMenu) return
          scrollTriggerRef.current = 'initial'
          setSearchText('')
          handleItemAction(list[index], 'enter')
          break

        case 'Enter':
        case 'NumpadEnter': {
          if (e.nativeEvent.isComposing) return

          // 折叠/软隐藏时不拦截，让输入框处理（用于发送消息）
          const hasSearch = searchText.length > 0
          const nonPinnedCount = list.filter((i) => !i.alwaysVisible).length
          const isCollapsed = hasSearch && nonPinnedCount === 0
          if (isCollapsed) return

          // 面板可见且未折叠时：拦截所有 Enter 变体；
          // 纯 Enter 选择项，带修饰键仅拦截不处理
          if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Don't prevent default or stop propagation - let it create a newline
            setIsMouseOver(false)
            break
          }

          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)
            break
          }

          if (list?.[index]) {
            e.preventDefault()
            e.stopPropagation()
            setIsMouseOver(false)

            handleItemAction(list[index], 'enter')
          } else {
            handleClose('enter_empty')
          }
          break
        }
        case 'Escape':
          e.stopPropagation()
          handleClose('esc')
          break
      }
    },
    [index, isAssistiveKeyPressed, historyPanel, ctx, list, handleItemAction, handleClose, searchText]
  )

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

  const handleSearchTextChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextSearchText = event.target.value
      setSearchText(nextSearchText)
      triggerSearchChange(nextSearchText)
    },
    [triggerSearchChange]
  )

  const listHeight = useMemo(() => {
    return Math.min(ctx.pageSize, list.length) * ITEM_HEIGHT
  }, [ctx.pageSize, list.length])
  const hasSearchText = useMemo(() => searchText.length > 0, [searchText])
  // 折叠仅依据“非固定项”的匹配数；仅剩固定项（如“清除”）时仍视为无匹配，保持折叠
  const visibleNonPinnedCount = useMemo(() => list.filter((i) => !i.alwaysVisible).length, [list])
  const collapsed = !ctx.manageListExternally && hasSearchText && visibleNonPinnedCount === 0

  const estimateSize = useCallback(() => ITEM_HEIGHT, [])

  const rowRenderer = useCallback(
    (item: QuickPanelListItem, itemIndex: number) => {
      if (!item) return null

      return (
        <div
          className={classNames(
            'mx-[5px] mb-px flex h-[30px] items-center justify-between gap-5 rounded-md p-[5px] transition-colors duration-100',
            item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-accent',
            item.isSelected && 'bg-primary/15',
            item.isSelected && itemIndex === index && 'bg-primary/20',
            item.isSelected && !item.disabled && 'hover:bg-primary/20',
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
      style={{ maxHeight: ctx.isVisible && !collapsed ? ctx.pageSize * ITEM_HEIGHT + 138 : 0 }}
      className={classNames(
        '-translate-y-full pointer-events-none absolute top-px right-0 left-0 w-full origin-bottom overflow-hidden px-[35px] transition-[max-height] duration-200 ease-in-out',
        ctx.isVisible && 'visible',
        ctx.isVisible && !collapsed && 'pointer-events-auto'
      )}
      data-testid="quick-panel">
      <div
        ref={bodyRef}
        className="before:-z-10 relative isolate rounded-t-lg border-border/60 border-x-[0.5px] border-t-[0.5px] py-[5px] before:absolute before:inset-0 before:rounded-[inherit] before:bg-popover/80 before:backdrop-blur-[35px] before:backdrop-saturate-150 before:content-[''] [&::-webkit-scrollbar]:w-[3px]"
        onKeyDown={handlePanelKeyDown}
        onKeyUp={handlePanelKeyUp}
        onMouseMove={() =>
          setIsMouseOver((prev) => {
            scrollTriggerRef.current = 'initial'
            return prev ? prev : true
          })
        }>
        <div className="px-2 pb-1">
          <Input
            ref={searchInputRef}
            value={_searchText}
            placeholder={t('common.search')}
            className="h-8 rounded-md border-border/60 bg-background/70 text-xs shadow-none focus-visible:ring-1"
            onChange={handleSearchTextChange}
          />
        </div>
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
        <div ref={footerRef} className="flex w-full items-center justify-between gap-4 px-3 pt-2 pb-[5px]">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted-foreground">
            {ctx.title || ''}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-4 text-[12px] text-muted-foreground">
            <span>ESC {t('settings.quickPanel.close')}</span>

            <Flex className="items-center gap-1">▲▼ {t('settings.quickPanel.select')}</Flex>

            {footerWidth >= 500 && (
              <>
                <Flex className="items-center gap-1">
                  <span className={isAssistiveKeyPressed ? 'text-primary' : 'text-muted-foreground'}>
                    {ASSISTIVE_KEY}
                  </span>
                  + ▲▼ {t('settings.quickPanel.page')}
                </Flex>

                {canForwardAndBackward && (
                  <Flex className="items-center gap-1">
                    <span className={isAssistiveKeyPressed ? 'text-primary' : 'text-muted-foreground'}>
                      {ASSISTIVE_KEY}
                    </span>
                    + ◀︎▶︎ {t('settings.quickPanel.back')}/{t('settings.quickPanel.forward')}
                  </Flex>
                )}
              </>
            )}

            <Flex className="items-center gap-1">↩︎ {t('settings.quickPanel.confirm')}</Flex>
          </div>
        </div>
      </div>
    </div>
  )
}
