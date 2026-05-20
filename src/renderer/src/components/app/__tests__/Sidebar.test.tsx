import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AppSidebar from '../Sidebar'

const setSidebarWidthMock = vi.fn()
const updateTabMock = vi.fn()
const openTabMock = vi.fn()

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [0, setSidebarWidthMock]
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'ui.sidebar.icons.visible') return [['assistants']]
    if (key === 'app.user.name') return ['Tester']
    return [undefined]
  }
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'app-logo.png'
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => ''
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ defaultPaintingProvider: 'default' })
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabel: (icon: string) => icon
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (path: string) => path
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key })
}))

vi.mock('../../../hooks/useTabs', () => ({
  useTabs: () => ({
    activeTab: { id: 'tab-1', url: '/app/chat', isPinned: false },
    updateTab: updateTabMock,
    openTab: openTabMock
  })
}))

vi.mock('../../Popups/UserPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('../../Icons/SVGIcon', () => ({
  OpenClawSidebarIcon: () => null
}))

vi.mock('../../Sidebar', () => ({
  Sidebar: ({ isFloating, isFloatingClosing, onDismiss, onHoverChange }: any) =>
    isFloating ? (
      <div
        className={isFloatingClosing ? 'slide-out-to-left-2 animate-out' : 'slide-in-from-left-2 animate-in'}
        data-testid="floating-sidebar">
        <button type="button" onClick={onDismiss}>
          dismiss
        </button>
      </div>
    ) : (
      <button type="button" onClick={() => onHoverChange?.(true)}>
        reveal
      </button>
    )
}))

describe('App Sidebar', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('keeps the floating sidebar mounted for its closing animation before unmounting', () => {
    vi.useFakeTimers()
    render(<AppSidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'reveal' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-in', 'slide-in-from-left-2')

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-out', 'slide-out-to-left-2')

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByTestId('floating-sidebar')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
  })
})
