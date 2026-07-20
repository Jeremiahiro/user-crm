-- ─────────────────────────────────────────────────────────────────────────────
-- 001_schema.sql — Complete schema for the 100BMOL Member Portal
--
-- This is the single source of truth. Run this file in Supabase Studio
-- (SQL Editor) on a fresh project to stand up the entire schema.
--
-- After running this file:
--   1. Run scripts/bootstrap-superadmin.sql to grant the first Super Admin.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — SHARED FUNCTIONS
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CORE TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── People ──────────────────────────────────────────────────────────────────
-- first_name + last_name are canonical. full_name is a generated display column.

create table people (
  id                  uuid primary key default gen_random_uuid(),

  -- Name
  first_name          text not null,
  middle_name         text,
  last_name           text not null,
  full_name           text generated always as (
                        trim(first_name
                          || case when middle_name is not null and middle_name <> ''
                             then ' ' || middle_name else '' end
                          || ' ' || last_name)
                      ) stored,

  -- Contact
  email               text unique not null,
  email_secondary     text,
  phone               text,

  -- Personal
  date_of_birth       date,
  gender              text,
  address             text,
  profile_photo_url   text,

  -- Professional / social
  profession          text,
  employer            text,
  linkedin_url        text,
  twitter_url         text,
  instagram_url       text,
  facebook_url        text,

  -- Membership
  person_types        text[]       not null default '{}',
  status              text         not null default 'applicant',
  source              text,
  date_joined         date,
  applied_at          timestamptz  default now(),
  last_activity_at    timestamptz,

  -- Interest / intake form responses
  pillar_interest     text,
  committee_interest  text,
  why_join            text,
  skills_qualities    text,
  referral_source     text,

  -- Consent
  dbs_consent         boolean      default false,
  dues_consent        boolean      default false,

  -- Intake pipeline
  intake_status       text,
  intake_reason       text,
  intake_notes        text,

  -- Cancellation
  cancellation_reason text,

  -- General notes
  notes               text,

  -- Access control
  login_enabled       boolean      not null default false,
  is_archived         boolean      not null default false,

  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);

alter table people
  add constraint people_status_check
  check (status in (
    'applicant', 'pending_review', 'approved',
    'active', 'suspended', 'inactive', 'alumni', 'left', 'cancelled'
  ));

comment on column people.first_name    is 'Given / first name';
comment on column people.middle_name   is 'Middle name or initial (optional)';
comment on column people.last_name     is 'Family / last name';
comment on column people.full_name     is 'Generated: first_name [middle_name] last_name';
comment on column people.applied_at    is 'When the person was first added to the system.';
comment on column people.date_joined   is 'When the person became an active member.';
comment on column people.login_enabled is 'Admin must explicitly enable before someone can sign in.';

create index on people(status) where not is_archived;
create index on people(is_archived) where not is_archived;
create index on people(email);

create trigger people_updated_at
  before update on people
  for each row execute function update_updated_at();

alter table people enable row level security;

create policy "people_read" on people
  for select to authenticated
  using (not is_archived);


-- ─── Pillars ─────────────────────────────────────────────────────────────────

