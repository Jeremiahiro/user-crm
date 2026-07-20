---
name: module-builder
description: >
  Builds a complete CRM module for the 100BMOL Member Portal — list page, detail/profile view,
  create/edit forms, API routes, and Supabase queries — from the spec in docs/TASKS.md. Use
  this skill for any substantial feature build across Phases 2–5: Members, Teams, Pillars,
  Elected Positions, Roles & Permissions, Dues, DBS Records, Documents, Mentees, CMP, Awards,
  Praise, or Participation Events. Trigger for requests like "build the Members module",
  "implement the Dues feature", "create the CMP sessions page", "build out elected positions",
  or any request to implement a full feature end-to-end.
---

# Module Builder — 100BMOL Portal

You are building a complete feature module for the **100 Black Men of London Member Portal**.
A module typically includes: database migration, API routes, list page, detail/profile view,
and create/edit forms.

## Before writing any code

1. Read `docs/TASKS.md` — find the module's spec under the relevant Phase section
2. Read `docs/DESIGN_SYSTEM.md` — all UI must use design tokens; no hardcoded colours
3. Read `docs/DECISIONS.md` — check for any decisions affecting this module
4. Check `supabase/migrations/` to see if the table exists or needs creating
5. Check `src/types/domain.ts` to see if types exist or need adding

## Build sequence

Always build in this order — later steps depend on earlier ones:

```
1. Database migration (if table doesn't exist)
2. TypeScript domain types
3. API routes (data layer first)
4. List page
5. Detail/profile view
6. Create/edit form
7. Delete/archive action
```

## 1. Database migration

If the module needs a new table, create `supabase/migrations/{NNN}_{module}.sql`.
Follow the conventions in the `supabase-migration` skill:
- UUID PKs, `is_archived` soft delete, `created_at`/`updated_at` timestamps
- Foreign keys with `on delete cascade` for child records
- Indexes on FK columns and `is_archived`
- RLS enabled, service role bypasses for server-side writes

## 2. TypeScript types

Add to `src/types/domain.ts` — one interface per table, named after the entity:

```typescript
export interface Member {
  id: string
  full_name: string
  email: string
  // ... all columns typed
  is_archived: boolean
  created_at: string
  updated_at: string
}
```

## 3. API routes

Create `src/pages/api/{module}/index.ts` and `src/pages/api/{module}/[id].ts`.
Every route must:
- Check `locals.user` for auth (return 401 if missing)
- Validate request body with Zod (return 422 with issues on failure)
- Use `supabaseAdmin` for all DB operations
- Write to `audit_log` after every mutation
- Return typed JSON with consistent shape: `{ data: ... }` or `{ error: ... }`
- Never hard-delete — set `is_archived = true`

Reference the `astro-api-route` skill for the full route template.

## 4. List page

`src/pages/admin/{module}/index.astro`

Structure:
```astro
---
// Auth, data fetch, error handling
---
<DashboardLayout title="Module Name" currentPath={Astro.url.pathname}>
  <div class="p-8">
    <!-- Page header with title + primary action -->
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-heading text-2xl font-bold text-brand-navy">Module Name</h1>
      <Button href="/admin/{module}/new" variant="primary">Add Item</Button>
    </div>

    <!-- Filter bar (if needed) -->

    <!-- Table or card grid -->
    {items.length > 0 ? (
      <DataTable items={items} />
    ) : (
      <EmptyState heading="No items yet" subtext="Description of the module." >
        <Button href="/admin/{module}/new" variant="primary" slot="cta">Add first item</Button>
      </EmptyState>
    )}
  </div>
</DashboardLayout>
```

Table conventions:
- Header: `bg-neutral-100`, `text-neutral-700`, `font-semibold text-xs uppercase tracking-wide`
- Rows: `hover:bg-neutral-50`, `border-b border-neutral-100`, height ~52px
- IDs: `font-mono text-xs text-neutral-500`
- Status: always use `<Badge>` component — never raw text for status fields
- Actions: "Edit" ghost button + "Archive" danger ghost button, right-aligned

## 5. Detail/profile view

`src/pages/admin/{module}/[id].astro`

Use tabbed layout for records with multiple data dimensions (e.g. Member profile has tabs for
Overview, Dues, DBS, Documents, etc.):

