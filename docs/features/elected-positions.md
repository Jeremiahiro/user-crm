# Elected Positions

## Purpose

The Elected Positions module tracks who holds each of the chapter's formal governance roles at any point in time, and maintains a permanent electoral history. It is distinct from team membership: an elected officer simultaneously belongs to operational teams and holds a system role, but the elected tenure is its own record with its own lifecycle.

The five positions seeded into every installation are:

| Position | Order of Precedence | Linked System Role |
|---|---|---|
| President | 1 | Super Admin |
| VP Admin | 2 | — |
| VP Operations | 3 | — |
| Treasurer | 4 | — |
| Secretary | 5 | — |

Only the President position is linked to a system role. When a tenure is created for the President, the incoming holder is automatically granted the Super Admin role.

---

## Pages

**Positions List — `/admin/positions`**

Displays all active positions as cards, ordered by `order_of_precedence`. Each card shows the position title and either the current holder's name, photo, and term start date, or a "Vacant" badge if no active tenure exists. From this view, administrators can create new position definitions and access the assign and history pages for each position.

**Assign Tenure — `/admin/positions/[id]/assign`**

A form for recording a new tenure assignment. Fields:

| Field | Type | Notes |
|---|---|---|
| Member | Select | Dropdown of active members |
| Term start | Date | Defaults to today; can be backdated |
| Elected by | Select | `chapter_vote`, `board_appointment`, or `co_option` |
| Notes | Text (textarea) | Optional; e.g. reason for co-option |

On submission, the API performs a multi-step operation described in the Business Rules section below.

**Position History — `/admin/positions/[id]/history`**

A read-only table of all tenures ever recorded for this position, ordered chronologically. Columns: Member, Term Start, Term End, Elected By, Notes. The current holder's row is highlighted. No delete action appears here.

**Member Profile — Elected Positions tab**

The profile page for any member shows all positions they have held (current and past) with term dates, regardless of which position view they were accessed from.

---

## Business Rules

**Tenure assignment is atomic.** When a new tenure is assigned via `POST /api/positions/[id]/assign`, the server performs the following steps in sequence:

1. Close the current active tenure for this position by setting its `term_end` to the new tenure's `term_start`. Write a `tenure_end` audit log entry.
2. Insert the new tenure record with `term_end = NULL`. Write a `tenure_create` audit log entry.
3. If the position has a `linked_system_role_id`, insert a `user_roles` record granting that role to the incoming holder. Write a `role_grant` audit log entry.

If step 1 fails (e.g. a database error), the operation is aborted before a new tenure is created. If step 3 fails with anything other than a duplicate-key error (the role was already held), it is logged as a warning but does not roll back the tenure — the tenure is considered successfully created and the role grant can be retried manually.

**One active holder per position.** A partial unique index on `elected_position_tenures(position_id) WHERE term_end IS NULL` enforces at the database level that only one tenure for each position can be active at a time. Attempting to insert a second active tenure for the same position will fail with a constraint violation.

**Tenures are permanent records.** The `elected_position_tenures` table has a restrictive RLS policy that blocks all `DELETE` operations, and there is no delete route in the API. Electoral records must never be removed. If a mistake is made, a corrective tenure can be created.

**Archive blocked by active tenure.** A position definition cannot be archived if an active tenure exists for it. End the tenure first.

**`linked_system_role_id` is set at seed time for President only.** Other positions may be linked to system roles in future, but this is a deliberate configuration step — not automatic. A position without a linked role simply skips step 3 of the assignment sequence.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/positions` | List all active positions with current tenure holder |
| `POST` | `/api/positions` | Create a new elected position definition |
| `POST` | `/api/positions/[id]/assign` | Assign a tenure to a member (atomic operation) |

There is no `DELETE /api/positions/[id]` exposed in the current implementation — archiving a position is handled via the admin UI directly. History is read from `GET /api/members/[id]` on the member profile side, which includes all `elected_position_tenures` for that person.
