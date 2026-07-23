-- ─── Committees ──────────────────────────────────────────────────────────────

create table committees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table committees enable row level security;

create policy "committees_read" on committees
  for select to authenticated
  using (is_active);

-- ─── Person → Committee memberships ──────────────────────────────────────────

create table person_committees (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references people(id) on delete cascade,
  committee_id uuid not null references committees(id) on delete cascade,
  is_lead      boolean not null default false,
  joined_at    timestamptz not null default now(),
  unique (person_id, committee_id)
);

create index on person_committees(person_id);
create index on person_committees(committee_id);

alter table person_committees enable row level security;

create policy "person_committees_read" on person_committees
  for select to authenticated
  using (true);

-- ─── Seed data ────────────────────────────────────────────────────────────────

insert into committees (name, description) values
  ('Communications', 'Manages internal and external communications for the chapter.'),
  ('Events', 'Plans and coordinates chapter events and social gatherings.'),
  ('Finance', 'Oversees chapter budgets, dues collection, and financial reporting.'),
  ('Membership', 'Handles recruitment, onboarding, and member retention.'),
  ('Welfare', 'Supports the wellbeing and pastoral needs of chapter members.');
