import React from 'react'

interface PlaceholderBlockProps {
  isProcessing: boolean
}

function useElapsedMs(isProcessing: boolean): number {
  const startedAtRef = React.useRef(Date.now())
  const [elapsedMs, setElapsedMs] = React.useState(0)

  React.useEffect(() => {
    if (!isProcessing) return

    const updateElapsed = () => setElapsedMs(Math.max(0, Date.now() - startedAtRef.current))
    updateElapsed()

    const timer = setInterval(updateElapsed, 100)
    return () => clearInterval(timer)
  }, [isProcessing])

  return elapsedMs
}

const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ isProcessing }) => {
  const elapsedMs = useElapsedMs(isProcessing)

  if (isProcessing) {
    const seconds = (elapsedMs / 1000).toFixed(1)

    return (
      <div
        className="-mt-1.25 mb-1.25 flex h-8 flex-row items-center gap-2 text-[12px] text-muted-foreground/75 leading-4"
        data-testid="message-status-placeholder">
        <span aria-hidden="true" className="relative flex size-2.5 items-center justify-center rounded-full">
          <span className="size-2 rounded-full bg-foreground/75" />
          <span className="absolute size-2.5 rounded-full bg-foreground/35 motion-safe:animate-ping" />
        </span>
        <span>{seconds}s</span>
      </div>
    )
  }
  return null
}
export default React.memo(PlaceholderBlock)
