# DBS Expiry Tracking

Provides a live view of DBS certificate status across all active members, with configurable expiry and warning periods stored in organisation settings.

---

## Overview

DBS certificates expire 3 years from the clearance date. The chapter needs to:

- See which members have valid, expiring-soon, expired, or missing DBS records at a glance
- Configure the validity period and the advance-warning window without a code change
- Send reminder emails to members whose DBS is about to expire (already wired in the Email module)

---

## Organisation Settings

A new `org_settings` table stores chapter-level configuration as typed key-value pairs.

```sql
create table org_settings (
  key        text primary key,
  value      text not null,
  label      text,
  description text,
  updated_by uuid references people(id),
  updated_at timestamptz not null default now()
);
```

Two settings drive DBS behaviour:

| Key | Default | Meaning |
|-----|---------|---------|
| `dbs_validity_years` | `3` | How many years a DBS certificate is valid from `clearance_date` |
| `dbs_warn_days` | `60` | How many days before expiry to flag the record as "expiring soon" |

Admins edit these on the `/admin/settings` page. Changes are audit-logged.

---

## Expiry calculation

The expiry date for a DBS record is:

```
expiry_date = clearance_date + dbs_validity_years years
```

If `expiry_date` is already stored on the record (e.g., entered manually), that takes precedence over the calculated value.

Status classification (already in `src/lib/compliance.ts` as `classifyDbs`):

| Status | Condition |
|--------|-----------|
| `missing` | No DBS record exists for this person |
| `expired` | `expiry_date < today` |
| `expiring_soon` | `expiry_date` is within `dbs_warn_days` of today |
| `valid` | `expiry_date` is beyond the warning window |

The `warnDays` parameter in `classifyDbs` should be read from `org_settings.dbs_warn_days` at runtime rather than using the hardcoded default.

---

## Database changes

### Migration additions

```sql
-- org_settings table
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

-- Default DBS settings
insert into org_settings (key, value, label, description) values
  ('dbs_validity_years', '3',  'DBS validity (years)',       'How many years a DBS certificate is valid from its clearance date'),
  ('dbs_warn_days',      '60', 'DBS warning window (days)',  'How many days before expiry to flag a certificate as expiring soon')
on conflict (key) do nothing;
```

### `dbs_records` — computed expiry

When `expiry_date` is not provided by the admin, the API should compute it as `clearance_date + dbs_validity_years years` before inserting. This avoids re-computing on every read.

Alternatively, a generated column can do this in-database:

```sql
-- Option: store computed expiry (preferred — avoids stale reads)
-- Only set when expiry_date is null and clearance_date is present
-- Application reads dbs_validity_years from org_settings at insert time
```

The simpler approach (recommended for this phase): read `dbs_validity_years` from `org_settings` in the DBS record creation API and compute + store `expiry_date` before inserting.

---

## New pages

### `/admin/dbs` — DBS Status Board

A filterable list of all active members showing their DBS status.

**Columns:** Name · Clearance date · Expiry date · Status badge · Days until expiry / days overdue · Action

**Filters:** Status (All / Valid / Expiring soon / Expired / Missing)

**Batch actions:**
- "Send reminders" — triggers the existing `/api/email/dbs-reminders` endpoint for expiring/expired members
- "Export" — CSV of filtered results

**Implementation sketch:**

```typescript
// Fetch active members + their latest DBS record
const { data: members } = await supabaseAdmin
  .from('people')
  .select('id, full_name, email, dbs_records(expiry_date, clearance_date, created_at)')
  .eq('status', 'active')
  .eq('is_archived', false)

// Read warn threshold from org_settings
const { data: settings } = await supabaseAdmin
  .from('org_settings')
  .select('key, value')
  .in('key', ['dbs_validity_years', 'dbs_warn_days'])

const warnDays = parseInt(settings?.find(s => s.key === 'dbs_warn_days')?.value ?? '60')

// Classify each member
const rows = members.map(m => ({
  ...m,
  status: classifyDbs(latestExpiryDate(m.dbs_records), new Date(), warnDays),
}))
```

### `/admin/settings` — Organisation Settings

A simple form page for Super Admins to update key-value settings.

**Fields shown:**
- DBS validity (years) — number input, min 1, max 10
- DBS warning window (days) — number input, min 7, max 365

Each save calls `POST /api/settings` which upserts the row and writes an audit log entry.

---

## API routes

### `GET /api/settings`

Returns all `org_settings` rows as a `{ key: value }` map.

### `POST /api/settings`

Body: `{ key: string, value: string }` — Super Admin only. Upserts the setting and audit-logs the change.

---

## Email integration

The existing `/api/email/dbs-reminders` endpoint already:
- Fetches all active members' DBS records
- Calls `classifyDbs` with a hardcoded `warnDays = 60`
- Sends reminders for `expiring_soon` and `expired` members

**Change needed:** read `dbs_warn_days` from `org_settings` instead of hardcoding 60. One extra DB query at the top of the route.

---

## Implementation order

1. Migration — add `org_settings` table with default values
2. `GET/POST /api/settings` — read and update settings
3. `/admin/settings` — settings UI page (Super Admin only)
4. `/admin/dbs` — DBS status board using `classifyDbs` with live settings
5. Update `/api/email/dbs-reminders` to read `dbs_warn_days` from `org_settings`
6. Update DBS record creation API to compute and store `expiry_date` from `clearance_date + dbs_validity_years`

---

## Open questions

- Should non-Super-Admin roles (e.g., Chapter Leadership) be able to view `/admin/settings` read-only?
- Should the DBS status board be accessible to Team Leads for their own team members only?
- Should "expiry approaching" also trigger an in-app notification, or is email sufficient?
