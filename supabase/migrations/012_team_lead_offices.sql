-- 012_team_lead_offices.sql
--
-- Team leads become offices. Every team owns exactly one lead office in
-- elected_positions (team_id set). Offices can carry a shared mailbox
-- (email) that signs in as whoever currently holds the office.
--
-- person_teams.is_team_lead is kept, but is now derived from the lead
-- office's open tenure by trigger. Change leads by assigning the office.

-- ─── Columns ──────────────────────────────────────────────────────────────────

alter table elected_positions
  add column if not exists email   text,
  add column if not exists team_id uuid references teams(id) on delete set null;

alter table elected_positions
  add constraint elected_positions_email_lowercase check (email is null or email = lower(btrim(email)));

create unique index if not exists elected_positions_email_key
  on elected_positions (email) where email is not null;

create unique index if not exists elected_positions_team_id_key
  on elected_positions (team_id) where team_id is not null;

-- Which office mailbox the actor signed in through, when not their own email
alter table audit_log add column if not exists actor_via text;

alter table audit_log drop constraint if exists audit_log_action_check;
alter table audit_log
  add constraint audit_log_action_check
  check (action in (
    'create', 'update', 'delete', 'archive',
    'role_grant', 'role_revoke',
    'tenure_create', 'tenure_end', 'tenure_delete'
  ));

-- Office mailboxes replace the short-lived 'system' person type
update people
set person_types = array_remove(person_types, 'system')
where 'system' = any(person_types);

-- ─── Backfill: one lead office per team ───────────────────────────────────────

insert into elected_positions (title, description, team_id, is_active)
select t.name || ' Lead', 'Leads the ' || t.name || ' team.', t.id, t.is_active
from teams t
where not exists (select 1 from elected_positions p where p.team_id = t.id);

-- ─── Backfill: keep one lead per team (earliest to join wins) ─────────────────

do $$
declare
  r record;
begin
  for r in
    with ranked as (
      select pt.id, pt.team_id, pt.person_id,
             row_number() over (partition by pt.team_id order by pt.joined_at, pt.id) as rn
      from person_teams pt
      where pt.is_team_lead
    )
    select ranked.id, t.name as team_name, p.full_name
    from ranked
    join teams t on t.id = ranked.team_id
    join people p on p.id = ranked.person_id
    where ranked.rn > 1
  loop
    raise notice 'Team "%": % is no longer a lead (one lead per team)', r.team_name, r.full_name;
    update person_teams set is_team_lead = false where id = r.id;
  end loop;
end $$;

insert into elected_position_tenures (position_id, person_id, term_start, elected_by, notes)
select p.id, pt.person_id, pt.joined_at::date, 'board_appointment', 'Carried over from team lead flag'
from person_teams pt
join elected_positions p on p.team_id = pt.team_id
where pt.is_team_lead
  and not exists (
    select 1 from elected_position_tenures e
    where e.position_id = p.id and e.term_end is null
  );

create unique index if not exists person_teams_one_lead_per_team
  on person_teams (team_id) where is_team_lead;

-- ─── Sync: lead office tenure → person_teams.is_team_lead ─────────────────────

create or replace function sync_team_lead_from_tenure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position_id uuid;
  v_team_id     uuid;
  v_holder_id   uuid;
begin
  if tg_op = 'DELETE' then
    v_position_id := old.position_id;
  else
    v_position_id := new.position_id;
  end if;

  select team_id into v_team_id from elected_positions where id = v_position_id;
  if v_team_id is null then
    return null;
  end if;

  select person_id into v_holder_id
  from elected_position_tenures
  where position_id = v_position_id and term_end is null;

  update person_teams
  set is_team_lead = false
  where team_id = v_team_id
    and is_team_lead
    and person_id is distinct from v_holder_id;

  if v_holder_id is not null then
    insert into person_teams (person_id, team_id, is_team_lead)
    values (v_holder_id, v_team_id, true)
    on conflict (person_id, team_id) do update set is_team_lead = true;
  end if;

  return null;
end;
$$;

drop trigger if exists elected_position_tenures_sync_team_lead on elected_position_tenures;
create trigger elected_position_tenures_sync_team_lead
  after insert or update or delete on elected_position_tenures
  for each row execute function sync_team_lead_from_tenure();

-- ─── Sync: teams → their lead office ──────────────────────────────────────────

create or replace function sync_team_lead_office()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into elected_positions (title, description, team_id, is_active)
    values (new.name || ' Lead', 'Leads the ' || new.name || ' team.', new.id, new.is_active)
    on conflict do nothing;
  else
    update elected_positions
    set title     = case when title = old.name || ' Lead' then new.name || ' Lead' else title end,
        is_active = new.is_active
    where team_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists teams_sync_lead_office on teams;
create trigger teams_sync_lead_office
  after insert or update of name, is_active on teams
  for each row execute function sync_team_lead_office();
