// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ProviderListItemWithContextMenu from '../ProviderListItemWithContextMenu'

vi.mock('@cherrystudio/ui', () => ({
  MenuItem: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/i18n/label', () => ({ getProviderLabel: (id: string) => id }))
vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => <span data-testid="provider-avatar" />
}))
vi.mock('@renderer/pages/settings/ProviderSettings/ModelNotesPopup', () => ({
  default: { show: vi.fn() }
}))
vi.mock('@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives', () => ({
  providerListClasses: new Proxy({}, { get: () => '' })
}))
vi.mock('@renderer/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

const provider = {
  id: 'openai',
  name: 'OpenAI',
  presetProviderId: 'openai',
  apiKeys: [],
  authType: 'api-key',
  apiFeatures: {},
  settings: {},
  isEnabled: true
} as unknown as Provider

describe('ProviderListItemWithContextMenu', () => {
  it('opens the provider menu from a row context menu without mounting CommandContextMenu', () => {
    const onContextOpenChange = vi.fn()

    render(
      <ProviderListItemWithContextMenu
        provider={provider}
        selected={false}
        contextOpen={false}
        onContextOpenChange={onContextOpenChange}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        showManagementActions
        listState={{ dragging: false }}
        onSetListItemRef={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByTestId('provider-list-item-openai'))

    expect(onContextOpenChange).toHaveBeenCalledWith(true)
  })
})
