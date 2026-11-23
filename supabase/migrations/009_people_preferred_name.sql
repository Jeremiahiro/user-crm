-- Everyday name. Legal name stays first_name / middle_name / last_name
-- and the generated full_name column.

alter table people
  add column if not exists preferred_name text;

comment on column people.preferred_name is
  'Name shown in the portal. Null falls back to first name, then full legal name. Not used on official exports or DBS records.';
