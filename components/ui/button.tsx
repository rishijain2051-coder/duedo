import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'glass';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]",
          {
            'bg-primary text-primary-foreground shadow hover:bg-primary/90': variant === 'default',
            'border border-border bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground': variant === 'outline',
            'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
            'glass hover:bg-white/10': variant === 'glass',
            // Every size is taller on a phone and returns to its desktop height
            // from sm up. 44px is the target the rest of the app already uses by
            // hand (`min-h-11` on the tab strips, `h-11 w-11` in the header); a
            // 32px "sm" button next to those was a coin-flip to hit, and these
            // include Approve, Reject and Delete.
            'h-11 px-4 py-2 sm:h-9': size === 'default',
            'h-10 rounded-md px-3 text-xs sm:h-8': size === 'sm',
            'h-12 rounded-md px-8 sm:h-10': size === 'lg',
            'h-11 w-11 sm:h-9 sm:w-9': size === 'icon',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
