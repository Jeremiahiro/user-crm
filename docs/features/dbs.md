# DBS Records

Tracks Disclosure and Barring Service (DBS) certificate records for members. DBS checks are mandatory for members involved in the mentoring programme who work with young people.

## Core concepts

**Permanent records** — DBS entries can never be deleted. The table has an RLS policy `FOR DELETE USING (false)`. The API has no DELETE endpoint for DBS records. This is a compliance requirement: the audit trail of when checks were conducted and when they expire must be preserved permanently.

**Expiry tracking** — Each record stores a `clearance_date` and `expiry_date`. The dashboard stat card highlights members with DBS expiring within 60 days.

**Multiple records per person** — Members may have more than one DBS record (e.g. a renewal). All records are retained. The most recent valid record is used for expiry calculations.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dbs` | List DBS records (filter: `person_id`) |
| POST | `/api/dbs` | Create a new DBS record |

### POST /api/dbs

```json
{
  "person_id": "uuid (required)",
  "certificate_reference": "optional string",
  "clearance_date": "YYYY-MM-DD",
  "expiry_date": "YYYY-MM-DD",
  "drive_url": "optional URL to Drive copy of certificate"
}
```

## Admin interface

DBS records appear as a tab on the member profile (`/admin/members/:id?tab=dbs`).

The tab shows:

- Table of all DBS records with certificate reference, clearance date, expiry date, days remaining, and Drive link
- "Days remaining" computed in the browser from `expiry_date`
- Colour coding: red if expired, amber if within 60 days, green if valid
- "Add DBS record" button → `/admin/members/:id/dbs/new`

### Add DBS record page

`/admin/members/:id/dbs/new` — form with:

- Certificate reference
- Clearance date
- Expiry date
- Google Drive URL (link to scanned certificate stored in Drive)

An info banner reminds admins that DBS records are permanent.

## Expiry dashboard

The main dashboard (`/dashboard`) shows a stat card: "DBS expiring in 60 days". This queries:

```sql
SELECT count(*) FROM dbs_records
WHERE expiry_date <= now() + interval '60 days'
  AND expiry_date > now()
```

## Database

```sql
dbs_records (
  id                    uuid primary key,
  person_id             uuid not null references people(id),
  certificate_reference text,
  clearance_date        date,
  expiry_date           date,
  drive_url             text,
  recorded_by           uuid references people(id),
  created_at            timestamptz,
  updated_at            timestamptz
)
```

RLS policy prevents all deletes:
```sql
create policy "dbs_no_delete" on dbs_records
  as restrictive for delete using (false);
```
