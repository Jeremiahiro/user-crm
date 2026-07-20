# Certifications & Trainings — Design & Implementation Plan

**Project:** 100 Black Men of London — Chapter CRM  
**Status:** Planned  
**Author:** Engineering  

---

## Overview

The Certifications & Trainings section has two connected parts:

**Documents** — a single upload entry point where members upload any file and select its type (Certificate, DBS, Reference, ID, Other, …). The type list is admin-managed and expandable. All files go to Google Drive. Admins and team leads are notified and can approve, reject, or rename uploads. This replaces the separate certifications flow and will eventually supersede the legacy `dbs_records` table.

**Trainings** — admins and team leads create and assign training courses. A training can optionally require a document upload as proof of completion. Members without a cert requirement use a "Mark as completed" button instead.

---

## Key Concepts

| Term | Meaning |
|---|---|
| **Document type** | A category label for an uploaded file (Certificate, DBS, Reference, etc.). Admin-managed, expandable. |
| **Document** | An uploaded file attached to a member's profile with a type, title, and optional metadata. |
| **Training** | A course or task, optionally linked to an external URL. Created by admin or team lead. |
| **Assignment** | A training pushed to specific members, teams, or everyone — with an optional deadline. |
| **Completion** | A record that a person finished a training, either via a linked document upload or self-report. |

---

## Database Schema

### `document_types`
Admin-managed list of document categories. Pre-seeded at launch; new types can be added at any time.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | Display name: "Certificate", "DBS", "Reference", "ID Document", "Other" |
| `slug` | text UNIQUE | URL-safe key: `certificate`, `dbs`, `reference`, `id_document`, `other` |
| `description` | text | Optional helper text shown in the upload form |
| `requires_expiry` | boolean | If true, the upload form shows the expiry date field |
| `requires_issuer` | boolean | If true, shows "Issuing body" field |
| `is_training_linkable` | boolean | If true, the upload form shows a "Training" selector when this type is chosen |
| `sort_order` | integer | Controls display order in the type dropdown |
| `is_active` | boolean | Inactive types are hidden from the upload form (existing docs unaffected) |
| `created_by` | uuid FK → people | |
| `created_at` | timestamptz | |

> Pre-seeded types and their flags:
>
> | Type | requires_expiry | requires_issuer | is_training_linkable |
> |---|---|---|---|
> | Certificate | ✅ | ✅ | ✅ |
> | DBS | ✅ | ✅ | ❌ |
> | Reference | ❌ | ✅ | ❌ |
> | ID Document | ✅ | ✅ | ❌ |
> | Other | ❌ | ❌ | ❌ |
>
> Admins can add new types and configure these flags — e.g., a "Professional Qualification" type could be created with `is_training_linkable = true`.

---

### `documents`
Unified table for all member document uploads.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `person_id` | uuid FK → people | Owner — always set server-side, never trusted from request body |
| `document_type_id` | uuid FK → document_types | Selected by the uploader |
| `title` | text | Required. Editable by admin/team lead after upload |
| `issued_by` | text | Issuing body (shown when `requires_issuer = true` on the type) |
| `issued_date` | date | Optional |
| `expiry_date` | date | Optional (shown when `requires_expiry = true` on the type) |
| `training_id` | uuid FK → trainings | Populated when uploaded as proof of a specific training |
| `file_url` | text | Google Drive view URL |
| `drive_file_id` | text | Drive file ID for API operations |
| `status` | enum: `pending`, `approved`, `rejected`, `expired` | Default: `pending` |
| `reviewed_by` | uuid FK → people | Admin or team lead |
| `reviewed_at` | timestamptz | |
| `review_notes` | text | Shown to member on rejection |
| `uploaded_at` | timestamptz | |

> **DBS migration note:** The existing `dbs_records` table is kept intact for now. At launch, new DBS uploads go through this unified flow with type `dbs`. A one-off migration will backfill legacy `dbs_records` rows into `documents` after the feature ships.

---

### `trainings`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | Required |
| `description` | text | No length cap — markdown supported (see Description Handling section) |
| `external_url` | text | Link to external course (optional) |
| `requires_document` | boolean | If true, completion requires a document upload |
| `expected_document_type_id` | uuid FK → document_types | Hint shown to member on upload ("Please upload a Certificate") — not enforced, just guidance |
| `is_active` | boolean | Soft delete |
| `created_by` | uuid FK → people | |
| `created_at` | timestamptz | |

