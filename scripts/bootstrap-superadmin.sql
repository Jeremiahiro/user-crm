-- ─────────────────────────────────────────────────────────────────────────────
-- Bootstrap: grant Super Admin to the first admin
--
-- Run this ONCE in Supabase Studio → SQL Editor after deploying the migrations.
-- The person must have already signed in at least once via Google OAuth so
-- that their email exists in the `people` table.
--
-- Usage:
--   1. Replace the email below with the admin's Google account address.
--   2. Paste into SQL Editor and click Run.
--   3. Verify with the SELECT at the bottom.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  _admin_email   text    := 'operations@100bmol.org.uk';
  _person_id     uuid;
  _role_id       uuid;
begin
  -- Resolve person
  select id into _person_id
  from people
  where email = _admin_email
    and is_archived = false
  limit 1;

  if _person_id is null then
    raise exception
      'No person found with email %. Sign in with Google first, then re-run this script.',
      _admin_email;
  end if;

  -- Resolve Super Admin role
  select id into _role_id
  from roles
  where name = 'Super Admin'
  limit 1;

  if _role_id is null then
    raise exception 'Super Admin role not found. Make sure 002_seed.sql has been applied.';
  end if;

  -- Grant — idempotent (on conflict do nothing)
  insert into user_roles (person_id, role_id)
  values (_person_id, _role_id)
  on conflict do nothing;

  raise notice 'Super Admin granted to % (%)', _admin_email, _person_id;
end;
$$;

-- Verify
select
  p.full_name,
  p.email,
  p.status,
  r.name as role
from user_roles ur
join people p on p.id = ur.person_id
join roles   r on r.id = ur.role_id
where r.name = 'Super Admin';
