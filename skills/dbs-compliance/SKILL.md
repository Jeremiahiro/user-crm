---
name: dbs-compliance
description: >
  Implement or extend DBS (Disclosure and Barring Service) compliance tracking
  for the 100BMOL Member Portal. Use this skill whenever the user asks to build
  DBS expiry tracking, the org settings module, the DBS status board, configurable
  compliance thresholds, or anything related to certificate expiry alerting.
  Also use it when extending the existing DBS records module or connecting
  DBS status to email reminders.
---

# DBS Compliance Tracking — Implementation Skill

This skill guides the implementation of DBS expiry tracking as specified in
`docs/features/dbs-expiry-tracking.md`. Read that doc first — it contains the
full design rationale, database schema, and open questions.

## Stack context

- **Framework:** Astro SSR (`output: 'server'`), all pages in `src/pages/`
- **DB:** Supabase via `supabaseAdmin` (service-role client, bypasses RLS)
- **Auth guard:** `if (!Astro.locals.user) return Astro.redirect('/login')` at top of every protected page
- **Compliance logic:** `src/lib/compliance.ts` — `classifyDbs(expiryDate, referenceDate?, warnDays?)` already exists
- **Audit logging:** every mutation calls `writeAuditLog()` from `src/lib/audit.ts`
- **API pattern:** auth check → JSON parse → Zod validate → DB operation → audit log → return JSON

---

## Implementation steps (follow in order)

### Step 1 — Migration: `org_settings` table

Add to `supabase/migrations/001_schema.sql` (or a new migration if the DB is
already live). The table is a simple key-value store for chapter-level config:

```sql
create table org_settings (
  key         text primary key,
  value       text not null,
  label       text,
  description text,
  updated_by  uuid references people(id),
  updated_at  timestamptz not null default now()
);

alter table org_settings enable row level security;

create policy "org_settings_read" on org_settings
  for select to authenticated using (true);

-- Default DBS configuration
insert into org_settings (key, value, label, description) values
  ('dbs_validity_years', '3',  'DBS validity (years)',
    'How many years a DBS certificate is valid from its clearance date'),
  ('dbs_warn_days',      '60', 'DBS warning window (days)',
    'Days before expiry to flag a certificate as "expiring soon"')
on conflict (key) do nothing;
```

If the DB is already live and `001_schema.sql` has been applied, create a new
numbered migration file instead and add the same SQL there.

---

### Step 2 — Settings API routes

**`src/pages/api/settings/index.ts`** — GET returns all settings as `{ key: value }` map:

```typescript
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return unauthorised()
  const { data } = await supabaseAdmin.from('org_settings').select('key, value')
  const map = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  return json({ data: map })
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Super Admin only — check locals.user.roles.includes('Super Admin')
  // Zod schema: { key: z.string(), value: z.string() }
  // Upsert: supabaseAdmin.from('org_settings').upsert({ key, value, updated_by }, { onConflict: 'key' })
  // Audit log: action 'update', targetTable 'org_settings', targetId key
}
```

---

### Step 3 — Admin settings page

**`src/pages/admin/settings/index.astro`**

- Super Admin guard: check `Astro.locals.user?.roles?.includes('Super Admin')` and redirect if not
- Fetch all settings via `supabaseAdmin.from('org_settings').select('*')`
- Render a form with one field per setting (number inputs for DBS fields)
- On POST, call `POST /api/settings` for each changed field
- Show success/error banner

Add "Settings" to the sidebar nav in `src/layouts/DashboardLayout.astro`.

---

### Step 4 — DBS status board

**`src/pages/admin/dbs/index.astro`**

Key implementation notes:

```typescript
// 1. Read org settings at the top
const { data: settingsRows } = await supabaseAdmin
  .from('org_settings').select('key, value')
  .in('key', ['dbs_validity_years', 'dbs_warn_days'])

const warnDays = parseInt(settingsRows?.find(s => s.key === 'dbs_warn_days')?.value ?? '60')
const validityYears = parseInt(settingsRows?.find(s => s.key === 'dbs_validity_years')?.value ?? '3')

// 2. Fetch active members with their latest DBS record
const { data: members } = await supabaseAdmin
  .from('people')
  .select('id, full_name, email, dbs_records(expiry_date, clearance_date, created_at)')
  .eq('status', 'active')
  .eq('is_archived', false)

// 3. For each member, pick the latest DBS record and classify it
// classifyDbs() is already in src/lib/compliance.ts — import and use it
// If expiry_date is null but clearance_date is set, compute:
//   expiry = new Date(clearance_date); expiry.setFullYear(expiry.getFullYear() + validityYears)
```

Page layout:
- Filter tabs: All / Valid / Expiring Soon / Expired / Missing
- Table: Name · Email · Clearance date · Expiry date · Status badge · Days remaining
- "Send reminders" button → calls `POST /api/email/dbs-reminders` (already exists)
- Sort by days remaining ascending (most urgent first)

Status badge colours:
- `valid` → success green
- `expiring_soon` → warning amber
- `expired` → danger red
- `missing` → neutral grey

---

### Step 5 — Update DBS reminders API

**`src/pages/api/email/dbs-reminders.ts`** currently hardcodes `warnDays = 60`.

Change it to read from `org_settings` at the top of the handler:

```typescript
const { data: setting } = await supabaseAdmin
  .from('org_settings')
  .select('value')
  .eq('key', 'dbs_warn_days')
  .single()

const warnDays = parseInt(setting?.value ?? '60')
```

Pass `warnDays` into all `classifyDbs()` calls in that route.

---

### Step 6 — DBS record creation: auto-compute expiry

**`src/pages/api/dbs/index.ts`** (POST handler)

When `expiry_date` is not provided but `clearance_date` is, compute and store it:

```typescript
// Read dbs_validity_years from org_settings
const { data: setting } = await supabaseAdmin
  .from('org_settings').select('value').eq('key', 'dbs_validity_years').single()

const validityYears = parseInt(setting?.value ?? '3')

let expiryDate = parsed.data.expiry_date ?? null
if (!expiryDate && parsed.data.clearance_date) {
  const d = new Date(parsed.data.clearance_date)
  d.setFullYear(d.getFullYear() + validityYears)
  expiryDate = d.toISOString().slice(0, 10)
}
```

---

## Sidebar nav entry

Add to `src/layouts/DashboardLayout.astro` nav links:
```
{ href: '/admin/dbs', label: 'DBS Status' }
{ href: '/admin/settings', label: 'Settings' }   ← Super Admin only (hide for others)
```

---

## Checklist

- [ ] Migration applied (or added to `001_schema.sql`)
- [ ] `GET /api/settings` returns all settings
- [ ] `POST /api/settings` restricted to Super Admin, audit-logged
- [ ] `/admin/settings` page renders and saves correctly
- [ ] `/admin/dbs` board shows correct status for each member
- [ ] DBS reminders API reads `dbs_warn_days` from `org_settings`
- [ ] DBS record creation auto-computes `expiry_date` from `clearance_date + validity_years`
- [ ] Sidebar nav updated
- [ ] TypeScript: `npx tsc --noEmit` passes
- [ ] Tests: `npm test` still green
