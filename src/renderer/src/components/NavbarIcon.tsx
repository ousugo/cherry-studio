import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps } from 'react'

type NavbarIconProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'>

const NavbarIcon = ({ className, type = 'button', ...props }: NavbarIconProps) => {
  return (
    <Button
      type={type}
      variant="ghost"
      size="icon-navbar"
      className={cn(
        '!text-foreground/70 duration-200 ease-in-out [-webkit-app-region:none] hover:bg-muted hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

export default NavbarIcon
