# Onboarding Pipeline

Tracks new members from initial application through to full activation. Combines derived checklist items (computed from existing tables) with stored milestones (things only the admin can mark) into a single per-member view.

---

## Pipeline stages

Members move through four statuses in order:

```
applicant → pending_review → approved → active
```

| Status | Meaning |
|--------|---------|
| `applicant` | Person has submitted interest or been manually added |
| `pending_review` | Admin has begun reviewing — references, DBS, documents being gathered |
| `approved` | All checks passed; waiting for induction / final activation |
| `active` | Full member; onboarding complete |

Status transitions are triggered via `POST /api/onboarding/:id/advance`. Each advance optionally sends a status email via the Gmail API.

---

## Checklist

Each member has a 10-item checklist split into **derived** (auto-computed from other tables) and **manual** (stored in `onboarding_checklists`):

### Derived items (auto-computed)

| Item | Source |
|------|--------|
| Profile complete | `people.phone`, `.address`, `.date_of_birth` all non-null |
| DBS submitted | At least one row in `dbs_records` for this person |
| Photo ID / document uploaded | At least one `documents` row with `upload_status = 'matched'` |
| Team assigned | At least one row in `person_teams` |
| Dues paid (current year) | At least one `dues` row with `paid_at IS NOT NULL` for current year |

### Manual milestones (stored in `onboarding_checklists`)

| Field | Meaning |
|-------|---------|
| `welcome_sent_at` | Welcome email sent to member |
| `dbs_completed_at` | Admin has confirmed the DBS check is fully cleared |
| `reference_checked_at` | Admin has verified references |
| `induction_done_at` | Member attended the chapter induction |
| `agreement_signed_at` | Membership agreement signed and filed |

Manual milestones are toggled with a click on the checklist detail page. Each toggle calls `POST /api/onboarding/:id` and reloads.

---

## Database

### `onboarding_checklists`

```sql
onboarding_checklists (
  id                    uuid primary key,
  person_id             uuid references people(id) unique,  -- one row per member
  welcome_sent_at       timestamptz,
  dbs_completed_at      timestamptz,    -- admin confirms DBS check cleared (added in 006)
  reference_checked_at  timestamptz,
  induction_done_at     timestamptz,
  agreement_signed_at   timestamptz,
  notes                 text,
  completed_at          timestamptz,    -- set when status → active
  created_at            timestamptz,
  updated_at            timestamptz
)
```

### `people.applied_at`

Added by migration `003_onboarding.sql`. Records when a person entered the system (distinct from `date_joined`, which is set on activation).

---

## API routes

### `GET /api/onboarding/:id`

Returns the full onboarding status for a member: stored checklist row + all 5 derived items computed from other tables.

```json
{
  "data": {
    "person": { "id", "full_name", "email", "status", "applied_at", ... },
    "checklist": { "welcome_sent_at", "reference_checked_at", ... },
    "derived": {
      "profile_complete": true,
      "dbs_submitted": false,
      "dues_paid": false,
      "document_uploaded": false,
      "team_assigned": false
    }
  }
}
```

### `POST /api/onboarding/:id`

Toggle a non-derivable milestone. Upserts the `onboarding_checklists` row.

```json
{ "field": "welcome_sent_at", "completed": true, "notes": "Optional text" }
```

Valid fields: `welcome_sent_at`, `reference_checked_at`, `induction_done_at`, `agreement_signed_at`.

### `POST /api/onboarding/:id/advance`

Advance a member to the next status stage.

```json
{ "send_email": true }
```

Transitions:
- `applicant` → `pending_review` (no email)
- `pending_review` → `approved` (sends approval email if `send_email: true`)
- `approved` → `active` (sets `date_joined`, marks `onboarding_checklists.completed_at`, sends activation email if `send_email: true`)

Returns: `{ previousStatus, newStatus, emailSent }`.

---

## Admin pages

### `/admin/onboarding` — Pipeline view

Four-column kanban layout, one column per stage. Each member card shows:
- Name (links to detail page) + days in current stage
- Progress bar (checked / 9 items)
- Warning badges for up to 2 missing items (profile, DBS, welcome email, dues)
- "Details" link + "Advance" button

The "Advance" button triggers a `dry_run`-style confirm dialog then calls the advance API. The page reloads after a successful advance.

**Linked from:** Dashboard "Pending review" stat card, sidebar nav.

### `/admin/onboarding/:id` — Member detail

Shows:
- Member header with current status badge, progress bar, and "Advance" button
- Full 9-item checklist. Derived items show ✓/○ with a "Fix →" link to the relevant admin page. Manual items have a clickable toggle button.
- Notes textarea — saves to `onboarding_checklists.notes`

"Fix →" links:
| Missing item | Link |
|-------------|------|
| Profile | `/admin/members/:id/edit` |
| Welcome email | `/admin/email/compose?person_id=:id` |
| DBS | `/admin/members/:id/dbs/new` |
| Agreement | `/admin/documents/new?person_id=:id` |
| Team | `/admin/members/:id?tab=roles` |
| Dues | `/admin/members/:id?tab=dues` |

---

## Integration points

- **Email:** Advance API calls `memberStatusEmail()` from `src/lib/email-templates.ts` on `approved` and `active` transitions
- **Audit log:** Every advance and milestone toggle writes to `audit_log`
- **Dashboard:** "Pending review" stat card links to the pipeline. The sidebar nav includes "Onboarding"
- **Member profile:** The "✉ Email" button on member profiles pre-fills the compose page, useful for sending the welcome email manually
