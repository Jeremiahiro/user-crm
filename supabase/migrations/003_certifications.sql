-- ─────────────────────────────────────────────────────────────────────────────
-- 003_certifications.sql — Certifications & Trainings feature
--
-- Tables added:
--   document_types        admin-managed list of document categories
--   documents             unified member document uploads (replaces cert-only flow)
--   trainings             training courses assigned to members
--   training_assignments  who a training is assigned to (all/team/person)
--   training_completions  completion record per person per training
--
-- Storage bucket added: member-documents (private, signed URLs)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── document_types ────────────────────────────────────────────────────────────

create table if not exists document_types (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  slug                 text unique not null,
  description          text,
  requires_expiry      boolean not null default false,
  requires_issuer      boolean not null default false,
  is_training_linkable boolean not null default false,
  sort_order           integer not null default 0,
  is_active            boolean not null default true,
  created_by           uuid references people(id) on delete set null,
  created_at           timestamptz not null default now()
);

insert into document_types (name, slug, description, requires_expiry, requires_issuer, is_training_linkable, sort_order) values
  ('Certificate',  'certificate',  'Completion certificate from a course or training', true,  true,  true,  1),
  ('DBS',          'dbs',          'Disclosure and Barring Service check certificate',  true,  true,  false, 2),
  ('Reference',    'reference',    'Professional or personal reference letter',          false, true,  false, 3),
  ('ID Document',  'id_document',  'Government-issued identification',                  true,  true,  false, 4),
  ('Other',        'other',        'Any other document',                                false, false, false, 5)
on conflict (slug) do nothing;


-- ── trainings ─────────────────────────────────────────────────────────────────

create table if not exists trainings (
  id                         uuid primary key default gen_random_uuid(),
  title                      text not null,
  description                text,
  external_url               text,
  requires_document          boolean not null default false,
  expected_document_type_id  uuid references document_types(id) on delete set null,
  is_active                  boolean not null default true,
  created_by                 uuid references people(id) on delete set null,
  created_at                 timestamptz not null default now()
);


-- ── documents ─────────────────────────────────────────────────────────────────
-- Drop the old documents table (and any FK dependents) so we can recreate
-- it with the new schema. The old table used a different set of columns
-- (type enum, drive_url, upload_status, upload_token, is_archived) that are
-- incompatible with the new Storage-based flow.

drop table if exists documents cascade;

create table documents (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid not null references people(id) on delete cascade,
  document_type_id   uuid not null references document_types(id),
  title              text not null,
  issued_by          text,
  issued_date        date,
  expiry_date        date,
  training_id        uuid references trainings(id) on delete set null,
  file_url           text not null,
  storage_path       text not null,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by        uuid references people(id) on delete set null,
  reviewed_at        timestamptz,
  review_notes       text,
  uploaded_at        timestamptz not null default now()
);

create index documents_person_id_idx    on documents(person_id);
create index documents_training_id_idx  on documents(training_id);
create index documents_status_idx       on documents(status);


-- ── training_assignments ──────────────────────────────────────────────────────

create table if not exists training_assignments (
  id                    uuid primary key default gen_random_uuid(),
  training_id           uuid not null references trainings(id) on delete cascade,
  scope                 text not null check (scope in ('all', 'team', 'person')),
  team_id               uuid references teams(id) on delete cascade,
  person_id             uuid references people(id) on delete cascade,
  email                 text,
  deadline              date,
  reminder_7d_sent_at   timestamptz,
  reminder_1d_sent_at   timestamptz,
  assigned_by           uuid references people(id) on delete set null,
  assigned_at           timestamptz not null default now()
);

create index if not exists training_assignments_training_id_idx on training_assignments(training_id);
create index if not exists training_assignments_person_id_idx   on training_assignments(person_id);
create index if not exists training_assignments_team_id_idx     on training_assignments(team_id);


-- ── training_completions ──────────────────────────────────────────────────────

create table if not exists training_completions (
  id            uuid primary key default gen_random_uuid(),
  training_id   uuid not null references trainings(id) on delete cascade,
  person_id     uuid not null references people(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  method        text not null check (method in ('self_reported', 'document')),
  document_id   uuid references documents(id) on delete set null,
  notes         text,
  unique (training_id, person_id)
);

create index if not exists training_completions_person_id_idx on training_completions(person_id);


-- ── Storage bucket: member-documents (private) ────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-documents', 'member-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Service-role (supabaseAdmin) bypasses RLS so no policies needed for server uploads.
-- Authenticated users may not read directly — all access goes through signed URLs from the API.
