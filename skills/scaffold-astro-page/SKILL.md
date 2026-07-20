---
name: scaffold-astro-page
description: >
  Scaffolds a complete, typed Astro page for the 100BMOL Member Portal. Use this skill whenever
  you need to create a new page in the portal — admin views, dashboard sections, public pages,
  or form pages. The skill applies the correct layout, auth guard, Supabase server-side data
  fetch, empty state, and TypeScript conventions automatically. Trigger for any request like
  "create a page for X", "add a route for Y", "build the Z list page", or "scaffold the
  members/[id] detail page".
---

# Scaffold Astro Page — 100BMOL Portal

You are creating a page for the **100 Black Men of London Member Portal**. Every page must follow
the conventions in `docs/FRAMEWORKS.md` and `docs/DESIGN_SYSTEM.md`.

## Step 1 — Gather requirements

Before writing code, confirm:
- **Route path** — e.g. `/admin/members`, `/dashboard`, `/admin/positions/[id]`
- **Layout** — `DashboardLayout` (authenticated pages) or `PublicLayout` (login, apply form)
- **Auth required?** — most pages yes; `/login` and `/apply` no
- **Data needed** — which Supabase tables, what filters
- **Page purpose** — list, detail, create/edit form, or dashboard

If any of these are unclear from context, ask before writing.

## Step 2 — Page structure

Every Astro page follows this skeleton:

```astro
---
// src/pages/<route>.astro
import DashboardLayout from '@/layouts/DashboardLayout.astro'
import { supabaseAdmin } from '@/lib/supabase'
import type { YourType } from '@/types/domain'

// Auth guard — middleware handles redirect, but double-check here
const user = Astro.locals.user
if (!user) return Astro.redirect('/login')

// Server-side data fetch — ALL data fetched here, not client-side
const { data: items, error } = await supabaseAdmin
  .from('table_name')
  .select('*')
  .eq('is_archived', false)
  .order('created_at', { ascending: false })

if (error) {
  console.error('[PageName] fetch error:', error)
}
---

<DashboardLayout title="Page Title" currentPath={Astro.url.pathname}>
  <!-- page content -->
</DashboardLayout>
```

Key rules:
- **All data fetches are server-side** in the frontmatter — never `fetch()` from the client
- Use `supabaseAdmin` (service role) for server-side reads; `supabase` (anon) only for client-side if absolutely necessary
- Always handle the `error` from Supabase — log it, don't silently swallow it
- Pass `currentPath` to layout so sidebar highlights the active item
- TypeScript types from `src/types/domain.ts` — no inline type definitions in page files

## Step 3 — Page content patterns

### List page
```astro
<div class="p-8">
  <div class="flex items-center justify-between mb-6">
    <h1 class="font-heading text-2xl font-bold text-brand-navy">Page Title</h1>
    <Button href="/admin/x/new" variant="primary">Add Item</Button>
  </div>

  {items && items.length > 0 ? (
    <div class="bg-white border border-neutral-300 rounded-lg overflow-hidden">
      <!-- table rows -->
    </div>
  ) : (
    <EmptyState
      heading="No items yet"
      subtext="Description of what this section does."
    >
      <Button href="/admin/x/new" variant="primary" slot="cta">Add first item</Button>
    </EmptyState>
  )}
</div>
```

### Detail page (tabbed)
```astro
<div class="p-8">
  <!-- Profile header -->
  <div class="flex items-start gap-4 mb-8">
    <Avatar name={person.full_name} size="xl" />
    <div>
      <h1 class="font-heading text-2xl font-bold text-brand-navy">{person.full_name}</h1>
      <p class="font-mono text-sm text-neutral-500">{person.id}</p>
      <Badge variant={person.status} class="mt-2">{person.status}</Badge>
    </div>
  </div>
  <!-- Tab content -->
</div>
```

### Form page (create/edit)
```astro
<div class="p-8 max-w-2xl">
  <h1 class="font-heading text-2xl font-bold text-brand-navy mb-6">Create/Edit X</h1>
  <form method="POST" action="/api/x" class="space-y-6">
    <Input label="Field Name" name="field" required />
    <!-- more fields -->
    <div class="flex gap-3 pt-4">
      <Button type="submit" variant="primary">Save</Button>
      <Button href="/admin/x" variant="ghost">Cancel</Button>
    </div>
  </form>
</div>
```

## Step 4 — Design system rules

- **Never hardcode hex colours** — use Tailwind utilities: `text-brand-navy`, `bg-brand-gold`, `border-neutral-300`
- **Fonts** — headings use `font-heading` (Plus Jakarta Sans), body uses `font-body` (Inter), IDs/refs use `font-mono` (JetBrains Mono)
- **Spacing** — multiples of 4px via Tailwind: `p-4`, `gap-6`, `mb-8`
- **Border radius** — `rounded` (4px), `rounded-md` (8px), `rounded-lg` (12px), `rounded-xl` (16px), `rounded-full`
- **Empty states** — always use `<EmptyState>` component, never leave a blank section with no content

## Step 5 — Dynamic routes

For routes like `/admin/members/[id]`:

```astro
---
const { id } = Astro.params
if (!id) return Astro.redirect('/admin/members')

const { data: person } = await supabaseAdmin
  .from('people')
  .select('*, person_teams(*, teams(*)), user_roles(*, roles(*))')
  .eq('id', id)
  .single()

if (!person) return Astro.redirect('/admin/members')
---
```

## Step 6 — TypeScript

- Strict mode — no `any`, no non-null assertions (`!`) unless you've verified the value exists
- All props/variables typed — import from `src/types/domain.ts`
- Supabase responses typed via the generated client or explicit interfaces
- If data can be `null`, handle it explicitly before use
