-- ─── Remove "approved" onboarding stage ─────────────────────────────────────
--
-- The approved stage has been collapsed into the activation step.
-- Move any people currently stuck in 'approved' directly to 'active',
-- setting person_types and date_joined if not already set.

update people
set
  status       = 'active',
  person_types = case
    when 'member' = any(person_types) then person_types
    else array_append(person_types, 'member')
  end,
  date_joined  = coalesce(date_joined, current_date)
where status = 'approved';
