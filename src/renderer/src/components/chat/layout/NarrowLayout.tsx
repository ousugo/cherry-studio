import { cn } from '@cherrystudio/ui/lib/utils'
import type { FC, HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  narrowMode?: boolean
}

const NarrowLayout: FC<Props> = ({ children, className, narrowMode = false, ...props }) => {
  return (
    <div
      className={cn(
        'narrow-mode relative mx-auto w-full transition-[max-width] duration-300 ease-in-out',
        narrowMode ? 'active max-w-[800px]' : 'max-w-full',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

export default NarrowLayout
