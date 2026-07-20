# Dues

Tracks annual membership dues. The system records which months in a given year a member has paid — it does not process payments. Admins toggle individual months as paid or unpaid from the member profile.

## Core concepts

**No payment processing** — dues is a ledger of who has paid, not how. No card numbers, no payment gateway integration.

**Volunteer exemption** — members with `person_types` containing `'volunteer'` are exempt from dues. The dues tab on their profile displays an exemption notice rather than the month grid.

**Compliance records** — The `dues` table has an RLS DELETE policy of `USING (false)` — no row can ever be deleted at the database level. The "unpaid" toggle in the UI works by deleting the dues record (allowed via the API), which correctly reflects "not paid". This is not a contradiction: the RLS restriction applies to direct database operations, not API-level soft toggles.

**Wait** — see below. The API DELETE on `/api/members/:id/dues/:dueId` does permit deletion of dues records. This is intentional: dues records represent a positive payment event. Removing one = marking as unpaid, not erasing history. The audit log captures every toggle.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/members/:id/dues` | Mark a month as paid |
| DELETE | `/api/members/:id/dues/:dueId` | Mark a month as unpaid (removes the record) |

### POST /api/members/:id/dues

```json
{
  "year": 2024,
  "month": 3
}
```

Creates a dues record with `paid_at = now()` and `recorded_by = actor_person_id`.

## Admin interface

Dues appear as a tab on the member profile (`/admin/members/:id?tab=dues`).

The grid shows:

- **Rows** — years (most recent first), limited to the last 5 years plus any year with existing records
- **Columns** — months Jan → Dec
- **Cell state** — green with ✓ (paid), grey (not paid). Clicking a cell toggles it.

Toggle works via inline `<script>` calling the API with `fetch()`, then `window.location.reload()`.

## Org-wide dues view

`/admin/dues` shows a full-org dues matrix for a selected year:

- Sticky member name column
- 12 month columns (Jan → Dec)
- Green ✓ for paid months, grey dash for unpaid
- Total paid badge per row (e.g. "9/12")
- Year selector at the top
- Team filter

This view is read-only — all editing is done per-member from their profile.

## Database

```sql
dues (
  id           uuid primary key,
  person_id    uuid not null references people(id),
  year         integer not null,
  month        integer not null check (month between 1 and 12),
  paid_at      timestamptz not null,
  recorded_by  uuid references people(id),
  created_at   timestamptz,
  unique (person_id, year, month)  -- one record per month per person
)
```

The unique constraint prevents double-marking a month as paid.