```astro
<div class="p-8">
  <!-- Record header -->
  <div class="flex items-start gap-4 mb-8 pb-8 border-b border-neutral-100">
    <!-- Avatar / icon + name + ID + status badge + actions -->
  </div>

  <!-- Tab nav -->
  <nav class="flex gap-1 mb-6 border-b border-neutral-100">
    {tabs.map(tab => (
      <a href={`#${tab.id}`}
         class="px-4 py-2 text-sm font-medium rounded-t-md
                text-neutral-700 hover:text-brand-navy hover:bg-neutral-50">
        {tab.label}
      </a>
    ))}
  </nav>

  <!-- Tab panels -->
</div>
```

For simple records without tabs, use a clean two-column detail layout.

Always include:
- Back link to list page
- Edit button (for authorised users)
- Archive confirmation modal (copy must describe the consequence, not just "are you sure?")

## 6. Create/edit form

`src/pages/admin/{module}/new.astro` and `src/pages/admin/{module}/[id]/edit.astro`

Use `<form method="POST">` for simplicity — handle submission in the Astro frontmatter,
redirect on success, re-render with errors on failure:

```astro
---
let errors: Record<string, string> = {}
let values: Record<string, string> = {}

if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData()
  values = Object.fromEntries(form) as Record<string, string>

  const response = await fetch(`${Astro.url.origin}/api/{module}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: Astro.request.headers.get('cookie') ?? '',
    },
    body: JSON.stringify(values),
  })

  if (response.ok) {
    const { data } = await response.json()
    return Astro.redirect(`/admin/{module}/${data.id}`)
  } else {
    const { issues } = await response.json()
    errors = issues?.fieldErrors ?? {}
  }
}
---
```

Form field conventions:
- Use `<Input>` component with `label`, `name`, `value={values.field}`, `error={errors.field}`
- Group related fields in sections with `<h2 class="font-heading text-sm font-semibold text-neutral-700 mb-4 uppercase tracking-wide">`
- Submit + Cancel buttons at bottom: `<Button type="submit" variant="primary">Save</Button>` + `<Button href="/admin/{module}" variant="ghost">Cancel</Button>`
- Required fields: add `required` prop to `<Input>` and mark label with `*`

## 7. Archive action

Archive happens via a DELETE request to the API (which soft-deletes):

```typescript
// In the [id].ts API route
export const DELETE: APIRoute = async ({ params, locals }) => {
  // Check for blockers first (e.g. active tenure, active team members)
  const { data: blockers } = await supabaseAdmin
    .from('related_table')
    .select('id')
    .eq('parent_id', params.id)
    .eq('is_active', true)
    .limit(1)

  if (blockers && blockers.length > 0) {
    return new Response(
      JSON.stringify({ error: 'Cannot archive: resolve active dependencies first.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const { data, error } = await supabaseAdmin
    .from('table')
    .update({ is_archived: true })
    .eq('id', params.id)
    .select()
    .single()

  await writeAuditLog({ actorId: locals.user.id, action: 'archive', ... })

  return new Response(JSON.stringify({ data }), { status: 200, ... })
}
```

## Module-specific rules from the PRD

- **Members**: delete blocked if active elected tenure exists
- **Teams**: archive blocked while active members assigned
- **Pillars**: archive blocked if teams or members assigned
- **Elected Tenures**: no delete ever — permanent electoral record
- **DBS Records**: no delete — regulatory requirement
- **Dues**: no delete — financial audit trail
- **Audit Log**: read-only — no create/update/delete from application code (writes go through `writeAuditLog` helper only)
- **Praise**: no edit — immutable once created; admin can archive

## Checklist before marking a module complete

- [ ] Migration file created and includes RLS
- [ ] Types added to `domain.ts`
- [ ] API routes created with auth + Zod + audit log
- [ ] List page with empty state
- [ ] Detail/profile view
- [ ] Create form with validation errors displayed
- [ ] Edit form pre-populated with existing data
- [ ] Archive action with blocker check
- [ ] No hardcoded colours — all design tokens
- [ ] No `any` types — TypeScript strict throughout
- [ ] `npm run build` passes with no errors