---

### `training_assignments`
Links a training to its audience. Multiple rows per training (e.g., assigned to two teams separately).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `training_id` | uuid FK → trainings | |
| `scope` | enum: `all`, `team`, `person` | |
| `team_id` | uuid FK → teams | When scope = team |
| `person_id` | uuid FK → people | When scope = person (in-system) |
| `email` | text | When scope = person, out-of-system user |
| `deadline` | date | Optional |
| `reminder_7d_sent_at` | timestamptz | Idempotency guard for 7-day reminder |
| `reminder_1d_sent_at` | timestamptz | Idempotency guard for 1-day reminder |
| `assigned_by` | uuid FK → people | |
| `assigned_at` | timestamptz | |

---

### `training_completions`
One row per person per training.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `training_id` | uuid FK → trainings | |
| `person_id` | uuid FK → people | |
| `completed_at` | timestamptz | |
| `method` | enum: `self_reported`, `document` | |
| `document_id` | uuid FK → documents | Populated when method = document |
| `notes` | text | Admin notes |

Constraint: `UNIQUE(training_id, person_id)`

---

## The Upload Flow (Single Entry Point)

There is one upload page and one upload modal used everywhere in the app. The same component is reused whether a member is uploading from their profile, from a training detail page, or from the admin member view.

```
/admin/documents/upload
```

Or triggered as a modal from any surface (training completion, member profile Documents tab, etc.).

**Step 1 — Select document type**
A dropdown populated from active `document_types` rows, ordered by `sort_order`. This is the first and most prominent field.

**Step 2 — Conditional fields appear** based on the selected type's configuration:

| Field | Shown when | Required? |
|---|---|---|
| Title | Always | Yes |
| Issuing body | `requires_issuer = true` on the type | No |
| Issue date | Always | No |
| Expiry date | `requires_expiry = true` on the type | No |
| **Training** | `is_training_linkable = true` on the type | No — see note below |
| File picker | Always | Yes |

**Training field behaviour:**
- Shown as a searchable dropdown of the member's assigned, incomplete trainings
- If the upload is triggered from a training detail page (e.g. "Upload Proof" button), this field is pre-filled with that training and locked — the member cannot change it
- If uploading from the member's profile or the admin member view, the field is optional — a member may upload an external certificate not tied to any chapter training
- `training_id` is stored on the document regardless of how it was set — this is the sole link the system uses to know where to map the document

**What the system does with `training_id`:**
- When `training_id` is null → document is a freeform record on the member's profile; no completion logic is triggered
- When `training_id` is set and document status changes to `approved` → system automatically creates a `training_completions` row (method: `document`) and marks the training complete for that member
- When `training_id` is set and document is `rejected` → no completion record is created; if a completion already existed from a previous upload it is removed; member is notified with the review note and can re-upload

**Step 3 — Upload**
File streams to Drive server-side. DB row written only after Drive confirms success. On failure, 500 is returned and no DB record is created.

**Post-upload state**
Document appears in the member's Documents tab as `pending`. Admin and team leads are notified.

---

## Managing Document Types (Admin)

```
/admin/settings → "Document Types" card
```

Admins can:
- Add a new type (name, slug auto-generated, toggle `requires_expiry` / `requires_issuer`, set sort order)
- Edit an existing type's name, description, and field toggles
- Reorder types (drag or up/down arrows) — controls dropdown order for uploaders
- Deactivate a type — hides it from the upload dropdown; existing documents of that type are unaffected

A type cannot be deleted if any documents reference it — only deactivated.

---

## Role & Permission Matrix

| Action | Super Admin | Admin | Chapter Leadership | Team Lead | Member |
|---|---|---|---|---|---|
| Manage document types | ✅ | ✅ | ❌ | ❌ | ❌ |
| Upload document (own profile) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload document on behalf of a member | ✅ | ✅ | ✅ | ✅ (own team) | ❌ |
| View own documents | ✅ | ✅ | ✅ | ✅ | ✅ |
| View team member documents | ✅ | ✅ | ✅ | ✅ (own team) | ❌ |
| View all documents | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve / reject document | ✅ | ✅ | ✅ | ✅ (own team member docs) | ❌ |
| Edit document title | ✅ | ✅ | ✅ | ✅ (own team member docs) | ❌ |
| Delete document | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create training | ✅ | ✅ | ✅ | ✅ (own team only) | ❌ |
| Assign training to all members | ✅ | ✅ | ✅ | ❌ | ❌ |
| Assign training to a team | ✅ | ✅ | ✅ | ✅ (own team) | ❌ |
| Assign training to a specific person | ✅ | ✅ | ✅ | ✅ (own team members) | ❌ |
| Mark own training complete (self-report) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Pages & Routes

