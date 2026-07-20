# 100BMOL Member Portal — Design System

Version 1.0 · July 2026

---

## Brand Foundation

100 Black Men of London is a professional, civic organisation. The design language should feel **authoritative, trustworthy, and clean** — not corporate-cold, but structured and purposeful. Think: a well-run institution that respects its members' time.

---

## Colour Palette

### Brand Colours

| Token | Hex | Usage |
|---|---|---|
| `brand-navy` | `#1A1A2E` | Primary — headers, nav, primary buttons, key text |
| `brand-gold` | `#C9A84C` | Accent — highlights, active states, badges, CTAs |
| `brand-gold-light` | `#E8C97A` | Hover state for gold elements |
| `brand-navy-light` | `#2D2D4E` | Hover state for navy elements |

### Neutrals

| Token | Hex | Usage |
|---|---|---|
| `neutral-950` | `#0A0A0F` | Darkest text |
| `neutral-900` | `#111118` | Body text on light bg |
| `neutral-700` | `#3D3D50` | Secondary text, labels |
| `neutral-500` | `#6B6B80` | Placeholder, disabled text |
| `neutral-300` | `#B0B0C0` | Borders, dividers |
| `neutral-100` | `#F0F0F5` | Table rows, subtle backgrounds |
| `neutral-50` | `#F8F8FC` | Page background |
| `white` | `#FFFFFF` | Card surfaces, modals |

### Semantic Colours

| Token | Hex | Usage |
|---|---|---|
| `success-600` | `#16A34A` | Active status, success states |
| `success-50` | `#F0FDF4` | Success background tint |
| `warning-600` | `#D97706` | Expiring soon, pending review |
| `warning-50` | `#FFFBEB` | Warning background tint |
| `danger-600` | `#DC2626` | Errors, expired, destructive actions |
| `danger-50` | `#FFF1F2` | Error background tint |
| `info-600` | `#0284C7` | Informational states, links |
| `info-50` | `#F0F9FF` | Info background tint |

### Status Badge Colours (Member Lifecycle)

| Status | Background | Text |
|---|---|---|
| Active | `#F0FDF4` | `#16A34A` |
| Inactive | `#F3F4F6` | `#374151` |
| Applicant | `#EFF6FF` | `#1D4ED8` |
| Pending Review | `#FFFBEB` | `#92400E` |
| Alumni | `#FAF5FF` | `#7E22CE` |
| Volunteer | `#ECFDF5` | `#065F46` |

---

## Typography

### Fonts

**Heading:** [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans)
- Strong, modern geometric sans-serif
- Weights used: 600 (Semibold), 700 (Bold)
- Loaded via Google Fonts

**Body:** [Inter](https://fonts.google.com/specimen/Inter)
- Highly readable at small sizes
- Weights used: 400 (Regular), 500 (Medium), 600 (Semibold)
- Loaded via Google Fonts

**Mono:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)
- Used for: IDs, reference numbers, code, audit log entries
- Weight: 400

### Type Scale

| Token | Size | Line Height | Weight | Font | Usage |
|---|---|---|---|---|---|
| `display` | 36px | 1.2 | 700 | Jakarta | Page titles (rare) |
| `h1` | 28px | 1.25 | 700 | Jakarta | Dashboard section titles |
| `h2` | 22px | 1.3 | 600 | Jakarta | Card/panel headings |
| `h3` | 18px | 1.35 | 600 | Jakarta | Sub-section headings |
| `h4` | 15px | 1.4 | 600 | Jakarta | Form section labels, table column headers |
| `body-lg` | 16px | 1.6 | 400 | Inter | Primary body copy |
| `body` | 14px | 1.6 | 400 | Inter | Standard UI text |
| `body-sm` | 13px | 1.5 | 400 | Inter | Secondary info, helper text |
| `caption` | 11px | 1.4 | 500 | Inter | Timestamps, metadata, labels |
| `mono` | 13px | 1.5 | 400 | JetBrains | IDs, refs, audit entries |

---

## Spacing & Layout

### Base Unit
4px. All spacing is a multiple of 4.

### Spacing Scale

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Inline gap between icon and label |
| `space-2` | 8px | Compact padding, tight stacks |
| `space-3` | 12px | Form element padding |
| `space-4` | 16px | Standard card padding, list item gap |
| `space-5` | 20px | Section internal spacing |
| `space-6` | 24px | Between form fields |
| `space-8` | 32px | Between card sections |
| `space-10` | 40px | Between page sections |
| `space-12` | 48px | Page-level vertical rhythm |

