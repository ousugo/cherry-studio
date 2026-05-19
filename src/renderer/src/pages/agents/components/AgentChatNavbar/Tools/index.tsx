import ArtifactPaneToggleButton from './ArtifactPaneToggleButton'

interface Props {
  artifactPaneOpen: boolean
  onToggleArtifactPane: () => void
}

const Tools = ({ artifactPaneOpen, onToggleArtifactPane }: Props) => {
  return (
    <div className="flex items-center gap-0.5">
      <ArtifactPaneToggleButton open={artifactPaneOpen} onToggle={onToggleArtifactPane} />
      {/* TODO: Add search button back when global search supports agent messages */}
    </div>
  )
}

export default Tools
