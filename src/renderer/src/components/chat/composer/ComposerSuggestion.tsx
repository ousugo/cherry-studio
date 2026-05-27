import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { loggerService } from '@logger'
import {
  firstQuickPanelSelectableIndex,
  moveQuickPanelSelectableIndex,
  QuickPanelFooter,
  QuickPanelFrame,
  QuickPanelList,
  toggleQuickPanelSelectedId
} from '@renderer/components/QuickPanel/list'
import { isMac } from '@renderer/config/constant'
import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { t } from 'i18next'
import type { ReactNode } from 'react'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('ComposerSuggestion')

export interface ComposerSuggestionItem {
  id: string
  label: ReactNode | string
  description?: ReactNode | string
  icon?: ReactNode | string
  filterText?: string
  selected?: boolean
  disabled?: boolean
  isMenu?: boolean
  suffix?: ReactNode | string
  hint?: ReactNode | string
  children?: ComposerSuggestionItem[]
  query?: string
  command: (options: { editor: Editor; range: Range; item: ComposerSuggestionItem; query: string }) => void
}

export interface ComposerSuggestionSource {
  pluginKey: string
  char: string
  allowSpaces?: boolean
  allowedPrefixes?: string[] | null
  startOfLine?: boolean
  renderMode?: 'list' | 'headless'
  multiple?: boolean
  pageSize?: number
  title?: ReactNode | string
  keepOpenOnSelect?: boolean
  onActiveChange?: (options: ComposerSuggestionActiveChangeOptions) => void
  onExit?: (options: ComposerSuggestionActiveChangeOptions) => void
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean
  items: (options: { query: string; editor: Editor }) => ComposerSuggestionItem[] | Promise<ComposerSuggestionItem[]>
}

export interface ComposerSuggestionActiveChangeOptions {
  editor: Editor
  range: Range
  query: string
  text: string
  items: ComposerSuggestionItem[]
}

interface ComposerSuggestionListProps extends SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem> {
  ref?: React.RefObject<ComposerSuggestionListRef | null>
  multiple?: boolean
  pageSize?: number
  title?: ReactNode | string
  keepOpenOnSelect?: boolean
  onStickyOpenChange?: (open: boolean) => void
  onRequestClose?: () => void
}

