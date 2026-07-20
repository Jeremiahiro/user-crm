# Pillars

## Purpose

Pillars represent the five strategic areas through which 100 Black Men of London delivers its mission. Every team and programme belongs to one of these pillars, giving the chapter a clear structure for reporting, accountability, and communication.

The five pillars seeded into every installation are:

1. **Education** — Academic support, scholarships, and youth development
2. **Mentoring (CMP)** — The Community Mentoring Programme, pairing members with young mentees
3. **Health & Wellness** — Physical and mental wellbeing programming
4. **Economic Empowerment** — Financial literacy, entrepreneurship, and career development
5. **Leadership** — Chapter governance and board development

Pillars are reference data — they change rarely, if ever. The module exists primarily to allow administrators to update descriptions, reorder the display, and (in future) associate programmes and events at the pillar level.

---

## Pages

**List — `/admin/pillars`**

Displays all active pillars ordered by `display_order`. Each row shows the pillar name, a short description, and the number of teams associated with it. An "Add Pillar" button opens the create form (Super Admin only).

**Create — `/admin/pillars/new`**

**Edit — `/admin/pillars/[id]/edit`**

Both forms use the same fields:

| Field | Type | Notes |
|---|---|---|
| Name | Text | Required |
| Description | Text (textarea) | Optional; displayed in the list and on team detail pages |
| Display order | Number | Optional; controls the order in which pillars appear throughout the UI |

There is no separate detail page for a pillar — the list view provides sufficient context, and team and member filtering by pillar is handled within the Members and Teams modules.

---

## Business Rules

**Archive blocked while teams are assigned.** A pillar cannot be archived if any active teams reference it via `teams.pillar_id`. Reassign or archive all associated teams first. This prevents teams from being orphaned under a non-existent pillar.

**`is_active` is the archive mechanism.** Like teams, pillars use `is_active` rather than `is_archived`. Setting `is_active = false` removes the pillar from all active views and prevents new teams from being assigned to it.

**Display order is advisory.** The `display_order` integer is used for list sorting throughout the UI, but there is no uniqueness constraint on it. If two pillars share a display order, they are sorted alphabetically as a tiebreaker.

**The five default pillars are data, not code.** Nothing in the application hard-codes pillar names or IDs. The seeded pillars can be renamed or have their descriptions updated. Archiving a default pillar is permitted (subject to the team assignment check) — though in practice the five pillars reflect the 100BMOL national structure and are unlikely to change.

**All writes are audit-logged.** Create, update, and archive operations write entries to `audit_log`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pillars` | List all active pillars ordered by `display_order` |
| `POST` | `/api/pillars` | Create a new pillar |
| `GET` | `/api/pillars/[id]` | Fetch a single pillar |
| `PUT` | `/api/pillars/[id]` | Update pillar fields |
| `DELETE` | `/api/pillars/[id]` | Archive a pillar (sets `is_active = false`) |

All endpoints require an authenticated session. The `GET /api/pillars` response includes a team count per pillar computed from the `teams` table.
