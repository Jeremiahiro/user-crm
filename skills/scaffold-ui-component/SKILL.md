---
name: scaffold-ui-component
description: >
  Generates a design-system-compliant UI component for the 100BMOL Member Portal. Use this
  skill when creating any reusable component — buttons, badges, cards, inputs, modals, tables,
  avatars, empty states, stat cards, or any shared UI element. The skill enforces design tokens,
  CVA variant patterns, and TypeScript prop interfaces automatically. Trigger for requests like
  "create a Button component", "build a StatusBadge", "make a reusable MemberCard", "add a
  Modal component", or "I need a component for X".
---

# Scaffold UI Component — 100BMOL Portal

You are creating a reusable UI component for the **100 Black Men of London Member Portal**.
Components live in `src/components/ui/` and must follow `docs/DESIGN_SYSTEM.md` exactly.

## Core rules (non-negotiable)

- **No hardcoded hex values** — use Tailwind design tokens only (`text-brand-navy`, `bg-brand-gold`, `border-neutral-300`, etc.)
- **No `any` types** — explicit TypeScript interfaces for all props
- **Variants via CVA** — use `class-variance-authority` for any component with multiple visual states
- **Accessible** — all interactive elements have focus states; icons are `aria-hidden` when decorative

## Component types and patterns

### Astro component (.astro) — for non-interactive UI

Use for: Badge, Card, Avatar, StatCard, EmptyState, Input, Select

```astro
---
// src/components/ui/Badge.astro
interface Props {
  variant: 'active' | 'inactive' | 'applicant' | 'pending' | 'alumni' | 'volunteer'
  class?: string
}

const { variant, class: className } = Astro.props

const styles = {
  active:    'bg-success-50 text-success-600',
  inactive:  'bg-neutral-100 text-neutral-700',
  applicant: 'bg-blue-50 text-blue-700',
  pending:   'bg-warning-50 text-yellow-800',
  alumni:    'bg-purple-50 text-purple-700',
  volunteer: 'bg-emerald-50 text-emerald-800',
} as const
---

<span class:list={[
  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
  styles[variant],
  className
]}>
  <slot />
</span>
```

### React/TSX component (.tsx) — for interactive UI

Use for: Modal, Dropdown, Tabs, Toast, interactive forms

```tsx
// src/components/ui/Modal.tsx
import { useEffect, useRef } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Modal */}
      <div
        ref={ref}
        className={`relative bg-white rounded-xl shadow-lg w-full mx-4 ${sizeClasses[size]}`}
      >
        <div className="flex items-center justify-between p-6 border-b border-neutral-100">
          <h2 id="modal-title" className="font-heading text-xl font-semibold text-brand-navy">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900 transition-colors"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
```

## Design system token reference

### Colours (Tailwind utilities)
| Purpose | Class |
|---|---|
| Primary text | `text-brand-navy` |
| Accent | `text-brand-gold` / `bg-brand-gold` |
| Body text | `text-neutral-900` |
| Secondary text | `text-neutral-700` |
| Placeholder | `text-neutral-500` |
| Borders | `border-neutral-300` |
| Subtle bg | `bg-neutral-100` |
| Page bg | `bg-neutral-50` |
| Success | `text-success-600` / `bg-success-50` |
| Warning | `text-warning-600` / `bg-warning-50` |
| Danger | `text-danger-600` / `bg-danger-50` |
| Info | `text-info-600` / `bg-info-50` |

### Typography
- Headings: `font-heading font-bold` or `font-semibold`
- Body: `font-body` (default, no class needed)
- IDs/codes: `font-mono`

### Spacing
Always multiples of 4: `p-1`(4px) `p-2`(8px) `p-3`(12px) `p-4`(16px) `p-6`(24px) `p-8`(32px)

### Border radius
`rounded-sm`(4px) `rounded-md`(8px) `rounded-lg`(12px) `rounded-xl`(16px) `rounded-full`

### Shadows
`shadow-sm` `shadow-md` `shadow-lg`

## CVA variant pattern (for components with multiple styles)

```tsx
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  // Base styles always applied
  'inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:   'bg-brand-navy text-white hover:bg-brand-navy-light',
        accent:    'bg-brand-gold text-neutral-950 hover:bg-brand-gold-light',
        secondary: 'bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-100',
        ghost:     'text-neutral-700 hover:bg-neutral-100',
        danger:    'bg-danger-600 text-white hover:bg-red-700',
      },
      size: {
        sm: 'h-8 px-3 text-sm rounded-md',
        md: 'h-10 px-4 text-sm rounded-md',
        lg: 'h-12 px-6 text-base rounded-md',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

interface ButtonProps extends VariantProps<typeof buttonVariants> {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  href?: string
}
```

## Common components reference

### Button
Props: `variant` (primary|accent|secondary|ghost|danger), `size` (sm|md|lg), `disabled`, `href` (renders as `<a>`), `type`

### Badge  
Props: `variant` (active|inactive|applicant|pending|alumni|volunteer)

### Card
Props: `class?` — optional left accent via `accentColor` prop for stat cards

### Avatar
Props: `name` (string → extracts initials), `src?` (photo URL), `size` (sm=24|md=32|lg=40|xl=64|2xl=96)
Fallback: initials on `bg-brand-gold text-brand-navy`

### Input / Select
Props: `label`, `name`, `type?`, `placeholder?`, `value?`, `error?`, `helperText?`, `required?`
Focus ring: `focus:ring-2 focus:ring-brand-gold focus:border-brand-gold`

### StatCard
Props: `value` (string|number), `label`, `accentColor?` (default `brand-gold`)
Left border accent: `border-l-4`

### EmptyState
Props: `heading`, `subtext`, slot for CTA button
Centred layout, neutral icon (use Lucide), heading in `text-brand-navy`