interface ComposerSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const ComposerSuggestionList = ({ ref, ...props }: ComposerSuggestionListProps) => {
  const {
    command: runSuggestionCommand,
    editor,
    items,
    keepOpenOnSelect,
    multiple,
    onRequestClose,
    onStickyOpenChange,
    pageSize = 7,
    query,
    range,
    title
  } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerClearedRef = useRef(false)
  const [isStickyOpen, setIsStickyOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((item) => item.selected).map((item) => item.id))
  )
  const itemsWithSelection = useMemo(
    () => items.map((item) => ({ ...item, selected: selectedIds.has(item.id) })),
    [items, selectedIds]
  )
  const [selectedIndex, setSelectedIndex] = useState(() => firstQuickPanelSelectableIndex(itemsWithSelection))

  const selectDirectItem = useCallback(
    (item: ComposerSuggestionItem) => {
      if (!item || item.disabled) return false

      if (multiple && keepOpenOnSelect) {
        setIsStickyOpen(true)
        onStickyOpenChange?.(true)
        setSelectedIds((currentIds) => toggleQuickPanelSelectedId(currentIds, item.id))

        if (!triggerClearedRef.current) {
          editor.chain().focus().deleteRange(range).run()
          triggerClearedRef.current = true
        } else {
          editor.commands.focus()
        }

        item.command({ editor, range, item, query: query ?? '' })
        return true
      }

      runSuggestionCommand(item)
      return true
    },
    [editor, keepOpenOnSelect, multiple, onStickyOpenChange, query, range, runSuggestionCommand]
  )

  useEffect(() => {
    setSelectedIds(new Set(items.filter((item) => item.selected).map((item) => item.id)))
    setSelectedIndex(firstQuickPanelSelectableIndex(items))
  }, [items])

  const closeStickyPanel = useCallback(() => {
    setIsStickyOpen(false)
    onStickyOpenChange?.(false)
    onRequestClose?.()
  }, [onRequestClose, onStickyOpenChange])

  const selectItem = useCallback(
    (index: number) => {
      const item = itemsWithSelection[index]
      if (!item || item.disabled) return false

      return selectDirectItem(item)
    },
    [itemsWithSelection, selectDirectItem]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.isComposing) return false

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          setSelectedIndex((current) => moveQuickPanelSelectableIndex(itemsWithSelection, current, -1, { wrap: true }))
          return true
        case 'ArrowDown':
          event.preventDefault()
          setSelectedIndex((current) => moveQuickPanelSelectableIndex(itemsWithSelection, current, 1, { wrap: true }))
          return true
        case 'PageUp':
          event.preventDefault()
          setSelectedIndex((current) =>
            moveQuickPanelSelectableIndex(itemsWithSelection, current, -pageSize, { wrap: false })
          )
          return true
        case 'PageDown':
          event.preventDefault()
          setSelectedIndex((current) =>
            moveQuickPanelSelectableIndex(itemsWithSelection, current, pageSize, { wrap: false })
          )
          return true
        case 'Tab':
        case 'Enter':
          if (event.key === 'Enter' && event.shiftKey) return false
          event.preventDefault()
          event.stopPropagation()
          selectItem(selectedIndex)
          return true
        case 'Escape':
          event.preventDefault()
          if (isStickyOpen) {
            event.stopPropagation()
            closeStickyPanel()
          }
          return true
        default:
          return false
      }
    },
    [closeStickyPanel, isStickyOpen, itemsWithSelection, pageSize, selectItem, selectedIndex]
  )

  useImperativeHandle(ref, () => ({ onKeyDown: handleKeyDown }), [handleKeyDown])

  useEffect(() => {
    if (!isStickyOpen) return

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const handled = handleKeyDown(event)
      if (handled) {
        event.stopPropagation()
        return
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key.length === 1 || event.key === 'Backspace')) {
        closeStickyPanel()
      }
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      closeStickyPanel()
    }

    document.addEventListener('keydown', handleDocumentKeyDown, true)
    document.addEventListener('pointerdown', handleDocumentPointerDown, true)

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
    }
  }, [closeStickyPanel, handleKeyDown, isStickyOpen])

  const visibleItems = useMemo(
    () =>
      itemsWithSelection.flatMap((item, sourceIndex) =>
        !item.disabled || item.description || item.hint || item.children?.length ? [{ ...item, sourceIndex }] : []
      ),
    [itemsWithSelection]
  )
  const visibleSelectedIndex = visibleItems.findIndex((item) => item.sourceIndex === selectedIndex)

  return (
    <div ref={rootRef}>
      <QuickPanelFrame className="w-full rounded-t-lg border-border/60 bg-popover/80 shadow-lg backdrop-blur-[35px] backdrop-saturate-150">
        <QuickPanelList
          activeIndex={visibleSelectedIndex}
          emptyLabel={t('settings.quickPanel.noResult', 'No results')}
          items={visibleItems}
          onSelect={(item) => {
            selectItem(item.sourceIndex)
          }}
        />
        <QuickPanelFooter
          title={title}
          assistiveKey={isMac ? '⌘' : 'Ctrl'}
          showPageHint={visibleItems.length > pageSize}
          confirmLabel={multiple ? t('settings.quickPanel.multiple') : undefined}
        />
      </QuickPanelFrame>
    </div>
  )
}

function getComposerSuggestionAnchor(editor: Editor) {
  return editor.view.dom.closest('.inputbar') ?? editor.view.dom.closest('#inputbar')
}

function getSuggestionReference(props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) {
  const composerAnchor = getComposerSuggestionAnchor(props.editor)
  if (composerAnchor) return composerAnchor

  return {
    getBoundingClientRect: () => props.clientRect?.() ?? new DOMRect()
  }
}

function updateSuggestionPosition(
  props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>,
  element: HTMLElement
) {
  return computePosition(getSuggestionReference(props), element, {
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [
      offset(0),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements, rects }) {
          elements.floating.style.width = `${rects.reference.width}px`
          elements.floating.style.maxHeight = `${Math.min(360, Math.max(160, availableHeight))}px`
        }
      })
    ]
  }).then(({ x, y }) => {
    Object.assign(element.style, {
      left: `${x}px`,
      top: `${y}px`,
      position: 'fixed'
    })
  })
}

