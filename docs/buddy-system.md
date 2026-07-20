# Buddy System

## Overview

The buddy system pairs members together for peer support, accountability, and community connection. Each active member can have one buddy at a time. The relationship is bidirectional — both people benefit from the pairing, and both are notified when the pairing starts or ends.

Buddies are assigned by admins (Super Admin, Admin, Chapter Leadership). Members cannot self-assign; this ensures thoughtful pairings based on goals, tenure, or chapter need.

---

## Database Schema

### `buddy_assignments` table

| Column        | Type        | Description |
|---------------|-------------|-------------|
| `id`          | uuid (PK)   | Auto-generated primary key |
| `person_id`   | uuid (FK)   | The primary member in the pair (references `people.id`) |
| `buddy_id`    | uuid (FK)   | The buddy (references `people.id`) |
| `assigned_by` | uuid (FK)   | Admin who created the pairing (references `people.id`) |
| `assigned_at` | timestamptz | When the pairing was created (default: now) |
| `ended_at`    | timestamptz | When the pairing ended; NULL means still active |
| `notes`       | text        | Optional admin notes about the pairing |

**Constraints:**
- `buddy_no_self_buddy`: A person cannot be their own buddy (`person_id != buddy_id`)
- `unique(person_id, buddy_id)`: Each pair can only have one row (history is preserved via `ended_at` vs. a separate archive approach — once a row ends, a new one can be created)

**Bidirectional nature:** Only one row is inserted per pair. Queries read both directions: a member's buddy is found by checking rows where `person_id = me` OR `buddy_id = me` where `ended_at IS NULL`.

**Indexes:**
- `(person_id) WHERE ended_at IS NULL` — fast lookup of active buddy
- `(buddy_id) WHERE ended_at IS NULL` — fast reverse lookup

**Row-Level Security:** Enabled; all authenticated users can select from this table (public read of pairings is acceptable since the member portal is authenticated-only).

---

## How Assignment Works

1. Admin navigates to a member's edit page (`/admin/members/{id}/edit`)
2. In the "Buddy" section, selects another active member from the dropdown
3. Clicks "Assign buddy" — this POSTs to `/api/buddies`
4. The API:
   - Validates both people are active members
   - Checks neither already has an active buddy
   - Inserts one row into `buddy_assignments`
   - Notifies both people via the notifications system
   - Writes an audit log entry

---

## What Members See

### Dashboard — "My Buddy" card

If the member has an active buddy, the dashboard shows a card with:
- Buddy's full name
- Buddy's email and/or phone (for easy contact)
- A link to view the buddy's profile

If no buddy is assigned: "No buddy assigned yet."

### Dashboard — "I am buddy to" section

Shows who this member is a buddy for (rows where `buddy_id = me` and `ended_at IS NULL`). Helps members know they have a responsibility to someone else.

### Member profile (`/admin/members/{id}`)

Shows current buddy in a dedicated card. Admins can see the assignment date and admin notes.

---

## Rules

- **One active buddy per person:** Before assigning, the API checks that neither person already has a row with `ended_at IS NULL` (in either direction).
- **Ending a pairing:** An admin sets `ended_at = now()` via DELETE `/api/buddies/{id}`. History is preserved; the row is not deleted.
- **History preserved:** Past pairings remain in the table with `ended_at` set. This allows reporting on how many pairings a member has had over time.

---

## Admin Features

- **Buddy assignment:** Available on the member edit page (`/admin/members/{id}/edit`) in the "Buddy" section. Shows current buddy (if any) with a "Remove buddy" button, or a dropdown of all active members to assign if no buddy exists.
- **View all pairs:** Future admin page at `/admin/buddies` (planned) — lists all active and historical pairings with dates.
- **End a pairing:** Via the "Remove buddy" button on the member edit page, which calls DELETE `/api/buddies/{id}`.

---

## Notifications

| Event | Recipients | Type | Title |
|-------|-----------|------|-------|
| Pairing created | Both members | `buddy_assigned` | "You have been assigned a buddy!" |
| Pairing ended | Both members | `buddy_ended` | "Your buddy pairing has ended." |

Both notifications link to `/dashboard` where the member can see their updated buddy status.

---

## API Endpoints

### `POST /api/buddies`

Assigns two members as buddies.

**Requires:** Admin role

**Request body:**
```json
{
  "person_id": "uuid",
  "buddy_id": "uuid",
  "notes": "Optional admin notes"
}
```

**Responses:**
- `200` — Pairing created, both notified
- `400` — One or both members already have an active buddy, or self-assignment
- `403` — Not an admin
- `422` — Validation error

### `DELETE /api/buddies/{id}`

Ends a buddy pairing (sets `ended_at = now()`).

**Requires:** Admin role

**Responses:**
- `200` — Pairing ended, both notified
- `403` — Not an admin
- `404` — Assignment not found

---

## UI Locations Summary

| Location | What's shown |
|----------|-------------|
| `/dashboard` (member view) | "My Buddy" card + "I am buddy to" section |
| `/admin/members/{id}` | Buddy card on profile (admin view) |
| `/admin/members/{id}/edit` | Buddy section: assign or remove buddy (admin only) |
| `/admin/members` list | Buddy column (planned) |
