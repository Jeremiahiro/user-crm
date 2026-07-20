# Agent Task: Email Templates Module

## Goal
Build a full **Email Templates** module with database, API, and admin UI.
Templates let admins compose and save reusable styled HTML emails (welcome messages, event announcements, award notifications, etc.) that can be filled with member variables and sent from the compose page.

## Tech stack context
- Astro SSR (`output: 'server'`, Vercel adapter)
- Supabase (Postgres + Storage) via `@/lib/supabase` → `supabaseAdmin`
- Gmail API via `@/lib/gmail` → `sendEmail({ to, subject, html })`
- Audit logging via `@/lib/audit` → `writeAuditLog(...)`
- Design system: CSS custom properties (`var(--color-brand-navy)`, `var(--color-brand-gold)`, etc.), `var(--font-heading)`, `var(--font-body)`, `var(--radius-md)`, `var(--radius-lg)`
- Auth check: `if (!Astro.locals.user) return Astro.redirect('/login')`
- Admin check: `const isAdmin = locals.user.roles?.some(r => ['Super Admin', 'Admin'].includes(r))`
- All inline `onclick` is banned — use `<script is:inline>` + `addEventListener` + `data-*` attributes
- NO `define:vars` (causes IIFE scope bug)
- Breadcrumb component: `import Breadcrumb from '@/components/ui/Breadcrumb.astro'` with `crumbs={[{label, href?}, ...]}`

## 1. Database migration

Create `supabase/migrations/012_email_templates.sql`:

```sql
create table email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                          -- e.g. "Welcome email"
  description text,                                  -- optional internal note
  subject     text not null,                         -- email subject line (may contain {{variables}})
  html_body   text not null,                         -- full HTML (may contain {{variables}})
  category    text not null default 'general',       -- 'welcome' | 'award' | 'reminder' | 'event' | 'general'
  is_active   boolean not null default true,
  created_by  uuid references people(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on email_templates(category);
create index on email_templates(is_active) where is_active;

alter table email_templates enable row level security;

create policy "email_templates_read" on email_templates
  for select to authenticated
  using (true);
```

## 2. API routes

### `src/pages/api/email-templates/index.ts`

- `GET`: Returns all active templates. Optional `?category=` filter. Returns `{ data: [...] }`.
- `POST`: Admin-only. Creates a new template. Body: `{ name, description?, subject, html_body, category }`. Returns `{ data: {...} }`.

### `src/pages/api/email-templates/[id].ts`

- `GET`: Returns single template by id.
- `PUT`: Admin-only. Updates `name`, `description`, `subject`, `html_body`, `category`, `is_active`. Also sets `updated_at`.
- `DELETE`: Admin-only. Soft-delete: sets `is_active = false`. Returns `{ ok: true }`.

All routes write audit log entries. Validate with Zod.

## 3. Admin pages

### `src/pages/admin/email-templates/index.astro`

**List page** showing all templates (active + archived via filter tabs).

Layout:
- Header: "Email Templates" title + subtitle + "New template" button (top right)
- Filter tabs: All | Welcome | Award | Reminder | Event | General (with count badges)
- Table rows per template:
  - Name (link to edit page) + description
  - Category badge (colour-coded)
  - Subject line (truncated)
  - Status badge (Active / Archived)
  - Actions: Edit link | Preview button (opens modal) | Archive button (admin only, soft-deletes)

The Archive button calls `DELETE /api/email-templates/${id}` and reloads on success.

### `src/pages/admin/email-templates/new.astro`

**Create form**. Fields:
- Name * (text)
- Category * (select: General / Welcome / Award / Reminder / Event)
- Description (textarea, 2 rows, optional)
- Subject * (text, with note: "Tip: use {{full_name}} for personalisation")
- HTML Body * (textarea, 12 rows, monospace font)
- Live preview toggle: a button that renders the HTML body in an `<iframe>` below the textarea

On POST success → redirect to `/admin/email-templates`.
Breadcrumb: `[Email Templates → New Template]`

### `src/pages/admin/email-templates/[id]/edit.astro`

**Edit form** — same fields as new, pre-populated.
On POST success → redirect to `/admin/email-templates`.
Breadcrumb: `[Email Templates → {template.name} → Edit]`

Also shows a "Send test" section below the form:
- Input: email address to send test to (pre-filled with current admin's email)
- Button: "Send test email" — calls `POST /api/email-templates/${id}/test`

### `src/pages/api/email-templates/[id]/test.ts`

- `POST`: Admin-only. Sends the template's HTML body to the provided test email address.
- Body: `{ to: string (email) }`
- Replaces `{{full_name}}` with "Test User", `{{year}}` with current year, etc. before sending.
- Calls `sendEmail({ to, subject: '[TEST] ' + template.subject, html: processedHtml })`.
- Returns `{ ok: true }` or `{ error: string }`.

## 4. Sidebar nav

In `src/layouts/DashboardLayout.astro`, add Email Templates to the **Programmes** nav group:

```js
{ label: 'Email Templates', href: '/admin/email-templates', icon: 'mail' },
```

The `mail` icon SVG path is already in the icons map. If not, add:
```
mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,4 12,13 2,4"/>`
```
(but adapt to the 16x16 viewBox used in the layout — scale/simplify accordingly).

## 5. Variable substitution

When rendering template previews or sending test emails, apply simple `{{variable}}` replacement:

```ts
function applyVariables(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
```

Default preview/test variables:
```ts
const vars = {
  full_name: 'John Smith',
  first_name: 'John',
  year: String(new Date().getFullYear()),
  award_type: 'Member of the Year',
  citation: 'For outstanding service to the chapter.',
}
```

## 6. Use from compose page

On `src/pages/admin/email/compose.astro`, add a "Load template" dropdown at the top.
When a template is selected, populate the subject and body fields with the template's values.

## Done criteria

- [ ] Migration file created
- [ ] All 5 API routes implemented with Zod validation + audit log
- [ ] List page with filter tabs and Archive action
- [ ] New page with live preview
- [ ] Edit page with Send Test functionality
- [ ] Sidebar entry added
- [ ] Template loading wired into compose page
