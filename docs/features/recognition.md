# Recognition

Three modules for recognising member contributions: Awards (formal annual recognition), Praise (informal peer-style messages), and Participation Events (logging attendance at chapter activities).

---

## Awards

Formal annual awards given to members.

### Award types

| Value | Label |
|-------|-------|
| `member_of_the_year` | Member of the Year |
| `volunteer_of_the_year` | Volunteer of the Year |
| `mentor_of_the_year` | Mentor of the Year |
| `rising_star` | Rising Star |
| `community_impact` | Community Impact |
| `leadership_excellence` | Leadership Excellence |
| `special_recognition` | Special Recognition |

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/awards` | List awards (filter: `person_id`, `year`) |
| POST | `/api/awards` | Create award. `awarded_by` defaults to the acting admin. |
| DELETE | `/api/awards/:id` | Delete award (hard delete — awards can be corrected) |

```json
POST /api/awards
{
  "person_id": "uuid",
  "type": "member_of_the_year",
  "year": 2024,
  "citation": "Optional citation text"
}
```

### Admin pages

| Path | Description |
|------|-------------|
| `/admin/awards` | All awards with year filter, gold trophy display |
| `/admin/awards/new?person_id=:id` | Give award (pre-fills member if person_id supplied) |

Awards also appear on member profiles under a dedicated section (wired up in Phase 6 dashboards).

---

## Praise

Informal recognition messages from admins. Displayed as a chronological feed.

### Visibility

| Value | Behaviour |
|-------|-----------|
| `public` | Visible to all authenticated admins |
| `admin_only` | Only for internal admin use; marked with an "Admin only" badge |

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/praise` | List praise (filter: `recipient_id`, `visibility`) |
| POST | `/api/praise` | Give praise. `given_by` set from session. |
| DELETE | `/api/praise/:id` | Archive (soft delete) |

```json
POST /api/praise
{
  "recipient_id": "uuid",
  "message": "Text of the praise",
  "visibility": "public"
}
```

### Admin pages

| Path | Description |
|------|-------------|
| `/admin/praise` | Praise feed — cards with gold left-border, visibility filter |
| `/admin/praise/new?person_id=:id` | Give praise form |

---

## Participation Events

Logs individual members' participation in chapter events, external conferences, panels, and other activities.

Each record links to a member, an optional team, and an optional pillar — enabling filtering by theme or team.

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/participation` | List events (filter: `person_id`, `team_id`, `pillar_id`) |
| POST | `/api/participation` | Log a participation event |
| DELETE | `/api/participation/:id` | Archive (soft delete) |

```json
POST /api/participation
{
  "person_id": "uuid",
  "event_name": "Black History Month Panel",
  "event_date": "2024-10-15",
  "team_id": "uuid | null",
  "pillar_id": "uuid | null",
  "notes": "Optional context"
}
```

### Admin pages

| Path | Description |
|------|-------------|
| `/admin/participation` | List with pillar/team filter |
| `/admin/participation/new?person_id=:id` | Log event (pre-fills member) |

---

## Database

```sql
awards (
  id         uuid primary key,
  person_id  uuid references people(id),
  type       text not null,
  year       int not null,
  citation   text,
  awarded_by uuid references people(id),
  created_at timestamptz
)

praise (
  id           uuid primary key,
  recipient_id uuid references people(id),
  given_by     uuid references people(id),
  message      text not null,
  visibility   text not null default 'public'
                 check (visibility in ('public','admin_only')),
  is_archived  boolean default false,
  created_at   timestamptz
)

participation_events (
  id          uuid primary key,
  person_id   uuid references people(id),
  event_name  text not null,
  event_date  date,
  team_id     uuid references teams(id),
  pillar_id   uuid references pillars(id),
  notes       text,
  is_archived boolean default false,
  created_at  timestamptz
)
```