### Layout Grid

| Breakpoint | Columns | Gutter | Max content width |
|---|---|---|---|
| Mobile (`< 640px`) | 4 | 16px | 100% |
| Tablet (`640–1024px`) | 8 | 24px | 100% |
| Desktop (`> 1024px`) | 12 | 24px | 1280px |

### Sidebar Layout (Dashboard)
- Sidebar width: 240px (fixed, collapsible on tablet)
- Main content: fluid, max 960px
- Top nav height: 60px

---

## Border Radius

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 4px | Small badges, checkboxes |
| `radius-md` | 8px | Input fields, small buttons |
| `radius-lg` | 12px | Cards, modals, dropdowns |
| `radius-xl` | 16px | Large panels |
| `radius-full` | 9999px | Pill badges, avatars |

---

## Shadows

| Token | Value | Usage |
|---|---|---|
| `shadow-sm` | `0 1px 3px rgba(0,0,0,0.08)` | Inputs on focus, subtle card lift |
| `shadow-md` | `0 4px 12px rgba(0,0,0,0.10)` | Cards, dropdowns |
| `shadow-lg` | `0 8px 24px rgba(0,0,0,0.12)` | Modals, drawers |

---

## Components

### Buttons

**Primary**
- Background: `brand-navy` · Text: white
- Hover: `brand-navy-light`
- Padding: `12px 20px` · Border radius: `radius-md`
- Font: `body` Semibold

**Accent**
- Background: `brand-gold` · Text: `neutral-950`
- Hover: `brand-gold-light`
- Used for the single most important CTA on a page

**Secondary (Outlined)**
- Border: `neutral-300` · Text: `neutral-900` · Background: white
- Hover: background `neutral-100`

**Ghost**
- No border, no background · Text: `neutral-700`
- Hover: background `neutral-100`
- Used for low-priority actions

**Danger**
- Background: `danger-600` · Text: white
- Used only for destructive, irreversible actions (archive, revoke)

**Disabled state (all)**
- Opacity: 40% · Cursor: not-allowed · No hover effect

**Sizes**

| Size | Height | Font size | Padding |
|---|---|---|---|
| `sm` | 32px | 13px | `6px 12px` |
| `md` (default) | 40px | 14px | `10px 18px` |
| `lg` | 48px | 16px | `12px 24px` |

---

### Form Inputs

- Height: 40px (default) · Border radius: `radius-md`
- Border: `1.5px solid neutral-300`
- Focus ring: `2px solid brand-gold` with `outline-offset: 2px`
- Placeholder colour: `neutral-500`
- Label: `body-sm` Semibold, `neutral-700`, 6px above input
- Helper text: `caption`, `neutral-500`, 4px below input
- Error state: border `danger-600`, helper text `danger-600`

**Textarea:** Same as input, min-height 96px, resize vertical only.

**Select:** Native select styled with custom chevron; same border/focus rules.

**Checkbox / Radio:**
- Size: 18px × 18px
- Checked: background `brand-navy`, white tick
- Focus: gold ring

---

### Cards

**Default card**
- Background: white · Border: `1.5px solid neutral-300` · Border radius: `radius-lg`
- Padding: `space-6`
- Shadow: `shadow-md` on hover

**Stat card** (dashboard KPIs)
- Left border accent: 4px solid `brand-gold` or semantic colour
- Number: `h1`, navy · Label: `caption`, `neutral-500`

**Alert card**
- Border and left accent coloured by semantic colour (success/warning/danger/info)
- Icon + title + description layout

---

### Badges / Status Pills

- Border radius: `radius-full`
- Padding: `2px 10px`
- Font: `caption` Semibold
- Use the Status Badge Colour table above
- Never use colour alone — always pair with text

---

### Tables

**Header row**
- Background: `neutral-100` · Font: `h4` · Text: `neutral-700` · Height: 44px
- Sticky on scroll

**Data rows**
- Height: 52px · Border-bottom: `1px solid neutral-100`
- Hover: background `neutral-50`
- Alternating rows: no (use hover only — alternating rows adds visual noise)

**Empty state:** Centred icon + heading + subtext + optional CTA button. No empty tables.

**Pagination:** Simple prev/next with page numbers. Show total count above table.

---

### Navigation

