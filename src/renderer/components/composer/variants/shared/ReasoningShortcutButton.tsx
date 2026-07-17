import { Button, Tooltip } from '@cherrystudio/ui'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { type QuickPanelInputAdapter, useOptionalQuickPanel } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils/style'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { COMPOSER_SEND_ACCESSORY_BUTTON_CLASS } from './ComposerControlScaffolding'

const HOVER_INTENT_DELAY_MS = 100
const COLLAPSED_BUTTON_WIDTH_PX = 30
const EXPANDED_BUTTON_MAX_WIDTH_PX = 128
const EXPANDED_BUTTON_HORIZONTAL_PADDING_PX = 16
const WHEEL_GESTURE_RESET_MS = 180
const WHEEL_STEP_THRESHOLD = 32

interface ReasoningShortcutButtonProps {
  disabled: boolean
  inputAdapter?: QuickPanelInputAdapter
  label: string
  launcher: ComposerToolLauncher
  onClick: () => void
  onExpansionOffsetChange?: (offset: number) => void
}

const wheelDeltaScale = (event: WheelEvent): number => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return 100
  return 1
}

export const ReasoningShortcutButton = ({
  disabled,
  inputAdapter,
  label,
  launcher,
  onClick,
  onExpansionOffsetChange
}: ReasoningShortcutButtonProps) => {
  const quickPanel = useOptionalQuickPanel()
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const boundaryAnimationRef = useRef<Animation | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelDeltaRef = useRef(0)
  const wheelDirectionRef = useRef<-1 | 1 | null>(null)
  const wheelIndexRef = useRef<number | null>(null)
  const wheelStepConsumedRef = useRef(false)
  const boundaryFeedbackPlayedRef = useRef(false)
  const lastSuccessfulWheelDirectionRef = useRef<-1 | 1>(1)
  const [hoverExpanded, setHoverExpanded] = useState(false)
  const [focused, setFocused] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  const expanded = !disabled && (hoverExpanded || focused)
  const suffix = launcher.suffix
  const accessibleLabel = typeof suffix === 'string' ? `${label}: ${suffix}` : label
  const wheelOptions = useMemo(
    () =>
      launcher.submenu?.filter(
        (option) => !option.hidden && (option.active || (!option.disabled && option.action !== undefined))
      ) ?? [],
    [launcher.submenu]
  )
  const activeWheelIndex = wheelOptions.findIndex((option) => option.active)
  const visualKey = `${wheelOptions[activeWheelIndex]?.id ?? launcher.id}:${String(suffix ?? '')}`
  const wheelActionOptions = useMemo(
    () => (quickPanel ? { inputAdapter, quickPanel, source: 'popover' as const } : null),
    [inputAdapter, quickPanel]
  )

  useLayoutEffect(() => {
    const visual = buttonRef.current?.firstElementChild
    const expandedWidth =
      expanded && visual instanceof HTMLElement
        ? Math.min(
            EXPANDED_BUTTON_MAX_WIDTH_PX,
            Math.max(COLLAPSED_BUTTON_WIDTH_PX, visual.scrollWidth + EXPANDED_BUTTON_HORIZONTAL_PADDING_PX)
          )
        : COLLAPSED_BUTTON_WIDTH_PX
    onExpansionOffsetChange?.((expandedWidth - COLLAPSED_BUTTON_WIDTH_PX) / 2)
  }, [expanded, onExpansionOffsetChange])

  useEffect(() => () => onExpansionOffsetChange?.(0), [onExpansionOffsetChange])

  const resetWheelGesture = useCallback(() => {
    if (wheelResetTimerRef.current) clearTimeout(wheelResetTimerRef.current)
    wheelResetTimerRef.current = null
    wheelDeltaRef.current = 0
    wheelDirectionRef.current = null
    wheelIndexRef.current = null
    wheelStepConsumedRef.current = false
    boundaryFeedbackPlayedRef.current = false
  }, [])

  const scheduleWheelGestureReset = useCallback(() => {
    if (wheelResetTimerRef.current) clearTimeout(wheelResetTimerRef.current)
    wheelResetTimerRef.current = setTimeout(resetWheelGesture, WHEEL_GESTURE_RESET_MS)
  }, [resetWheelGesture])

  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      boundaryAnimationRef.current?.cancel()
      resetWheelGesture()
    },
    [resetWheelGesture]
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !expanded || disabled || !wheelActionOptions) return

      const scaledDelta = event.deltaY * wheelDeltaScale(event)
      if (scaledDelta === 0) return
      setTooltipOpen(false)

      const direction = scaledDelta < 0 ? -1 : 1
      const currentIndex = wheelIndexRef.current ?? activeWheelIndex
      const targetIndex = currentIndex < 0 ? 0 : currentIndex + direction
      const target = wheelOptions[targetIndex]
      if (!target?.action) {
        if (!boundaryFeedbackPlayedRef.current) {
          boundaryFeedbackPlayedRef.current = true
          boundaryAnimationRef.current?.cancel()
          boundaryAnimationRef.current = (event.currentTarget as HTMLButtonElement).animate(
            reduceMotion
              ? [{ opacity: 1 }, { offset: 0.5, opacity: 0.72 }, { opacity: 1 }]
              : [
                  { transform: 'translateY(0px)' },
                  { offset: 0.3, transform: `translateY(${6 * direction}px)` },
                  { offset: 0.72, transform: `translateY(${-1.5 * direction}px)` },
                  { transform: 'translateY(0px)' }
                ],
            reduceMotion
              ? { duration: 100, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
              : { duration: 220, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' }
          )
        }
        scheduleWheelGestureReset()
        return
      }

      if (wheelDirectionRef.current !== null && wheelDirectionRef.current !== direction) {
        wheelDeltaRef.current = 0
        wheelStepConsumedRef.current = false
      }
      wheelDirectionRef.current = direction
      event.preventDefault()

      scheduleWheelGestureReset()
      if (wheelStepConsumedRef.current) return

      wheelDeltaRef.current += scaledDelta
      if (Math.abs(wheelDeltaRef.current) < WHEEL_STEP_THRESHOLD) return

      wheelDeltaRef.current = 0
      wheelStepConsumedRef.current = true
      lastSuccessfulWheelDirectionRef.current = direction
      target.action(wheelActionOptions)
      wheelIndexRef.current = targetIndex
    },
    [activeWheelIndex, disabled, expanded, reduceMotion, scheduleWheelGestureReset, wheelActionOptions, wheelOptions]
  )

  useEffect(() => {
    const button = buttonRef.current
    if (!button) return

    button.addEventListener('wheel', handleWheel, { passive: false })
    return () => button.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const levelCardVariants = useMemo(() => {
    const cardTransition = { duration: 0.3, type: 'spring', bounce: 0 } as const
    const enterTransition = reduceMotion ? { duration: 0.1, ease: [0.23, 1, 0.32, 1] as const } : cardTransition
    const exitTransition = reduceMotion ? { duration: 0.08, ease: [0.23, 1, 0.32, 1] as const } : cardTransition

    return {
      initial: (direction: -1 | 1) => ({
        opacity: reduceMotion ? 0 : 1,
        transform: reduceMotion
          ? 'translateY(0%) rotateX(0deg) scale(1)'
          : `translateY(${110 * direction}%) rotateX(${-14 * direction}deg) scale(0.96)`,
        transition: enterTransition
      }),
      animate: {
        opacity: 1,
        transform: 'translateY(0%) rotateX(0deg) scale(1)',
        transition: enterTransition
      },
      exit: (direction: -1 | 1) => ({
        opacity: reduceMotion ? 0 : 1,
        transform: reduceMotion
          ? 'translateY(0%) rotateX(0deg) scale(1)'
          : `translateY(${-110 * direction}%) rotateX(${14 * direction}deg) scale(0.96)`,
        transition: exitTransition
      })
    } satisfies Variants
  }, [reduceMotion])

  const button = (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        COMPOSER_SEND_ACCESSORY_BUTTON_CLASS,
        'h-7.5 w-auto min-w-7.5 max-w-7.5 justify-start gap-0 overflow-hidden px-1.5 transition-[max-width,padding,gap] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
        'data-[expanded=true]:max-w-32 data-[expanded=true]:gap-1.5 data-[expanded=true]:px-2 data-[expanded=true]:duration-200',
        launcher.active && 'bg-accent'
      )}
      aria-label={accessibleLabel}
      aria-haspopup="menu"
      disabled={disabled}
      data-active={launcher.active || undefined}
      data-expanded={expanded}
      onBlur={() => setFocused(false)}
      onClick={onClick}
      onFocus={() => setFocused(true)}
      onMouseEnter={() => {
        if (disabled) return
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), HOVER_INTENT_DELAY_MS)
      }}
      onMouseLeave={() => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
        resetWheelGesture()
        setHoverExpanded(false)
      }}>
      <span className="relative flex min-w-0 items-center">
        <span aria-hidden className="invisible flex min-w-0 items-center gap-1.5">
          <span className="size-[18px] shrink-0" />
          {suffix ? (
            <span className="grid min-w-0 max-w-24">
              {(wheelOptions.length > 0 ? wheelOptions : [{ id: visualKey, label: suffix }]).map((option) => (
                <span key={option.id} className="col-start-1 row-start-1 truncate whitespace-nowrap">
                  {option.label}
                </span>
              ))}
            </span>
          ) : null}
        </span>

        <span className="absolute inset-0 overflow-hidden [perspective:240px]">
          <AnimatePresence custom={lastSuccessfulWheelDirectionRef.current} initial={false}>
            <motion.span
              key={visualKey}
              custom={lastSuccessfulWheelDirectionRef.current}
              variants={levelCardVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute inset-0 flex min-w-0 items-center gap-1.5">
              <span className="flex size-[18px] shrink-0 items-center justify-center">{launcher.icon}</span>
              {suffix ? (
                <span
                  aria-hidden
                  className={cn(
                    'min-w-0 flex-1 truncate whitespace-nowrap opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                    expanded && 'opacity-100 duration-200'
                  )}>
                  {suffix}
                </span>
              ) : null}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
    </Button>
  )

  const tooltip = disabled ? launcher.disabledReason : t('assistants.settings.reasoning_effort.wheel_switch_hint')
  return tooltip === undefined || tooltip === null ? (
    button
  ) : (
    <Tooltip content={tooltip} placement="top" isOpen={tooltipOpen} onOpenChange={setTooltipOpen}>
      {button}
    </Tooltip>
  )
}
