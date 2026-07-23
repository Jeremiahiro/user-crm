-- ─────────────────────────────────────────────────────────────────────────────
-- 004_onboarding_overhaul.sql — Onboarding pipeline overhaul
--
-- Changes:
--   people.status          add 'in_progress', 'in_training'; migrate 'pending_review' → 'in_progress'
--   people                 add cancellation_type column
--   onboarding_checklist_items  new table — one row per person+item (current state)
--   onboarding_timeline         new table — unified event feed (stage changes, checklist, notes)
--   Migrate existing onboarding_checklists → onboarding_checklist_items
--   Migrate existing onboarding_notes → onboarding_timeline
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Update people.status check constraint ──────────────────────────────────

alter table people drop constraint if exists people_status_check;

alter table people
  add constraint people_status_check
  check (status in (
    'applicant', 'in_progress', 'in_training', 'approved',
    'active', 'suspended', 'inactive', 'alumni', 'left', 'cancelled'
  ));

-- Migrate old status value
update people set status = 'in_progress' where status = 'pending_review';


-- ── 2. Add cancellation_type to people ────────────────────────────────────────

alter table people
  add column if not exists cancellation_type text
  check (cancellation_type in (
    'opted_out', 'training_incomplete', 'eligibility', 'no_response', 'other'
  ));

comment on column people.cancellation_type is
  'Structured reason for cancellation: opted_out, training_incomplete, eligibility, no_response, other';


-- ── 3. onboarding_checklist_items — current state per person per item ─────────

create table if not exists onboarding_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references people(id) on delete cascade,
  item_key        text not null,
  -- which stage this item belongs to (for grouping)
  stage           text not null check (stage in ('in_progress', 'in_training')),
  completed_at    timestamptz,
  completed_by_id uuid references people(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (person_id, item_key)
);

comment on table onboarding_checklist_items is
  'Current completion state of each onboarding checklist item per applicant';
comment on column onboarding_checklist_items.item_key is
  'One of: interview, documentation, reference_check (in_progress) | safeguarding, mentoring_100_way, dbs_check (in_training)';

create index on onboarding_checklist_items(person_id);
create index on onboarding_checklist_items(item_key);

create trigger onboarding_checklist_items_updated_at
  before update on onboarding_checklist_items
  for each row execute function update_updated_at();

alter table onboarding_checklist_items enable row level security;

create policy "onboarding_checklist_items_read" on onboarding_checklist_items
  for select to authenticated using (true);


-- ── 4. onboarding_timeline — unified chronological event feed ─────────────────

create table if not exists onboarding_timeline (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  event_type  text not null check (event_type in ('stage_change', 'checklist', 'note')),

  -- stage_change fields
  from_stage  text,
  to_stage    text,

  -- checklist fields
  item_key    text,   -- e.g. 'interview', 'safeguarding'
  item_label  text,   -- human-readable label stored at write time
  completed   boolean,

  -- shared / note fields
  note        text,
  author_id   uuid references people(id) on delete set null,

  created_at  timestamptz not null default now()
);

comment on table onboarding_timeline is
  'Chronological feed of all onboarding events: stage transitions, checklist completions, and notes';

create index on onboarding_timeline(person_id, created_at desc);
create index on onboarding_timeline(event_type);

alter table onboarding_timeline enable row level security;

create policy "onboarding_timeline_read" on onboarding_timeline
  for select to authenticated using (true);


-- ── 5. Migrate existing onboarding_checklists → onboarding_checklist_items ────
--    Each non-null timestamp column becomes a completed item row.
--    We don't know who completed these historically so completed_by_id is null.

insert into onboarding_checklist_items (person_id, item_key, stage, completed_at, created_at, updated_at)
select person_id, 'dbs_check', 'in_training', dbs_completed_at, dbs_completed_at, dbs_completed_at
from onboarding_checklists where dbs_completed_at is not null
on conflict (person_id, item_key) do nothing;

insert into onboarding_checklist_items (person_id, item_key, stage, completed_at, created_at, updated_at)
select person_id, 'reference_check', 'in_progress', reference_checked_at, reference_checked_at, reference_checked_at
from onboarding_checklists where reference_checked_at is not null
on conflict (person_id, item_key) do nothing;

-- Also seed timeline events for migrated completions
insert into onboarding_timeline (person_id, event_type, item_key, item_label, completed, created_at)
select person_id, 'checklist', 'dbs_check', 'DBS Check', true, dbs_completed_at
from onboarding_checklists where dbs_completed_at is not null;

insert into onboarding_timeline (person_id, event_type, item_key, item_label, completed, created_at)
select person_id, 'checklist', 'reference_check', 'Reference Check', true, reference_checked_at
from onboarding_checklists where reference_checked_at is not null;


-- ── 6. Migrate existing onboarding_notes → onboarding_timeline ───────────────

insert into onboarding_timeline (person_id, event_type, note, author_id, created_at)
select person_id, 'note', note, author_id, created_at
from onboarding_notes;


-- ── 7. Seed timeline stage_change events for already-active applicants ─────────
--    So their timeline isn't empty — record their current status as a milestone.

insert into onboarding_timeline (person_id, event_type, from_stage, to_stage, created_at)
select
  id,
  'stage_change',
  'applicant',
  status,
  coalesce(date_joined::timestamptz, applied_at, now())
from people
where status in ('in_progress', 'in_training', 'approved', 'active', 'cancelled')
  and applied_at is not null;
