# Roles & Permissions

## Purpose

The Roles module defines what system roles exist and precisely what each role is permitted to do across every module in the portal. Roles are pure data — there are no hard-coded role names in application logic. The six default roles seeded at installation are sufficient to get the chapter operational, but administrators can create custom roles (e.g. CMP Lead, Finance Lead, Membership Secretary) with any combination of permissions.

Roles are assigned to members through `user_roles`. The session callback reads these assignments when a user logs in and embeds the role names in their session token, making them available to middleware and page-level permission checks.

---

## Permission Model

Each role has a set of permissions stored in `role_permissions`. A permission is the combination of a **module**, an **operation**, and a **scope**.

**Modules** — the 21 functional areas that can be independently permissioned:

`members`, `volunteers`, `teams`, `pillars`, `elected_positions`, `elected_tenures`, `dues`, `dbs_records`, `documents`, `mentees`, `cmp_years`, `cmp_sessions`, `cmp_attendance`, `awards`, `praise`, `participation_events`, `roles`, `permissions`, `user_role_assignment`, `onboarding_pipeline`, `audit_log`

**Operations** — `create`, `read`, `update`, `delete`

**Scope** — controls how broadly the permission applies:
- `all` — the role holder can act on any record in the module
- `own_team` — restricted to records belonging to their team(s)
- `own_record` — restricted to their own person record

The effective permission for any user is resolved as: Explicit Deny overrides → Explicit Allow overrides → Role Permission → Default Deny. Per-user overrides are stored in `user_permission_overrides` and are configured from the member profile's Teams & Roles tab.

---

## Default System Roles

Six roles are seeded at installation and marked `is_system_protected = true`:

| Role | Purpose |
|---|---|
| Super Admin | Full access to all modules. Auto-granted to the chapter President. |
| Chapter Leadership | All modules readable; most modules editable. For senior officers. |
| Team Lead | Manage their team's members and team-level data. Scope: `own_team`. |
| Member | Standard active member — read-only on their own profile. |
| Volunteer | External volunteer — limited read access; no access to the dues module. |
| Applicant | Pending applicant — very restricted access. Assigned automatically at registration. |

---

## Pages

**List — `/admin/roles`**

Displays all non-archived roles in a table with columns for name, description, member count (how many people currently hold this role), system-protected status, and action buttons. System-protected roles show a lock icon instead of archive/delete controls.

**Create — `/admin/roles/new`**

A form for entering the role name and description, followed by a permission grid. The grid presents each module as a row and each operation (create, read, update, delete) as a column. Each cell is a checkbox. Scope is configurable per permission.

**Edit — `/admin/roles/[id]/edit`**

The same form as Create, pre-populated with existing values. Updating the permissions field replaces all existing `role_permissions` records for that role (a full replace, not a merge).

---

## Business Rules

**System-protected roles cannot be archived or deleted.** If `is_system_protected` is `true`, the `DELETE` endpoint returns `409 Conflict`. These six roles underpin the session and permission model and must always exist.

**Archive vs delete depends on assignment history.** When `DELETE /api/roles/[id]` is called:
- If the role has *ever* been assigned to any user (i.e. any `user_roles` record references this `role_id`, even historical ones): the role is **archived** (`is_archived = true`). It disappears from the active role list and cannot receive new assignments, but all audit log entries that reference it remain valid.
- If the role has *never* been assigned to any user: the role is **hard-deleted**. This is safe because no audit or history references it.

The API response includes an `action` field (`"archived"` or `"deleted"`) so the client can display the correct confirmation message.

**Role names are immutable once assigned.** The name can still be updated via `PUT /api/roles/[id]`, but a name change on a widely-used role affects all historical audit log entries that store the name as a string. Treat role names as stable identifiers — use the description field for display-friendly changes.

**Permission replace, not merge.** When editing a role's permissions, pass the complete desired permission set in the `permissions` array. The server deletes all existing `role_permissions` for that role and inserts the new set. Sending an empty array removes all permissions.

**All writes are audit-logged.** Create, update, archive, and delete operations write entries to `audit_log`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/roles` | List all non-archived roles with permissions and member counts. Also returns the `modules` list. |
| `POST` | `/api/roles` | Create a role with optional initial permissions |
| `PUT` | `/api/roles/[id]` | Update role name, description, and/or replace permissions |
| `DELETE` | `/api/roles/[id]` | Archive or delete the role depending on assignment history |

All endpoints require an authenticated session.

The `GET /api/roles` response body is `{ data: Role[], modules: string[] }`. The `modules` array is included so the permission grid UI can be built dynamically from the server response rather than a hard-coded list.
