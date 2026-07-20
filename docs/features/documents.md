# Documents

Manages file references for members. Documents are not stored directly — they live in Google Drive. The CRM stores metadata plus a tokenised upload link that lets members self-submit files without needing a system account.

## Core concepts

**Upload token** — A `nanoid(24)` unique string stored in `documents.upload_token`. Generates a public URL at `/upload/{token}` that anyone can visit. The page asks for email + Drive link, then attempts to match the email to a member record.

**Upload status lifecycle:**

```
pending  →  uploaded   (admin provided the Drive URL directly)
         →  matched    (member submitted via token, email matched)
         →  unmatched  (member submitted, but email has no match)
```

**Unmatched queue** — Documents with `upload_status = 'unmatched'` appear in a review banner on the documents admin page. Admins can manually link them to the correct member via `/admin/documents/{id}/match`.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents` | List documents (filter: `person_id`, `upload_status`) |
| POST | `/api/documents` | Create document record, returns `upload_url` |
| PUT | `/api/documents/:id` | Update person_id, status, description |
| DELETE | `/api/documents/:id` | Archive (soft delete) |

### POST /api/documents

```json
{
  "person_id": "uuid | null",
  "team_id": "uuid | null",
  "type": "dbs | photo_id | passport | training | agreement | other",
  "description": "optional string",
  "drive_url": "optional URL"
}
```

Response includes `upload_url` if no `drive_url` was provided — share this with the member.

## Admin pages

| Path | Description |
|------|-------------|
| `/admin/documents` | List all documents with status filter, unmatched review queue |
| `/admin/documents/new` | Create document record and optionally generate upload link |
| `/admin/documents/:id/match` | Link an unmatched document to a member |
| `/upload/:token` | Public tokenised upload page (no auth required) |

## Tokenised upload flow

1. Admin creates a document record with type and optional description but no Drive URL.
2. API returns an `upload_url` (`/upload/{token}`).
3. Admin emails the URL to the member.
4. Member visits the page, enters their email and a Google Drive sharing link.
5. Server looks up the email in `people`. Match → `upload_status = 'matched'`. No match → `upload_status = 'unmatched'` and document appears in the admin review queue.

## Document types

| Value | Label |
|-------|-------|
| `dbs` | DBS Certificate |
| `photo_id` | Photo ID |
| `passport` | Passport |
| `training` | Training Certificate |
| `agreement` | Agreement |
| `other` | Other |

## Archiving

Documents use soft delete (`is_archived = true`). Archived documents are excluded from all list queries but remain in the database for audit trail purposes.

## Google Drive integration

See `src/lib/google.ts` for `uploadToDrive()`. When Drive upload is wired into the upload page, files are stored under:

```
100BMOL CRM / Members / {member_name} / {filename}
```

The returned Drive URL is stored in `documents.drive_url`. The current implementation uses self-submitted Drive links (member uploads to their own Drive first). Phase 7 will wire in direct server-side upload.

## Database

```sql
documents (
  id               uuid primary key,
  person_id        uuid references people(id),
  team_id          uuid references teams(id),
  type             text not null,
  description      text,
  drive_url        text,
  upload_token     text unique,
  upload_status    text default 'pending',
  uploaded_email   text,          -- email submitted via token upload
  is_archived      boolean default false,
  created_at       timestamptz,
  updated_at       timestamptz
)
```