**Top nav (60px)**
- Background: `brand-navy`
- Logo left · Page title centre (desktop) · User avatar + name right
- Avatar: 32px circle, initials fallback on `brand-gold` background

**Sidebar (240px)**
- Background: white · Right border: `1px solid neutral-300`
- Nav items: `body` Medium, `neutral-700`, 40px height, `radius-md`, `space-2` horizontal margin
- Active item: background `neutral-100`, text `brand-navy`, left border 3px `brand-gold`
- Section labels: `caption`, `neutral-500`, uppercase, `space-3` top margin

---

### Modals

- Overlay: `rgba(0,0,0,0.4)` · Modal: white · Border radius: `radius-xl` · Shadow: `shadow-lg`
- Max width: 560px (default), 760px (wide), 95vw on mobile
- Header: title `h2` + close button (×)
- Footer: right-aligned actions (Cancel ghost · Confirm primary/danger)
- Escape key closes; clicking overlay closes (unless destructive action)

---

### Avatar

- Sizes: 24px (inline), 32px (nav), 40px (list), 64px (profile header), 96px (profile page)
- Shape: circle · `radius-full`
- Fallback: initials (first + last) on `brand-gold` background, `brand-navy` text

---

## Iconography

**Library:** [Lucide Icons](https://lucide.dev) — consistent stroke weight (1.5), clean and modern.

Key icons in use:

| Icon | Usage |
|---|---|
| `user` | Member profile |
| `users` | Team |
| `shield` | Roles & permissions |
| `award` | Awards |
| `star` | Praise |
| `calendar` | CMP sessions, dates |
| `file-text` | Documents |
| `check-circle` | Dues paid, active status |
| `alert-circle` | Expiring / warning |
| `x-circle` | Expired / error |
| `chevron-right` | Navigation, table expand |
| `log-out` | Sign out |
| `settings` | Admin settings |
| `vote` | Elected positions |
| `lock` | Permission / restricted |

Icons always paired with a label or tooltip — never icon-only for actions.

---

## Tailwind Theme (global.css)

```css
@import "tailwindcss";

@theme {
  /* Brand */
  --color-brand-navy: #1A1A2E;
  --color-brand-navy-light: #2D2D4E;
  --color-brand-gold: #C9A84C;
  --color-brand-gold-light: #E8C97A;

  /* Neutrals */
  --color-neutral-950: #0A0A0F;
  --color-neutral-900: #111118;
  --color-neutral-700: #3D3D50;
  --color-neutral-500: #6B6B80;
  --color-neutral-300: #B0B0C0;
  --color-neutral-100: #F0F0F5;
  --color-neutral-50:  #F8F8FC;

  /* Semantic */
  --color-success-600: #16A34A;
  --color-success-50:  #F0FDF4;
  --color-warning-600: #D97706;
  --color-warning-50:  #FFFBEB;
  --color-danger-600:  #DC2626;
  --color-danger-50:   #FFF1F2;
  --color-info-600:    #0284C7;
  --color-info-50:     #F0F9FF;

  /* Typography */
  --font-heading: 'Plus Jakarta Sans', sans-serif;
  --font-body:    'Inter', sans-serif;
  --font-mono:    'JetBrains Mono', monospace;

  /* Radius */
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.10);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
}
```

---

## Accessibility

- Minimum contrast ratio: **4.5:1** for body text, **3:1** for large text and UI components (WCAG 2.1 AA)
- All interactive elements have a visible focus indicator (gold ring)
- Error messages are always associated with the relevant input via `aria-describedby`
- Icons have `aria-hidden="true"` when decorative; labelled when functional
- Tables have proper `<thead>`, `<th scope>`, and `<caption>` where needed
- Modals trap focus and return focus to trigger on close
- All colour-coded statuses include text labels — never colour alone

---

## Tone & Writing Style

- **Direct and clear** — state what something is, not what it might be
- **Active voice** — "Member paid" not "Payment was recorded"
- **Consistent terminology** — use terms from the PRD throughout the UI (Member, Team, Pillar, Tenure, Elected Position — not "user", "group", "section", "period")
- **Empty states** — explain what the section does and offer a clear first action. No blank screens.
- **Error messages** — say what went wrong and what the user can do, not technical codes
- **Confirmation dialogs** — describe the consequence, not just "Are you sure?"
  - ✓ "Archive this role? Members already assigned will keep it. No new assignments can be made."
  - ✗ "Are you sure you want to archive?"
