---
name: supabase-migration
description: >
  Creates Supabase SQL migration files for the 100BMOL Member Portal following the project's
  schema conventions. Use this skill whenever you need to add or modify database tables —
  new modules, schema changes, adding columns, creating indexes, writing RLS policies, or
  seeding reference data. Trigger for requests like "add a table for X", "create a migration
  for Y", "I need to store Z in the database", "update the schema to support W", or any
  time a new module requires database changes.
---

# Supabase Migration — 100BMOL Portal

You are writing a SQL migration for the **100 Black Men of London Member Portal** Supabase
(PostgreSQL) database. Migrations live in `supabase/migrations/` and are numbered sequentially.

## Before writing

1. Check existing migration files in `supabase/migrations/` to find the next number
2. Read `docs/TASKS.md` for the schema spec of the module being built
3. Understand whether this is a new table, a column addition, or an index/policy change

## Migration file conventions

**Filename:** `{NNN}_{description}.sql` — e.g. `003_add_onboarding_pipeline.sql`

**Header comment:**
```sql
-- Migration: {NNN} — {Human-readable description}
-- Created: {date}
-- Purpose: {one sentence on what this migration does and why}
```

## Standard table template

Every table in this project follows this pattern:

```sql
create table {table_name} (
  -- Primary key: always UUID, always gen_random_uuid()
  id uuid primary key default gen_random_uuid(),

  -- Foreign keys: reference by uuid, use on delete cascade for child records
  -- or on delete set null for optional relationships
  parent_id uuid references parent_table(id) on delete cascade,

  -- Required fields
  name text not null,

  -- Soft delete: use is_archived, never hard delete (except audit_log)
  is_archived boolean not null default false,

  -- Timestamps: always both, always timestamptz
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Conventions by column type

| Purpose | Pattern |
|---|---|
| Primary key | `id uuid primary key default gen_random_uuid()` |
| Foreign key (required) | `x_id uuid not null references x(id)` |
| Foreign key (optional) | `x_id uuid references x(id)` |
| Status/type enum | `status text not null default 'active'` with check constraint |
| Soft delete | `is_archived boolean not null default false` |
| Created by | `created_by uuid references people(id)` |
| Array of strings | `types text[] not null default '{}'` |
| JSON metadata | `metadata jsonb` |
| Timestamps | `created_at timestamptz not null default now()` |

## Always add

### Updated_at trigger
```sql
-- Trigger to keep updated_at current
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger {table}_updated_at
  before update on {table}
  for each row execute function update_updated_at();
```

### Indexes
```sql
-- Always index foreign keys
create index on {table}(parent_id);

-- Index soft delete for list queries
create index on {table}(is_archived) where not is_archived;

-- Index status for filtered queries
create index on {table}(status) where not is_archived;
```

### Check constraints for enums
```sql
alter table {table}
  add constraint {table}_status_check
  check (status in ('active', 'inactive', 'archived'));
```

## Special patterns used in this project

### Unique partial index (elected positions — one active holder per position)
```sql
create unique index elected_position_current_holder
  on elected_position_tenures(position_id)
  where term_end is null;
```

### No-delete enforcement via RLS
```sql
-- Prevent deletes on permanent records (tenures, audit_log, dues, dbs_records)
create policy "no_delete_{table}" on {table}
  as restrictive
  for delete
  using (false);
```

### Audit log insert (append-only)
```sql
-- audit_log: no update, no delete
create policy "audit_log_insert_only" on audit_log
  for insert with check (true);

create policy "audit_log_no_update" on audit_log
  as restrictive for update using (false);

create policy "audit_log_no_delete" on audit_log
  as restrictive for delete using (false);
```

## RLS policy template

Enable RLS on every table, then add policies:

```sql
alter table {table} enable row level security;

-- Service role bypasses RLS (used by server-side API routes)
-- anon and authenticated roles need explicit policies

-- Read: authenticated users can read non-archived records
create policy "{table}_read" on {table}
  for select
  to authenticated
  using (not is_archived);

-- Write: only service role (enforced at API layer, not DB layer for now)
-- Per DECISIONS.md Q13: detailed per-role scoping deferred to UAT
-- For now, writes go through supabaseAdmin (service role) which bypasses RLS
```

## Seed data pattern

Seed reference data in a separate `002_seed.sql` or in the same migration if it's small:

```sql
-- Seed: use insert ... on conflict do nothing for idempotency
insert into pillars (id, name, description, display_order) values
  (gen_random_uuid(), 'Education', 'Academic support, scholarships, youth development', 1),
  (gen_random_uuid(), 'Mentoring (CMP)', 'Community Mentoring Programme', 2),
  (gen_random_uuid(), 'Health & Wellness', 'Physical and mental wellbeing programming', 3),
  (gen_random_uuid(), 'Economic Empowerment', 'Financial literacy, entrepreneurship, career development', 4),
  (gen_random_uuid(), 'Leadership', 'Chapter governance, board development', 5)
on conflict (name) do nothing;
```

For data that references other seeded rows (e.g. elected positions linking to roles), use a CTE:

```sql
with role_ids as (
  select id, name from roles
)
insert into elected_positions (title, order_of_precedence, linked_system_role_id)
select 'President', 1, r.id
from role_ids r where r.name = 'Super Admin'
on conflict (title) do nothing;
```

## What NOT to do

- Never use `serial` or `integer` for PKs — always UUID
- Never hard-delete rows from business tables — use `is_archived`
- Never store passwords or tokens in plain text
- Never skip the `updated_at` trigger on mutable tables
- Never use `cascade delete` for compliance-sensitive records (dues, dbs, audit_log, tenures)
- Never skip enabling RLS on a table

## Output format

Produce a single `.sql` file with:
1. Header comment
2. Table creation
3. Indexes
4. Constraints
5. Triggers
6. RLS enable + policies
7. Seed data (if applicable)

Each section separated by a blank line and a section comment (`-- Indexes`, `-- RLS`, etc.).