### Member-facing
```
/admin/documents              — All my documents (filterable by type, status)
/admin/documents/upload       — Upload a document (the single entry point)
/admin/trainings              — My assigned trainings
/admin/trainings/[id]         — Training detail + complete / upload proof
```

### Admin / Team Lead
```
/admin/settings               — Document Types card (add, edit, reorder)
/admin/trainings/new          — Create training
/admin/trainings/[id]/edit    — Edit training + manage assignments
/admin/trainings/[id]/completions — Completion report
/admin/members/[id]           — Member profile → Documents tab (all docs, all types)
```

### API
```
GET    /api/document-types                        — List active types
POST   /api/document-types                        — Create type (admin only)
PUT    /api/document-types/[id]                   — Update type (admin only)
DELETE /api/document-types/[id]                   — Deactivate type (admin only)

POST   /api/documents                             — Upload (multipart → Drive → DB)
GET    /api/documents                             — List (own docs, or admin: by person_id)
PUT    /api/documents/[id]                        — Update title / status (admin/lead review)
DELETE /api/documents/[id]                        — Admin only

GET    /api/trainings                             — List (scoped by role)
POST   /api/trainings                             — Create
PUT    /api/trainings/[id]                        — Update
DELETE /api/trainings/[id]                        — Archive
POST   /api/trainings/[id]/assignments            — Assign
DELETE /api/trainings/[id]/assignments/[aId]      — Remove assignment
GET    /api/trainings/[id]/completions            — Completion report (admin/lead)
POST   /api/trainings/[id]/complete               — Self-report or link an existing document
```

---

## Description Handling

Training descriptions can be arbitrarily long (multi-paragraph course overviews, syllabus, instructions).

**Authoring (create/edit form):** Full-height `<textarea>` with no character limit — grows vertically with content. Markdown accepted; a live preview panel renders alongside. Soft cap of 100,000 characters enforced in Zod.

**List views:** Description clamped to 2 lines with CSS `line-clamp`. Click through to detail page for full content.

**Detail view:** Full markdown render. "Show more / Show less" toggle when content exceeds ~600px so the page stays navigable.

---

## Google Drive Integration

Files are stored under the service account, organised as:

```
/CRM-Documents/
  /<person_full_name>_<person_id>/
    /<document_type>_<title>_<timestamp>.<ext>
```

- Files are **view-only, link-sharing off** — only the service account owns them
- Admins and approved reviewers get short-lived signed URLs generated server-side
- On deletion: file moved to Drive trash (recoverable for 30 days), not hard-deleted
- If Drive upload fails, no DB row is written

---

## Notifications

| Event | Who gets notified |
|---|---|
| Document uploaded by member | Admin + team leads of that member's teams |
| Document approved | Uploading member |
| Document rejected (with review note) | Uploading member |
| Training assigned | Every person in assignment scope |
| Assignment deadline in 7 days, unfinished | Assigned person |
| Assignment overdue (1 day after deadline) | Admin + assigning team lead |
| Document expiring in 30 days | Document owner |
| Document expiring in 7 days | Document owner |

---

## Training Completion Flow

```
Training assigned → appears in "My Trainings"
  │
  ├─ requires_document = true
  │     → Member clicks "Complete Training" (opens external URL if set)
  │     → "Upload Proof" button → upload modal opens
  │           · document type pre-set to expected_document_type (e.g. Certificate)
  │           · training_id pre-filled + locked to this training
  │           · member fills title, issuer, expiry, attaches file → submits
  │     → Document saved with status: pending, training_id: <this training>
  │     → Admin/lead notified → reviews document
  │           · Approved → system auto-creates training_completions row → training ✅
  │           · Rejected → completion not created; member notified with review note
  │                        → member can re-upload (new document, same training_id)
  │
  └─ requires_document = false
        → Member clicks "Complete Training" (opens external URL if set)
        → "Mark as Completed" → self-report → training_completions row created → training ✅
              (no document, no approval step)
```