function createSuggestionRender(source: ComposerSuggestionSource) {
  if (source.renderMode === 'headless') {
    const notifyActiveChange = (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      source.onActiveChange?.({
        editor: props.editor,
        range: props.range,
        query: props.query,
        text: props.text,
        items: props.items
      })
    }

    return {
      onStart: notifyActiveChange,
      onUpdate: notifyActiveChange,
      onExit: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
        source.onExit?.({
          editor: props.editor,
          range: props.range,
          query: props.query,
          text: props.text,
          items: props.items
        })
      },
      onKeyDown: (props: SuggestionKeyDownProps) => source.onKeyDown?.(props) ?? false
    }
  }

  let component: ReactRenderer<ComposerSuggestionListRef, ComposerSuggestionListProps> | undefined
  let cleanup: (() => void) | undefined
  let stickyOpen = false

  const listProps = (
    props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>
  ): ComposerSuggestionListProps => ({
    ...props,
    keepOpenOnSelect: source.keepOpenOnSelect,
    multiple: source.multiple,
    pageSize: source.pageSize,
    title: source.title,
    onStickyOpenChange: (open) => {
      stickyOpen = open
      if (open && cleanup) {
        cleanup()
        cleanup = undefined
      }
    },
    onRequestClose: () => {
      stickyOpen = false
      cleanup?.()
      const element = component?.element as HTMLElement | undefined
      element?.remove()
      component?.destroy()
      component = undefined
      cleanup = undefined
    }
  })

  return {
    onStart: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      component = new ReactRenderer(ComposerSuggestionList, {
        props: listProps(props),
        editor: props.editor
      })

      const element = component.element as HTMLElement
      element.style.position = 'fixed'
      element.style.zIndex = '1001'
      document.body.appendChild(element)

      cleanup = autoUpdate(getSuggestionReference(props), element, () => {
        void updateSuggestionPosition(props, element)
      })

      void updateSuggestionPosition(props, element)
    },

    onUpdate: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      component?.updateProps(listProps(props))
      const element = component?.element as HTMLElement | undefined
      if (element) {
        void updateSuggestionPosition(props, element)
      }
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      const handled = component?.ref?.onKeyDown(props.event) ?? false
      if (handled && props.event.key === 'Escape') {
        cleanup?.()
        const element = component?.element as HTMLElement | undefined
        element?.remove()
        component?.destroy()
        component = undefined
        cleanup = undefined
      }
      return handled
    },

    onExit: () => {
      if (stickyOpen) {
        cleanup?.()
        cleanup = undefined
        return
      }

      cleanup?.()
      const element = component?.element as HTMLElement | undefined
      element?.remove()
      component?.destroy()
      component = undefined
      cleanup = undefined
    }
  }
}

function hasTriggerBoundary(editor: Editor, range: Range) {
  if (range.from <= 1) return true
  const before = editor.state.doc.textBetween(Math.max(0, range.from - 1), range.from, '\n', '')
  return before.length === 0 || /\s/.test(before)
}

export function createComposerSuggestionExtension(sources: readonly ComposerSuggestionSource[]) {
  return Extension.create({
    name: 'composerSuggestion',

    addProseMirrorPlugins() {
      return sources.map((source) => {
        return Suggestion<ComposerSuggestionItem, ComposerSuggestionItem>({
          editor: this.editor,
          pluginKey: new PluginKey(source.pluginKey),
          char: source.char,
          allowSpaces: source.allowSpaces,
          allowedPrefixes: source.allowedPrefixes,
          startOfLine: source.startOfLine,
          allow: ({ editor, range }) => hasTriggerBoundary(editor, range),
          items: async ({ editor, query }) => {
            try {
              const items = await source.items({ editor, query })
              return items.map((item) => ({ ...item, query }))
            } catch (error) {
              logger.warn('Failed to load composer suggestion items', { error, pluginKey: source.pluginKey })
              return [
                {
                  id: `${source.pluginKey}:error`,
                  label: t('common.error'),
                  description: error instanceof Error ? error.message : String(error),
                  disabled: true,
                  command: () => undefined
                }
              ]
            }
          },
          command: ({ editor, range, props }) => {
            if (props.disabled) return
            editor.chain().focus().deleteRange(range).run()
            props.command({ editor, range, item: props, query: props.query ?? '' })
          },
          render: () => createSuggestionRender(source)
        })
      })
    }
  })
}
