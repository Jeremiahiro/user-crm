-- 003_certifications.sql recreated documents without RLS and added
-- document_types, trainings, training_assignments, and training_completions
-- with none. Match the rest of the schema: authenticated may select;
-- writes stay on the service role (no insert/update/delete policies).

alter table documents enable row level security;
alter table document_types enable row level security;
alter table trainings enable row level security;
alter table training_assignments enable row level security;
alter table training_completions enable row level security;

drop policy if exists "documents_read" on documents;
create policy "documents_read" on documents
  for select to authenticated
  using (true);

drop policy if exists "document_types_read" on document_types;
create policy "document_types_read" on document_types
  for select to authenticated
  using (true);

drop policy if exists "trainings_read" on trainings;
create policy "trainings_read" on trainings
  for select to authenticated
  using (true);

drop policy if exists "training_assignments_read" on training_assignments;
create policy "training_assignments_read" on training_assignments
  for select to authenticated
  using (true);

drop policy if exists "training_completions_read" on training_completions;
create policy "training_completions_read" on training_completions
  for select to authenticated
  using (true);
