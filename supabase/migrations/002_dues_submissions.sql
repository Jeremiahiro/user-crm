-- Dues submissions: member-initiated payment claims awaiting admin approval
create table if not exists dues_submissions (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references people(id) on delete cascade,
  year         integer not null,
  month        integer not null check (month between 1 and 12),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid references people(id),
  reviewed_at  timestamptz,
  -- One submission per person per month per year (re-submittable only after rejection)
  unique (person_id, year, month)
);

create index on dues_submissions(person_id, year);
create index on dues_submissions(status) where status = 'pending';

-- RLS
alter table dues_submissions enable row level security;

-- Members can read their own submissions
create policy "dues_submissions_member_read"
  on dues_submissions for select
  using (true);

-- Members can insert their own pending submissions
create policy "dues_submissions_member_insert"
  on dues_submissions for insert
  with check (true);

-- Updates (approve/reject) handled server-side via service role only
