import type { HTMLAttributes, ReactNode } from 'react'

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Shared frosted-glass surface used by every floating HUD region
 * (top bar, sidebars, toolbar, view switcher). Keeping the treatment
 * in one place is what makes the whole shell read as one design system.
 */
export default function GlassPanel({ children, className = '', ...rest }: GlassPanelProps) {
  return (
    <div
      className={`rounded-2xl border border-glass-border bg-glass shadow-glass backdrop-blur-xl ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