**How the system knows what to do with a document:**
`document.training_id` is the only signal. It is set in one of two ways:
1. Automatically — when the upload is triggered from a training detail page ("Upload Proof" button locks `training_id` to that training)
2. Manually — when a member or admin uploads from the profile and selects a training from the optional dropdown

The system never infers the mapping from the document title or type — `training_id` must be explicitly set. This prevents ambiguity when a member holds the same certificate for multiple trainings.

---

## Expiry Tracking

`expiry_date` is optional on every document. When present:
- A scheduled daily job checks for expiring documents
- In-app notifications sent at 30 days and 7 days before expiry
- Document status set to `expired` on the expiry date
- If the expired document was the proof of a required training, the completion is flagged "cert expired" — the completion record is not deleted but is visually marked

---

## Out-of-System Users

When a training is assigned to an email with no CRM account:
1. `training_assignments` stores the email; `person_id = null`
2. An email is sent with the training details and a tokenised link (`/t/<signed-jwt>`)
3. On that page: self-report if no document required; otherwise, instructions to send the file to an admin
4. When the email is later matched to a CRM account, `person_id` is backfilled and any completion is linked to their profile

---

## Completion Reporting (Admin View)

`/admin/trainings/[id]/completions`:

| Name | Team | Status | Method | Document | Deadline | Overdue |
|---|---|---|---|---|---|---|
| Jane Smith | Technology | ✅ Complete | Document | [View] | 2026-08-01 | — |
| John Doe | Technology | ⏳ Pending | — | — | 2026-08-01 | — |
| Alice Brown | Education | ❌ Overdue | — | — | 2026-07-01 | 16 days |

Filters: team, status. Export to CSV.

---

## Loophole Analysis

**Access control:**
- `person_id` on uploads is always set server-side from `locals.user` — never trusted from request body
- Team lead document approval must verify the uploader is on one of their teams
- Team lead assigning a training to a specific person must verify that person is on their team
- `POST /api/trainings/[id]/complete` (self-report) checks `requires_document = false` server-side — cannot be self-reported if document is required

**Data integrity:**
- Training cannot be archived with active assignments that have future deadlines — surface a blocking warning
- Rejecting a document unwinds the linked training completion if one exists (training reverts to "in progress")
- Approving a second document for the same training (e.g. member re-uploads after rejection) must not create a duplicate completion row — upsert on `UNIQUE(training_id, person_id)`, updating `document_id` and `completed_at`
- A document's `training_id` cannot be changed after upload — if the wrong training was selected, admin must reject it and the member re-uploads
- Deactivating a document type does not affect existing documents of that type
- A document type cannot be deleted (only deactivated) if any documents reference it — enforce via FK constraint
- Duplicate completion guard: `UNIQUE(training_id, person_id)` on `training_completions`

**Google Drive:**
- MIME type validated server-side from buffer (not filename or client-reported content-type)
- 10MB hard cap enforced before streaming to Drive
- Drive file ID stored at write time — title edits never affect the stored file reference
- Drive upload failure → no DB write; return 500

**Notifications:**
- Large assignment fan-outs (e.g., all members) are queued, not run synchronously in the request
- Deadline reminders are idempotent via `reminder_7d_sent_at` / `reminder_1d_sent_at` columns

---

## Rollout Phases

**Phase 1 — Document types + unified upload**
- `document_types` table + admin settings UI to manage the list
- `documents` table + single upload page/modal
- Member Documents tab on profile
- Admin review (approve/reject/edit title) + notifications

**Phase 2 — Trainings + assignments**
- `trainings` + `training_assignments` + `training_completions` tables
- Create/edit/assign training (all/team/person scope)
- My Trainings list for members
- Self-report completion + document-upload completion flow
- Completion report page

**Phase 3 — Expiry + reminders**
- Expiry date tracking, daily scheduled check
- 30-day and 7-day expiry notifications
- Expired document flagging on profiles and completion records

**Phase 4 — Reporting + out-of-system + DBS migration**
- CSV export on completion report
- Out-of-system tokenised training flow
- Email reconciliation on account creation
- Backfill `dbs_records` into `documents` (type: DBS); deprecate legacy table

---

## Open Questions / Decisions Deferred

- Should team leads see the full file (open the PDF) or only metadata (title, type, status, expiry)? Documents can be sensitive — worth a policy call before Phase 1 ships.
- Is self-reported completion on non-document trainings trustworthy enough, or should there be a lightweight admin approval step?
- For out-of-system users: should they be able to upload directly via the tokenised page, or must an admin upload on their behalf?
