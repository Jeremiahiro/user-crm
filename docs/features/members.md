# Members

## Purpose

The Members module is the central spine of the CRM. Every person who interacts with the chapter — member, mentor, volunteer, alumni, parent of a mentee, or trustee — has exactly one record in the `people` table. A person can hold multiple types simultaneously (e.g. a member who is also a mentor), which is why `person_types` is stored as an array rather than a single enum.

---

## Status Lifecycle

A person's `status` field tracks where they are in their relationship with the chapter:

```
applicant → pending_review → approved → active → inactive → alumni
                                                           → left
```

| Status | Meaning |
|---|---|
| `applicant` | Just registered (via Google OAuth or submitted an application form). Stub profile created automatically. |
| `pending_review` | Application under active review by the Membership team. |
| `approved` | Approved to join but not yet fully activated (e.g. awaiting DBS, dues, or training). |
| `active` | Fully active member in good standing. |
| `inactive` | Member who has stepped back but remains on record. |
| `alumni` | Formally concluded their membership in good standing. |
| `left` | Departed the chapter, not in alumni standing. |

Status transitions are manual — an administrator updates the field via the edit form or API. There is no automated state machine, though future email triggers fire on the `active` transition (Phase 7).

---

## Pages

**List — `/admin/members`**

Displays all non-archived people in a table with columns for avatar, name, team assignment, status badge, and dues indicator. The list supports:

- Free-text search by name or email (`q` parameter, case-insensitive `ilike`)
- Filter by status dropdown
- Filter by team

The "Add Member" button opens `/admin/members/new`. Pagination is applied server-side.

**Profile — `/admin/members/[id]`**

The profile page is the primary view for a person record. A header bar shows the member's avatar, full name, and status badge alongside an Edit button. Below the header, the content is divided into tabs:

| Tab | Contents |
|---|---|
| Overview | Core personal details (name, email, phone, DOB, address, source, notes) |
| Dues | Month-by-month payment status for the selected year |
| DBS | DBS certificate records and expiry dates |
| Teams & Roles | Team memberships with lead flag; assigned system roles and permission overrides |
| Elected Positions | All tenures held (current and historical) with term dates and elected-by method |

**Create — `/admin/members/new`**

**Edit — `/admin/members/[id]/edit`**

Both forms share the same field set, described in the Form Fields section below.

---

## Form Fields

| Field | Type | Notes |
|---|---|---|
| Full name | Text | Required |
| Email | Email | Required; must be unique across all people |
| Phone | Text | Optional |
| Date of birth | Date | Optional |
| Gender | Text | Optional; free text |
| Address | Text (textarea) | Optional |
| Person types | Multi-select | `member`, `mentor`, `volunteer`, `alumni`, `parent`, `trustee` |
| Status | Select | Defaults to `applicant` on create |
| Source | Select | `google_form` or `manual`; defaults to `manual` on admin-created records |
| Date joined | Date | Optional |
| Notes | Text (textarea) | Internal admin notes |

Team assignments are managed separately via the Teams & Roles tab on the profile page, not through the create/edit form. Role assignments are also managed from the profile.

---

## Business Rules

**Email uniqueness.** No two people records can share an email address. The API returns a `409 Conflict` with a clear message if a duplicate is detected.

**Archive, not delete.** Members are never hard-deleted. Archiving sets `is_archived = true`. Archived members are excluded from all list views and API responses by default.

**Archive blocked by active tenure.** A member cannot be archived while they hold an active elected position (i.e. a tenure record with `term_end IS NULL`). The API returns a `409` with the message: "Cannot archive: this member holds an active elected position. End their tenure first." The tenure must be explicitly closed before archiving is permitted.

**Stub profile on OAuth login.** When someone signs in with Google for the first time and their email is not found in the `people` table, the authentication callback automatically creates a stub profile with `status: 'applicant'` and `source: 'google_oauth'`. This ensures every authenticated user has a person record.

**All writes are audit-logged.** Every create, update, and archive operation records an entry in `audit_log` with the actor's `person_id`, the action type, and before/after snapshots of the record.

---

## API Endpoints

### People

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/members` | List members. Query params: `q` (name search), `status`, `team_id` |
| `POST` | `/api/members` | Create a new member |
| `GET` | `/api/members/[id]` | Fetch a single member with all related data |
| `PUT` | `/api/members/[id]` | Update member fields |
| `DELETE` | `/api/members/[id]` | Archive a member (sets `is_archived = true`) |

All endpoints require an authenticated session (`locals.user` must be set by middleware). Unauthenticated requests receive `401 Unauthorised`.

The `GET /api/members/[id]` response includes nested data: `person_teams` (with team and pillar names), `user_roles` (with role names), `elected_position_tenures` (with position titles), `dbs_records`, and `dues`.

### Dues Sub-API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/members/[id]/dues` | Record a dues payment for a given year and month |
| `DELETE` | `/api/members/[id]/dues/[dueId]` | Remove a dues record (unmark as paid) |

Dues records have a unique constraint on `(person_id, year, month)`. Attempting to record the same month twice returns a `409`. The `recorded_by` field is always set to the acting user's `person_id`.