create table pillars (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table pillars enable row level security;

create policy "pillars_read" on pillars
  for select to authenticated
  using (is_active);


-- ─── Teams ───────────────────────────────────────────────────────────────────

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  pillar_id   uuid references pillars(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index on teams(pillar_id);

alter table teams enable row level security;

create policy "teams_read" on teams
  for select to authenticated
  using (is_active);


-- ─── Person → Team memberships ───────────────────────────────────────────────

create table person_teams (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references people(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  is_team_lead boolean not null default false,
  joined_at    timestamptz not null default now(),
  unique (person_id, team_id)
);

create index on person_teams(person_id);
create index on person_teams(team_id);

alter table person_teams enable row level security;

create policy "person_teams_read" on person_teams
  for select to authenticated
  using (true);


-- ─── Roles ───────────────────────────────────────────────────────────────────

create table roles (
  id                  uuid primary key default gen_random_uuid(),
  name                text unique not null,
  description         text,
  is_system_protected boolean not null default false,
  is_archived         boolean not null default false,
  created_at          timestamptz not null default now()
);

create index on roles(is_archived) where not is_archived;

alter table roles enable row level security;

create policy "roles_read" on roles
  for select to authenticated
  using (not is_archived);


-- ─── Role permissions ────────────────────────────────────────────────────────

create table role_permissions (
  id        uuid primary key default gen_random_uuid(),
  role_id   uuid not null references roles(id) on delete cascade,
  module    text not null,
  operation text not null,
  scope     text not null default 'all',
  unique (role_id, module, operation)
);

alter table role_permissions
  add constraint role_permissions_operation_check
  check (operation in ('create', 'read', 'update', 'delete'));

alter table role_permissions
  add constraint role_permissions_scope_check
  check (scope in ('all', 'own_team', 'own_record'));

create index on role_permissions(role_id);

alter table role_permissions enable row level security;

create policy "role_permissions_read" on role_permissions
  for select to authenticated
  using (true);


-- ─── User → Role assignments ─────────────────────────────────────────────────

create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  role_id     uuid not null references roles(id),
  assigned_by uuid references people(id),
  assigned_at timestamptz not null default now(),
  unique (person_id, role_id)
);

create index on user_roles(person_id);
create index on user_roles(role_id);

alter table user_roles enable row level security;

create policy "user_roles_read" on user_roles
  for select to authenticated
  using (true);


-- ─── User permission overrides ───────────────────────────────────────────────

create table user_permission_overrides (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  module    text not null,
  operation text not null,
  scope     text not null default 'all',
  type      text not null,
  reason    text,
  set_by    uuid references people(id),
  set_at    timestamptz not null default now()
);

alter table user_permission_overrides
  add constraint upo_type_check check (type in ('allow', 'deny'));

create index on user_permission_overrides(person_id);

alter table user_permission_overrides enable row level security;

create policy "upo_read" on user_permission_overrides
  for select to authenticated
  using (true);


-- ─── Elected positions ───────────────────────────────────────────────────────

create table elected_positions (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  description           text,
  order_of_precedence   int,
  linked_system_role_id uuid references roles(id),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

alter table elected_positions enable row level security;

create policy "elected_positions_read" on elected_positions
  for select to authenticated
  using (is_active);


-- ─── Elected position tenures ────────────────────────────────────────────────

create table elected_position_tenures (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references elected_positions(id),
  person_id   uuid not null references people(id),
  term_start  date not null,
  term_end    date,
  elected_by  text,
  notes       text,
  created_by  uuid references people(id),
  created_at  timestamptz not null default now()
);

alter table elected_position_tenures
  add constraint ept_elected_by_check
  check (elected_by in ('chapter_vote', 'board_appointment', 'co_option'));

-- One active holder per position at a time
create unique index elected_position_current_holder
  on elected_position_tenures(position_id)
  where term_end is null;

create index on elected_position_tenures(position_id);
create index on elected_position_tenures(person_id);

alter table elected_position_tenures enable row level security;

create policy "ept_read" on elected_position_tenures
  for select to authenticated
  using (true);

-- Permanent electoral record — no deletes
create policy "ept_no_delete" on elected_position_tenures
  as restrictive for delete
  using (false);


-- ─── Dues ────────────────────────────────────────────────────────────────────

create table dues (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  year        int not null,
  month       int not null,
  paid_at     timestamptz,
  recorded_by uuid references people(id),
  created_at  timestamptz not null default now(),
  unique (person_id, year, month)
);

alter table dues
  add constraint dues_month_check check (month between 1 and 12);

create index on dues(person_id);
create index on dues(year, month);

alter table dues enable row level security;

create policy "dues_read" on dues
  for select to authenticated
  using (true);

-- Financial audit trail — no deletes
create policy "dues_no_delete" on dues
  as restrictive for delete
  using (false);


-- ─── DBS Records ─────────────────────────────────────────────────────────────

create table dbs_records (
  id                    uuid primary key default gen_random_uuid(),
  person_id             uuid not null references people(id) on delete cascade,
  certificate_reference text,
  clearance_date        date,
  expiry_date           date,
  drive_url             text,
  is_archived           boolean not null default false,
  recorded_by           uuid references people(id),
  created_at            timestamptz not null default now()
);

create index on dbs_records(person_id);
create index on dbs_records(expiry_date);
create index on dbs_records(is_archived) where not is_archived;

alter table dbs_records enable row level security;

create policy "dbs_records_read" on dbs_records
  for select to authenticated
  using (true);

-- Regulatory requirement — no deletes
create policy "dbs_no_delete" on dbs_records
  as restrictive for delete
  using (false);


-- ─── Documents ───────────────────────────────────────────────────────────────

create table documents (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid references people(id),
  team_id        uuid references teams(id),
  type           text not null,
  description    text,
  drive_url      text,
  upload_token   text unique,
  upload_status  text not null default 'pending',
  uploaded_email text,
  is_archived    boolean not null default false,
  created_at     timestamptz not null default now()
);

alter table documents
  add constraint documents_type_check
  check (type in ('dbs', 'photo_id', 'passport', 'training', 'agreement', 'other'));

alter table documents
  add constraint documents_upload_status_check
  check (upload_status in ('pending', 'uploaded', 'matched', 'unmatched'));

create index on documents(person_id);
create index on documents(upload_token);
create index on documents(upload_status);

alter table documents enable row level security;

create policy "documents_read" on documents
  for select to authenticated
  using (not is_archived);


-- ─── Mentees ─────────────────────────────────────────────────────────────────

create table mentees (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  date_of_birth  date,
  year_group     text,
  year_label     text,
  school         text,
  email          text,
  phone          text,
  guardian_name  text,
  guardian_email text,
  mentor_id      uuid references people(id),
  is_archived    boolean not null default false,
  created_at     timestamptz not null default now()
);

create index on mentees(mentor_id);

alter table mentees enable row level security;

create policy "mentees_read" on mentees
  for select to authenticated
  using (not is_archived);


-- ─── CMP Programme Years ─────────────────────────────────────────────────────

create table cmp_programme_years (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  start_date date,
  end_date   date,
  created_at timestamptz not null default now()
);

alter table cmp_programme_years enable row level security;

create policy "cmp_years_read" on cmp_programme_years
  for select to authenticated
  using (true);


-- ─── CMP Sessions ────────────────────────────────────────────────────────────

create table cmp_sessions (
  id                  uuid primary key default gen_random_uuid(),
  programme_year_id   uuid references cmp_programme_years(id),
  title               text not null,
  session_date        date not null,
  session_time        time,
  location            text,
  type                text,
  notes               text,
  is_cancelled        boolean not null default false,
  cancellation_reason text,
  created_at          timestamptz not null default now()
);

alter table cmp_sessions
  add constraint cmp_sessions_type_check
  check (type in ('regular', 'special', 'trip'));

create index on cmp_sessions(programme_year_id);
create index on cmp_sessions(session_date);

alter table cmp_sessions enable row level security;

create policy "cmp_sessions_read" on cmp_sessions
  for select to authenticated
  using (true);


-- ─── CMP Attendance ──────────────────────────────────────────────────────────
-- role: mentor (chapter member), mentee, parent/guardian, visitor (ad-hoc)

create table cmp_attendance (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references cmp_sessions(id),
  role         text not null default 'mentee',
  person_id    uuid references people(id),
  mentee_id    uuid references mentees(id),
  visitor_name text,
  status       text not null,
  recorded_by  uuid references people(id),
  recorded_at  timestamptz not null default now()
);

alter table cmp_attendance
  add constraint cmp_attendance_status_check
  check (status in ('present', 'absent', 'apology'));

alter table cmp_attendance
  add constraint cmp_attendance_role_check
  check (role in ('mentor', 'mentee', 'parent', 'visitor'));

-- Each mentee appears at most once per session
create unique index cmp_attendance_session_mentee_unique
  on cmp_attendance(session_id, mentee_id)
  where mentee_id is not null;

-- Each person appears at most once per role per session
create unique index cmp_attendance_session_person_role_unique
  on cmp_attendance(session_id, person_id, role)
  where person_id is not null;

create index on cmp_attendance(session_id);
create index on cmp_attendance(person_id);

alter table cmp_attendance enable row level security;

create policy "cmp_attendance_read" on cmp_attendance
  for select to authenticated
  using (true);


-- ─── CMP Mentor Notes ────────────────────────────────────────────────────────

create table cmp_mentor_notes (
  id         uuid primary key default gen_random_uuid(),
  mentee_id  uuid not null references mentees(id) on delete cascade,
  author_id  uuid references people(id),
  note       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on cmp_mentor_notes(mentee_id);
create index on cmp_mentor_notes(author_id);

alter table cmp_mentor_notes enable row level security;

create policy "cmp_mentor_notes_read" on cmp_mentor_notes
  for select to authenticated using (true);

create trigger cmp_mentor_notes_updated_at
  before update on cmp_mentor_notes
  for each row execute function update_updated_at();


-- ─── CMP Call Logs ───────────────────────────────────────────────────────────

create table cmp_call_logs (
  id               uuid primary key default gen_random_uuid(),
  mentee_id        uuid not null references mentees(id) on delete cascade,
  caller_id        uuid references people(id),
  called_at        date not null default current_date,
  duration_minutes int,
  outcome          text not null default 'reached',
  summary          text,
  created_at       timestamptz not null default now()
);

alter table cmp_call_logs
  add constraint cmp_call_logs_outcome_check
  check (outcome in ('reached', 'no_answer', 'left_voicemail', 'rescheduled'));

create index on cmp_call_logs(mentee_id);
create index on cmp_call_logs(caller_id);
create index on cmp_call_logs(called_at desc);

alter table cmp_call_logs enable row level security;

create policy "cmp_call_logs_read" on cmp_call_logs
  for select to authenticated using (true);


-- ─── Awards ──────────────────────────────────────────────────────────────────

create table awards (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid references people(id),
  type       text not null,
  year       int not null,
  citation   text,
  awarded_by uuid references people(id),
  created_at timestamptz not null default now()
);

create index on awards(person_id);

alter table awards enable row level security;

create policy "awards_read" on awards
  for select to authenticated
  using (true);


-- ─── Praise ──────────────────────────────────────────────────────────────────

create table praise (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references people(id),
  given_by     uuid references people(id),
  message      text not null,
  visibility   text not null default 'public',
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table praise
  add constraint praise_visibility_check
  check (visibility in ('public', 'admin_only'));

create index on praise(recipient_id);

alter table praise enable row level security;

create policy "praise_read" on praise
  for select to authenticated
  using (not is_archived);


-- ─── Participation Events ────────────────────────────────────────────────────

create table participation_events (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid references people(id),
  event_name  text not null,
  event_date  date,
  team_id     uuid references teams(id),
  pillar_id   uuid references pillars(id),
  notes       text,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create index on participation_events(person_id);

alter table participation_events enable row level security;

create policy "participation_events_read" on participation_events
  for select to authenticated
  using (not is_archived);


-- ─── Email Templates ─────────────────────────────────────────────────────────

create table email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  subject     text not null,
  html_body   text not null,
  category    text not null default 'general',
  is_active   boolean not null default true,
  created_by  uuid references people(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on email_templates(category);
create index on email_templates(is_active) where is_active;

alter table email_templates enable row level security;

create policy "email_templates_read" on email_templates
  for select to authenticated using (true);


-- ─── Comms Log ───────────────────────────────────────────────────────────────

create table comms_log (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid references people(id),
  template        text not null,
  recipient_email text not null,
  subject         text,
  status          text not null default 'sent',
  sent_at         timestamptz not null default now(),
  metadata        jsonb
);

alter table comms_log
  add constraint comms_log_status_check
  check (status in ('sent', 'delivered', 'failed'));

create index on comms_log(person_id);

alter table comms_log enable row level security;

create policy "comms_log_read" on comms_log
  for select to authenticated
  using (true);


-- ─── Audit Log ───────────────────────────────────────────────────────────────

create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references people(id),
  action       text not null,
  target_table text not null,
  target_id    uuid not null,
  before_value jsonb,
  after_value  jsonb,
  created_at   timestamptz not null default now()
);

alter table audit_log
  add constraint audit_log_action_check
  check (action in (
    'create', 'update', 'delete', 'archive',
    'role_grant', 'role_revoke',
    'tenure_create', 'tenure_end'
  ));

create index on audit_log(actor_id);
create index on audit_log(target_table, target_id);
create index on audit_log(created_at);

alter table audit_log enable row level security;

create policy "audit_log_read" on audit_log
  for select to authenticated
  using (true);

-- Append-only
create policy "audit_log_insert_only" on audit_log
  for insert with check (true);

create policy "audit_log_no_update" on audit_log
  as restrictive for update
  using (false);

create policy "audit_log_no_delete" on audit_log
  as restrictive for delete
  using (false);


-- ─── Onboarding Checklists ───────────────────────────────────────────────────

create table onboarding_checklists (
  id                     uuid primary key default gen_random_uuid(),
  person_id              uuid references people(id) on delete cascade not null unique,

  -- Milestones (timestamped for audit)
  welcome_sent_at        timestamptz,
  dbs_completed_at       timestamptz,
  reference_checked_at   timestamptz,
  induction_done_at      timestamptz,
  agreement_signed_at    timestamptz,
  training_completed_at  timestamptz,

  notes                  text,
  completed_at           timestamptz,  -- set when status transitions to 'active'

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index on onboarding_checklists(person_id);
create index on onboarding_checklists(completed_at) where completed_at is null;

create trigger onboarding_checklists_updated_at
  before update on onboarding_checklists
  for each row execute function update_updated_at();

alter table onboarding_checklists enable row level security;

create policy "onboarding_checklists_read" on onboarding_checklists
  for select to authenticated
  using (true);


-- ─── Notifications ───────────────────────────────────────────────────────────

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references people(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  data         jsonb,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index on notifications(recipient_id, is_read);
create index on notifications(created_at desc);

alter table notifications enable row level security;

create policy "notifications_read" on notifications
  for select to authenticated using (true);


-- ─── Team Join Requests ──────────────────────────────────────────────────────

create table team_join_requests (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  message     text,
  status      text not null default 'pending',
  reviewed_by uuid references people(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (person_id, team_id)
);

alter table team_join_requests
  add constraint team_join_requests_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index on team_join_requests(team_id, status);
create index on team_join_requests(person_id);

alter table team_join_requests enable row level security;

create policy "team_join_requests_read" on team_join_requests
  for select to authenticated using (true);


-- ─── Buddy Assignments ───────────────────────────────────────────────────────

create table buddy_assignments (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  buddy_id    uuid not null references people(id) on delete cascade,
  assigned_by uuid references people(id),
  assigned_at timestamptz not null default now(),
  ended_at    timestamptz,
  notes       text,
  constraint buddy_no_self_buddy check (person_id != buddy_id),
  unique (person_id, buddy_id)
);

create index on buddy_assignments(person_id) where ended_at is null;
create index on buddy_assignments(buddy_id) where ended_at is null;

alter table buddy_assignments enable row level security;

create policy "buddy_assignments_read" on buddy_assignments
  for select to authenticated using (true);


-- ─── Onboarding Notes ────────────────────────────────────────────────────────

create table onboarding_notes (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people(id) on delete cascade,
  author_id  uuid references people(id),
  note       text not null,
  created_at timestamptz not null default now()
);

create index on onboarding_notes(person_id);
create index on onboarding_notes(created_at desc);

alter table onboarding_notes enable row level security;

create policy "onboarding_notes_read" on onboarding_notes
  for select to authenticated using (true);


-- ─── Organisation Settings ───────────────────────────────────────────────────
-- Key-value store for chapter-level config. Writes enforced at app layer.

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


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — SUPERADMIN GUARD
-- ══════════════════════════════════════════════════════════════════════════════
-- Prevents removing the last Super Admin at DB level. Cannot be bypassed.

create or replace function check_superadmin_minimum()
returns trigger
language plpgsql
as $$
declare
  _super_role_id uuid;
  _remaining     int;
begin
  select id into _super_role_id
  from roles
  where name = 'Super Admin'
  limit 1;

  if OLD.role_id = _super_role_id then
    select count(*) into _remaining
    from user_roles
    where role_id = _super_role_id
      and id != OLD.id;

    if _remaining = 0 then
      raise exception
        'Cannot remove the last Super Admin. Assign another Super Admin first.'
        using errcode = 'P0001';
    end if;
  end if;

  return OLD;
end;
$$;

create trigger trg_superadmin_minimum
  before delete on user_roles
  for each row
  execute function check_superadmin_minimum();


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — STORAGE BUCKETS
-- ══════════════════════════════════════════════════════════════════════════════

-- Org assets (logo, branding)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-assets', 'org-assets', true, 5242880,
  array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "org_assets_public_read"             on storage.objects;
drop policy if exists "org_assets_authenticated_upload"    on storage.objects;
drop policy if exists "org_assets_authenticated_delete"    on storage.objects;

create policy "org_assets_public_read" on storage.objects
  for select using (bucket_id = 'org-assets');

create policy "org_assets_authenticated_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-assets');

create policy "org_assets_authenticated_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'org-assets');

-- Profile photos (path = person_id/photo.ext)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos', 'profile-photos', true, 5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "profile_photos_public_read"             on storage.objects;
drop policy if exists "profile_photos_authenticated_upload"    on storage.objects;
drop policy if exists "profile_photos_authenticated_delete"    on storage.objects;

create policy "profile_photos_public_read" on storage.objects
  for select using (bucket_id = 'profile-photos');

create policy "profile_photos_authenticated_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos');

create policy "profile_photos_authenticated_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos');


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — SEED DATA
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── Org settings ────────────────────────────────────────────────────────────

insert into org_settings (key, value, label, description) values
  ('dbs_validity_years', '3',  'DBS validity (years)',
    'How many years a DBS certificate is valid from its clearance date'),
  ('dbs_warn_days',      '60', 'DBS warning window (days)',
    'How many days before expiry to flag a certificate as expiring soon'),
  ('logo_url',           '',   'Organisation logo URL',
    'Public URL of the organisation logo shown in the portal header.'),
  ('allow_member_praise', 'true', 'Allow members to give praise',
    'When enabled, all members can give praise to each other. When disabled, only admins can give praise.')
on conflict (key) do nothing;

-- ─── Pillars ─────────────────────────────────────────────────────────────────

insert into pillars (name, description) values
  ('Education',            'Academic support, scholarships, and youth development'),
  ('Mentoring (CMP)',      'Community Mentoring Programme — pairing members with mentees'),
  ('Health & Wellness',    'Physical and mental wellbeing programming'),
  ('Economic Empowerment', 'Financial literacy, entrepreneurship, and career development'),
  ('Leadership',           'Chapter governance and board development')
on conflict do nothing;

-- ─── Teams ───────────────────────────────────────────────────────────────────

with p as (select id, name from pillars)
insert into teams (name, description, pillar_id) values
  ('Education',
    'Academic support, scholarships, and school partnerships',
    (select id from p where name = 'Education')),
  ('Community Mentoring Programme (CMP)',
    'Runs the CMP programme end-to-end — pairing members with mentees',
    (select id from p where name = 'Mentoring (CMP)')),
  ('Health & Wellness',
    'Health screenings, mental wellbeing, and wellness programming',
    (select id from p where name = 'Health & Wellness')),
  ('Economic Empowerment',
    'Financial literacy, entrepreneurship, and career development workshops',
    (select id from p where name = 'Economic Empowerment')),
  ('Finance',        'Chapter financial management, budgeting, and reporting', null),
  ('Membership',     'New member pipeline, onboarding, and member engagement', null),
  ('Events',         'Annual gala, fundraising drives, and chapter events',    null)
on conflict (name) do nothing;

-- ─── System roles ────────────────────────────────────────────────────────────

insert into roles (name, description, is_system_protected) values
  ('Super Admin',        'Full access to all modules and settings. Auto-granted to President.', true),
  ('Chapter Leadership', 'Senior member access — all modules readable, most editable.',         true),
  ('Team Lead',          'Manage their team members and team-level data.',                       true),
  ('Member',             'Standard active member — read-only on their own profile.',             true),
  ('Volunteer',          'External volunteer — limited read access, no dues module.',            true),
  ('Applicant',          'Pending applicant — very restricted access.',                          true)
on conflict (name) do nothing;

-- ─── Elected positions ───────────────────────────────────────────────────────

with r as (select id, name from roles)
insert into elected_positions (title, description, order_of_precedence, linked_system_role_id) values
  ('President',     'Chapter president — auto-grants Super Admin role.',  1,
    (select id from r where name = 'Super Admin')),
  ('VP Admin',      'Vice President, Administration.',                     2, null),
  ('VP Operations', 'Vice President, Operations.',                         3, null),
  ('Treasurer',     'Financial oversight and reporting.',                  4, null),
  ('Secretary',     'Records, minutes, and chapter administration.',       5, null)
on conflict do nothing;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — GRANTS
-- ══════════════════════════════════════════════════════════════════════════════
-- When tables are created via raw SQL (not the Supabase dashboard), the
-- default role grants are NOT applied automatically. We add them explicitly so
-- that the service_role key (used by server-side code and scripts) has full
-- write access, and authenticated/anon users get read access (RLS then
-- restricts further per policy).

grant usage on schema public to anon, authenticated, service_role;

grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant all     on all routines  in schema public to service_role;

grant select  on all tables    in schema public to authenticated;
grant select  on all sequences in schema public to authenticated;

grant select  on all tables    in schema public to anon;

-- Ensure future tables/sequences also get these grants automatically
alter default privileges in schema public
  grant all on tables    to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant select on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- Schema complete.
-- Next step: node --env-file=.env scripts/seed-superadmin.mjs --email=you@example.com
-- ─────────────────────────────────────────────────────────────────────────────
