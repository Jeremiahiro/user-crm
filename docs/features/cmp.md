# CMP — Career Mentoring Programme

Tracks the annual mentoring programme. The CMP module has three layers: Programme Years (cohorts), Sessions (individual meetings), and Attendance (who showed up).

## Data model

```
cmp_programme_years
  └── cmp_sessions
        └── cmp_attendance
                ├── mentee_id → mentees
                └── person_id → people (mentors/facilitators)
```

## Programme Years

A programme year groups a cohort of sessions and mentees. Example: "2024–25 Cohort".

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cmp/years` | List all years (includes session count) |
| POST | `/api/cmp/years` | Create year (`name`, `start_date`, `end_date`) |
| GET | `/api/cmp/years/:id` | Single year with all sessions + attendance counts |
| PUT | `/api/cmp/years/:id` | Update year details |

### Admin pages

| Path | Description |
|------|-------------|
| `/admin/cmp/years` | List all programme years with session counts |
| `/admin/cmp/years/new` | Create year form |
| `/admin/cmp/years/:id` | Year detail: stat cards + sessions table with attendance links |
| `/admin/cmp/years/:id/edit` | Edit name and dates |

## Sessions

A session is a single meeting within a programme year.

### Session types
- `regular` — standard weekly/monthly session
- `special` — guest speakers, workshops, etc.
- `trip` — off-site visits

Sessions can be marked as cancelled with an optional cancellation reason. Cancelled sessions show a CANCELLED badge in all lists.

**Deletion rule:** A session with recorded attendance cannot be deleted. Clear attendance first.

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cmp/sessions` | List sessions (filter: `year_id`) |
| POST | `/api/cmp/sessions` | Create session |
| GET | `/api/cmp/sessions/:id` | Single session with full attendance detail |
| PUT | `/api/cmp/sessions/:id` | Update (including cancellation) |
| DELETE | `/api/cmp/sessions/:id` | Delete (blocks if attendance exists) |

### Admin pages

| Path | Description |
|------|-------------|
| `/admin/cmp/sessions/new?year_id=:id` | Create session, pre-selects year |
| `/admin/cmp/sessions/:id` | Session detail: notes, cancellation info, attendance summary + table |
| `/admin/cmp/sessions/:id/edit` | Edit details + cancellation toggle |
| `/admin/cmp/sessions/:id/attendance` | Attendance marking page |

## Attendance

Attendance is recorded per session for both mentees and member mentors. Each combination of (session, mentee) and (session, person) is unique — the unique constraints enforce this at the DB level, and the API upserts to handle re-clicks.

### Status values

| Value | Meaning |
|-------|---------|
| `present` | Attended |
| `absent` | Did not attend, no notice |
| `apology` | Sent apology / gave notice |

### Attendance marking page

`/admin/cmp/sessions/:id/attendance` — the primary attendance tool:

- Lists all mentees enrolled in the session's programme year
- Lists all member mentors linked to those mentees (deduplicated)
- Each row shows three buttons: Present / Absent / Apology
- Clicking a button fires a POST to `/api/cmp/attendance` immediately (no form submit)
- The API uses `upsert` with `onConflict: 'session_id,mentee_id'` or `'session_id,person_id'`
- Optimistic UI: buttons update instantly; a "Saved" / "Error" status indicator appears briefly

### Attendance API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/cmp/attendance` | `{session_id, mentee_id?, person_id?, status}` | Upsert attendance record |
| DELETE | `/api/cmp/attendance` | `{id}` | Remove attendance record |

## Database

```sql
cmp_programme_years (
  id         uuid primary key,
  name       text not null,
  start_date date,
  end_date   date,
  created_at timestamptz
)

cmp_sessions (
  id                  uuid primary key,
  programme_year_id   uuid references cmp_programme_years(id),
  title               text not null,
  session_date        date not null,
  session_time        time,
  location            text,
  type                text check (type in ('regular','special','trip')),
  notes               text,
  is_cancelled        boolean default false,
  cancellation_reason text,
  created_at          timestamptz
)

cmp_attendance (
  id          uuid primary key,
  session_id  uuid not null references cmp_sessions(id),
  person_id   uuid references people(id),
  mentee_id   uuid references mentees(id),
  status      text not null check (status in ('present','absent','apology')),
  recorded_by uuid references people(id),
  recorded_at timestamptz,
  unique (session_id, person_id),
  unique (session_id, mentee_id)
)
```

## Mentee assignment to programme years

Mentees are linked to a programme year via `mentees.programme_year_id`. The attendance marking page automatically loads all mentees in the session's year — no need to enrol mentees per session individually.

Mentors shown on the attendance page are derived from `mentees.mentor_id` within that programme year.
