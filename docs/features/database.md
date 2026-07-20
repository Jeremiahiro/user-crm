# Database Schema

## Overview

The database is a managed PostgreSQL instance hosted on Supabase. The schema is defined in `supabase/migrations/001_schema.sql` and seeded by `supabase/migrations/002_seed.sql`. All schema changes must go through versioned migration files — never make ad-hoc changes to a production database through the Supabase dashboard.

---

## Conventions

**UUID primary keys.** Every table uses `id uuid primary key default gen_random_uuid()`. IDs are never generated in application code.

**`updated_at` triggers.** Tables with mutable data have an `updated_at timestamptz` column and a `BEFORE UPDATE` trigger that calls the shared `update_updated_at()` function. This means callers never need to set `updated_at` manually.

**Soft delete.** Most records are never hard-deleted. Mutable entity tables use `is_archived boolean not null default false`. Active records are queried with `.eq('is_archived', false)`. Teams and pillars use `is_active boolean` instead of `is_archived`, but the principle is the same.

**Row Level Security.** RLS is enabled on every table. The general policy for each table allows `SELECT` for authenticated users and restricts writes to the service role (used by `supabaseAdmin` in API routes). Compliance tables additionally block `DELETE` at the RLS layer.

**Compliance tables — no delete ever.** Three tables are append-only by regulatory or governance requirement: `elected_position_tenures`, `dues`, and `dbs_records`. Each has a restrictive RLS policy `FOR DELETE USING (false)`. There are also no delete routes in the API for these tables.

**Audit log — append-only.** The `audit_log` table has restrictive policies blocking both `UPDATE` and `DELETE`. It can only receive `INSERT` operations.

---

## Tables

### `people`
Central person record. Every individual who interacts with the chapter — member, mentor, volunteer, alumni, parent, or trustee — has exactly one row here.

Key columns: `full_name`, `email` (unique), `person_types text[]`, `status text` (applicant/pending_review/approved/active/inactive/alumni/left), `is_archived boolean`. Has `updated_at` trigger.

### `pillars`
The five strategic pillars of the chapter. Reference data that rarely changes.

Key columns: `name`, `description`, `display_order int`, `is_active boolean`.

### `teams`
Functional committees and working groups. Each team optionally belongs to one pillar.

Key columns: `name`, `description`, `pillar_id uuid references pillars(id)`, `is_active boolean`.

### `person_teams`
Join table: person ↔ team membership. Records when someone joined a team and whether they are a team lead for it.

Key columns: `person_id`, `team_id`, `is_team_lead boolean`, `joined_at timestamptz`. Unique constraint on `(person_id, team_id)`.

### `roles`
System role definitions. Roles are data — nothing is hard-coded. System-protected roles cannot be archived or deleted.

Key columns: `name text` (unique), `description`, `is_system_protected boolean`, `is_archived boolean`.

### `role_permissions`
Permissions attached to a role, one row per module–operation–scope combination.

Key columns: `role_id`, `module text`, `operation text` (create/read/update/delete), `scope text` (all/own_team/own_record). Unique constraint on `(role_id, module, operation)`.

### `user_roles`
Records which roles a person holds and when each was assigned.

Key columns: `person_id`, `role_id`, `assigned_by uuid references people(id)`, `assigned_at timestamptz`.

### `user_permission_overrides`
Per-person permission overrides that supplement or restrict their role-based permissions. Allows an individual to be granted or denied a specific permission without changing their role.

Key columns: `person_id`, `module`, `operation`, `scope`, `type text` (allow/deny), `reason`, `set_by`, `set_at`.

### `elected_positions`
Definitions of the chapter's formal governance positions (President, VP Admin, etc.). The `linked_system_role_id` enables automatic role grants on tenure assignment.

Key columns: `title`, `description`, `order_of_precedence int`, `linked_system_role_id uuid references roles(id)`, `is_active boolean`.

### `elected_position_tenures`
Permanent record of who has held each elected position and when. Compliance table — no deletes permitted.

Key columns: `position_id`, `person_id`, `term_start date`, `term_end date` (NULL = currently serving), `elected_by text` (chapter_vote/board_appointment/co_option), `notes`, `created_by`. Partial unique index on `(position_id) WHERE term_end IS NULL` enforces one active holder per position.

### `dues`
Month-by-month record of whether a member has paid their dues. Compliance table — no deletes permitted.

