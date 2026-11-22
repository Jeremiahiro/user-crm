-- Code treats "Admin" and "Mentor" as role names (see src/lib/rbac.ts).
-- 001 only seeded Super Admin, Chapter Leadership, Team Lead, Member,
-- Volunteer, and Applicant. Insert the missing roles when absent so
-- access checks can be assigned without editing the applied seed.

insert into roles (name, description, is_system_protected) values
  ('Admin',  'Chapter administrator — same portal access as Chapter Leadership.', true),
  ('Mentor', 'CMP mentor — programme sessions, attendance, and mentees.', true)
on conflict (name) do nothing;
