import { MenuItem, MenuList } from '@cherrystudio/ui'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { loggerService } from '@logger'
import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { posToDOMRect, ReactRenderer } from '@tiptap/react'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { t } from 'i18next'
import type { ReactNode } from 'react'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'

const logger = loggerService.withContext('ComposerSuggestion')

export interface ComposerSuggestionItem {
  id: string
  label: ReactNode | string
  description?: ReactNode | string
  icon?: ReactNode | string
  filterText?: string
  disabled?: boolean
  isMenu?: boolean
  query?: string
  command: (options: { editor: Editor; range: Range; item: ComposerSuggestionItem; query: string }) => void
}

export interface ComposerSuggestionSource {
  pluginKey: string
  char: string
  allowSpaces?: boolean
  allowedPrefixes?: string[] | null
  startOfLine?: boolean
  items: (options: { query: string; editor: Editor }) => ComposerSuggestionItem[] | Promise<ComposerSuggestionItem[]>
}

interface ComposerSuggestionListProps extends SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem> {
  ref?: React.RefObject<ComposerSuggestionListRef | null>
}

interface ComposerSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

function firstSelectableIndex(items: readonly ComposerSuggestionItem[]) {
  return items.findIndex((item) => !item.disabled)
}

function clampSelectableIndex(items: readonly ComposerSuggestionItem[], index: number, direction: 1 | -1) {
  if (items.length === 0) return -1

  let nextIndex = index
  for (let attempt = 0; attempt < items.length; attempt++) {
    nextIndex = (nextIndex + direction + items.length) % items.length
    if (!items[nextIndex]?.disabled) return nextIndex
  }

  return -1
}

const ComposerSuggestionList = ({ ref, ...props }: ComposerSuggestionListProps) => {
  const { command, items } = props
  const [selectedIndex, setSelectedIndex] = useState(() => firstSelectableIndex(items))

  useEffect(() => {
    setSelectedIndex(firstSelectableIndex(items))
  }, [items])

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item || item.disabled) return false
      command(item)
      return true
    },
    [command, items]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.isComposing) return false

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          setSelectedIndex((current) => clampSelectableIndex(items, current === -1 ? 0 : current, -1))
          return true
        case 'ArrowDown':
          event.preventDefault()
          setSelectedIndex((current) => clampSelectableIndex(items, current, 1))
          return true
        case 'PageUp':
          event.preventDefault()
          setSelectedIndex(firstSelectableIndex(items))
          return true
        case 'PageDown':
          event.preventDefault()
          setSelectedIndex(() => {
            for (let index = items.length - 1; index >= 0; index--) {
              if (!items[index]?.disabled) return index
            }
            return -1
          })
          return true
        case 'Tab':
        case 'Enter':
          if (event.key === 'Enter' && event.shiftKey) return false
          event.preventDefault()
          return selectItem(selectedIndex)
        case 'Escape':
          event.preventDefault()
          return true
        default:
          return false
      }
    },
    [items, selectItem, selectedIndex]
  )

  useImperativeHandle(ref, () => ({ onKeyDown: handleKeyDown }), [handleKeyDown])

  const visibleItems = useMemo(() => items.filter((item) => !item.disabled || item.description), [items])

  return (
    <div className="w-72 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
      <MenuList className="max-h-72 gap-1 overflow-y-auto">
        {visibleItems.length > 0 ? (
          visibleItems.map((item) => {
            const itemIndex = items.indexOf(item)
            return (
              <MenuItem
                key={item.id}
                icon={item.icon ? <span className="text-foreground-muted [&_svg]:size-4">{item.icon}</span> : undefined}
                label={String(item.label)}
                description={item.description ? String(item.description) : undefined}
                disabled={item.disabled}
                active={itemIndex === selectedIndex}
                suffix={item.isMenu ? <span className="text-foreground-muted">›</span> : undefined}
                onClick={() => selectItem(itemIndex)}
              />
            )
          })
        ) : (
          <MenuItem label={t('settings.quickPanel.noResult', 'No results')} disabled icon={undefined} />
        )}
      </MenuList>
    </div>
  )
}

function updateSuggestionPosition(
  props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>,
  element: HTMLElement
) {
  const getReferenceRect = props.clientRect
    ? props.clientRect
    : () => posToDOMRect(props.editor.view, props.range.from, props.range.to)

  const virtualElement = {
    getBoundingClientRect: () => getReferenceRect() ?? new DOMRect()
  }

  return computePosition(virtualElement, element, {
    placement: 'top-start',
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.min(360, Math.max(160, availableHeight))}px`
        }
      })
    ]
  }).then(({ x, y }) => {
    Object.assign(element.style, {
      left: `${x}px`,
      top: `${y}px`
    })
  })
}

function createSuggestionRender() {
  let component: ReactRenderer<ComposerSuggestionListRef, ComposerSuggestionListProps> | undefined
  let cleanup: (() => void) | undefined

  return {
    onStart: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      component = new ReactRenderer(ComposerSuggestionList, {
        props,
        editor: props.editor
      })

      const element = component.element as HTMLElement
      element.style.position = 'absolute'
      element.style.zIndex = '1001'
      document.body.appendChild(element)

      const getReferenceRect = props.clientRect
        ? props.clientRect
        : () => posToDOMRect(props.editor.view, props.range.from, props.range.to)
      const virtualElement = {
        getBoundingClientRect: () => getReferenceRect() ?? new DOMRect()
      }

      cleanup = autoUpdate(virtualElement, element, () => {
        void updateSuggestionPosition(props, element)
      })

      void updateSuggestionPosition(props, element)
    },

    onUpdate: (props: SuggestionProps<ComposerSuggestionItem, ComposerSuggestionItem>) => {
      component?.updateProps(props)
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
          render: createSuggestionRender
        })
      })
    }
  })
}