Key columns: `person_id`, `year int`, `month int` (1–12), `paid_at timestamptz`, `recorded_by`. Unique constraint on `(person_id, year, month)`.

### `dbs_records`
DBS (Disclosure and Barring Service) certificate records. Compliance table — no deletes permitted.

Key columns: `person_id`, `certificate_reference`, `clearance_date date`, `expiry_date date`, `drive_url text` (link to certificate in Google Drive), `recorded_by`.

### `documents`
Metadata for files stored in Google Drive. Supports tokenised upload links for unauthenticated document submission.

Key columns: `person_id`, `team_id`, `type text` (dbs/photo_id/passport/training/agreement/other), `description`, `drive_url`, `upload_token text` (unique; nanoid for tokenised links), `upload_status text` (pending/uploaded/matched/unmatched), `uploaded_email`, `is_archived boolean`.

### `mentees`
Young people enrolled in the Community Mentoring Programme. Not the same as `people` — mentees are programme participants, not chapter members.

Key columns: `full_name`, `date_of_birth date`, `year_group`, `school`, `mentor_id uuid references people(id)`, `is_archived boolean`.

### `cmp_programme_years`
Defines a CMP academic year or cohort period.

Key columns: `name`, `start_date date`, `end_date date`.

### `cmp_sessions`
Individual CMP sessions within a programme year. Sessions can be cancelled with a reason recorded.

Key columns: `programme_year_id`, `title`, `session_date date`, `session_time time`, `location`, `type text` (regular/special/trip), `notes`, `is_cancelled boolean`, `cancellation_reason`.

### `cmp_attendance`
Attendance record per person or mentee per session. Status is present, absent, or apology.

Key columns: `session_id`, `person_id` (nullable), `mentee_id` (nullable), `status text` (present/absent/apology), `recorded_by`, `recorded_at`. Unique constraints on `(session_id, person_id)` and `(session_id, mentee_id)`.

### `awards`
Formal awards given to members. Permanent record — no deletes.

Key columns: `person_id`, `type text`, `year int`, `citation`, `awarded_by`.

### `praise`
Peer or leadership recognition messages. Can be soft-deleted by an admin if inappropriate, but not edited.

Key columns: `recipient_id`, `given_by`, `message`, `visibility text` (public/admin_only), `is_archived boolean`.

### `participation_events`
Ad-hoc log of events a member has participated in beyond the structured modules.

Key columns: `person_id`, `event_name`, `event_date date`, `team_id`, `pillar_id`, `notes`, `is_archived boolean`.

### `comms_log`
Record of every email sent by the system via the Gmail API.

Key columns: `person_id`, `template text`, `recipient_email`, `subject`, `status text` (sent/delivered/failed), `sent_at`, `metadata jsonb`.

### `audit_log`
Immutable record of every mutation in the system. Append-only — no updates or deletes permitted at any layer.

Key columns: `actor_id uuid references people(id)`, `action text` (create/update/delete/archive/role_grant/role_revoke/tenure_create/tenure_end), `target_table text`, `target_id uuid`, `before_value jsonb`, `after_value jsonb`, `created_at`.

---

## Seed Data

`supabase/migrations/002_seed.sql` inserts the following reference data using `ON CONFLICT DO NOTHING`, so re-running it is idempotent:

- **5 pillars** in display order: Education, Mentoring (CMP), Health & Wellness, Economic Empowerment, Leadership
- **8 teams**: five pillar-aligned (Education Committee, Mentoring Team, Health & Wellness Committee, Economic Empowerment Team, Leadership & Governance) plus three cross-cutting (Communications, Events & Fundraising, Membership & Onboarding)
- **6 system roles** marked `is_system_protected = true`: Super Admin, Chapter Leadership, Team Lead, Member, Volunteer, Applicant
- **5 elected positions**: President (linked to Super Admin role), VP Admin, VP Operations, Treasurer, Secretary

The seed file uses CTEs to look up pillar and role IDs by name, avoiding hard-coded UUIDs.

---

## Running Migrations

```bash
# Apply all pending migrations to the linked Supabase project
supabase db push

# Reset the database and re-apply all migrations from scratch (development only)
supabase db reset

# Generate TypeScript types from the current schema
supabase gen types typescript --local > src/types/supabase.gen.ts
```

New migrations should be named sequentially (`003_feature.sql`, `004_feature.sql`, …) and include a comment header with the migration number, date, and purpose.
