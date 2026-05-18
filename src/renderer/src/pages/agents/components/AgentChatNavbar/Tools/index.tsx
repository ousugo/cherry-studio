import NarrowLayoutToggleButton from '@renderer/components/chat/layout/NarrowLayoutToggleButton'

import ArtifactPaneToggleButton from './ArtifactPaneToggleButton'
import SettingsButton from './SettingsButton'

interface Props {
  onOpenSettings: () => void
  artifactPaneOpen: boolean
  onToggleArtifactPane: () => void
}

const Tools = ({ onOpenSettings, artifactPaneOpen, onToggleArtifactPane }: Props) => {
  return (
    <div className="flex items-center gap-2">
      <SettingsButton onOpenSettings={onOpenSettings} />
      <NarrowLayoutToggleButton />
      <ArtifactPaneToggleButton open={artifactPaneOpen} onToggle={onToggleArtifactPane} />
      {/* TODO: Add search button back when global search supports agent messages */}
    </div>
  )
}

export default Tools
