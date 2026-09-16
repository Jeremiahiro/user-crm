-- ── member_notes — timestamped admin notes on any member/volunteer profile ────

create table if not exists member_notes (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  note        text not null,
  author_id   uuid references people(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table member_notes is
  'Admin notes and updates attached to a person profile';

create index on member_notes(person_id, created_at desc);

alter table member_notes enable row level security;

create policy "member_notes_read" on member_notes
  for select to authenticated using (true);
