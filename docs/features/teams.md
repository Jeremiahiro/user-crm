# Teams

## Purpose

Teams are the functional units through which members organise their work within the chapter. Each team can optionally belong to a pillar, which groups teams under one of the chapter's five strategic areas. A member can belong to multiple teams, and can be designated as a team lead for any of those teams.

The `teams` table is intentionally simple — it holds the team's name, description, optional pillar association, and an `is_active` flag. The relational complexity lives in `person_teams`, which is the join table recording which people belong to which teams and in what capacity.

---

## Pages

**List — `/admin/teams`**

Displays all active teams in a table with columns for team name, associated pillar, member count, and current team lead(s). An "Add Team" button opens the create form.

**Detail — `/admin/teams/[id]`**

Shows the team's full information alongside a member roster. The roster lists each person's name, status, and whether they are a team lead for this team. From the detail page, administrators can access edit and archive actions.

**Create — `/admin/teams/new`**

**Edit — `/admin/teams/[id]/edit`**

Both forms share the same fields:

| Field | Type | Notes |
|---|---|---|
| Name | Text | Required |
| Description | Text (textarea) | Optional |
| Pillar | Select | Optional; links to one of the five chapter pillars |

Team lead assignment and member assignment are managed through the member's profile (Teams & Roles tab), not from the team form. This keeps the team record itself lean and avoids duplication.

---

## Business Rules

**Pillar is optional.** The eight seeded default teams include both pillar-aligned teams (e.g. Education Committee under the Education pillar) and cross-cutting teams (e.g. Communications, Events & Fundraising) that operate independently of the five strategic pillars.

**A member can lead multiple teams.** The `is_team_lead` flag lives on the `person_teams` join record, not on the team itself. There is no limit on the number of leads per team.

**Archive blocked while members are assigned.** A team cannot be archived if any people are currently assigned to it via `person_teams`. All members must be reassigned or removed before archiving is permitted. This prevents orphaned team memberships from hiding in archived teams.

**`is_active` is the archive mechanism.** Teams do not have an `is_archived` column — they use `is_active` (a boolean, defaulting to `true`). Setting `is_active = false` removes the team from all active list views and prevents new assignments.

**All writes are audit-logged.** Create, update, and archive operations write entries to `audit_log`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams` | List all active teams |
| `POST` | `/api/teams` | Create a new team |
| `GET` | `/api/teams/[id]` | Fetch a single team with its member roster |
| `PUT` | `/api/teams/[id]` | Update team fields |
| `DELETE` | `/api/teams/[id]` | Archive a team (sets `is_active = false`) |

All endpoints require an authenticated session. The `GET /api/teams` response includes each team's pillar name and an aggregated member count. The `GET /api/teams/[id]` response includes the full list of `person_teams` records with person details.
