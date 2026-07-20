# Mentees

Manages young people enrolled in the 100BMOL mentoring programme (CMP — Career Mentoring Programme). Mentees are distinct from members — they are not chapter members, they do not log in, and they have no system roles.

## Core concepts

**Separate from members** — Mentees live in their own `mentees` table. They are not in `people`. They have no authentication, roles, or dues.

**Mentor assignment** — Each mentee can be assigned a mentor (`mentor_id` references `people.id`). One mentor can have multiple mentees.

**Programme year** — Mentees are optionally linked to a `cmp_programme_years` record, which groups a cohort of sessions together.

**Attendance tracking** — Session attendance for mentees is recorded in `cmp_attendance` (linked by `mentee_id` and `cmp_session_id`). Attendance history is shown on the mentee detail page.

**Archive blocker** — Mentees cannot be archived if they have attendance records. This preserves the programme's attendance data integrity.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mentees` | List mentees (filter: `mentor_id`, `programme_year_id`, `q`) |
| POST | `/api/mentees` | Create a mentee |
| GET | `/api/mentees/:id` | Single mentee with mentor, programme year, attendance |
| PUT | `/api/mentees/:id` | Update mentee details |
| DELETE | `/api/mentees/:id` | Archive (blocks if attendance records exist) |

### POST /api/mentees

```json
{
  "full_name": "required",
  "email": "required",
  "phone": "optional",
  "school": "optional",
  "year_group": "optional",
  "date_of_birth": "YYYY-MM-DD optional",
  "parent_guardian_name": "optional",
  "parent_guardian_email": "optional",
  "parent_guardian_phone": "optional",
  "mentor_id": "uuid optional",
  "programme_year_id": "uuid optional",
  "notes": "optional"
}
```

## Admin pages

| Path | Description |
|------|-------------|
| `/admin/mentees` | List with search (name/email/school), mentor filter, programme year filter |
| `/admin/mentees/new` | Create mentee — three sections: details, parent/guardian, programme |
| `/admin/mentees/:id` | Profile: details, programme info, parent/guardian, notes, attendance history |
| `/admin/mentees/:id/edit` | Edit all fields |

## Attendance

Attendance is recorded per CMP session. The mentee profile shows a table of all sessions they were enrolled in, with attended/absent status for each.

Sessions are managed through the CMP module (Phase 4). Attendance records are created when an admin marks attendance for a session.

## Parent/guardian

The system stores parent/guardian contact details (name, email, phone). These are for admin reference only — no communication is sent from the CRM to parents/guardians (this requires explicit consent management, handled outside the system).

## Database

```sql
mentees (
  id                    uuid primary key,
  full_name             text not null,
  email                 text not null unique,
  phone                 text,
  school                text,
  year_group            text,
  date_of_birth         date,
  parent_guardian_name  text,
  parent_guardian_email text,
  parent_guardian_phone text,
  mentor_id             uuid references people(id),
  programme_year_id     uuid references cmp_programme_years(id),
  notes                 text,
  is_archived           boolean default false,
  created_at            timestamptz,
  updated_at            timestamptz
)
```
