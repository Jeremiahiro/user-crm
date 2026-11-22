-- Session end time collected by the CMP new/edit forms.
-- Writes go through the service role; no RLS change.

alter table cmp_sessions
  add column if not exists session_end_time time;

comment on column cmp_sessions.session_end_time is
  'Optional end time for the session. Start time remains session_time.';
