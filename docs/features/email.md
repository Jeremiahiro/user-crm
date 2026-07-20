# Email Integrations

All email is sent via the Gmail API using a Google Workspace service account with domain-wide delegation. Emails appear to come from the chapter's configured sender address and land in that account's sent folder.

See `docs/setup/google-credentials.md` for service account and domain delegation setup.

---

## Architecture

```
src/lib/gmail.ts            — Gmail API client (JWT auth, domain-wide delegation)
src/lib/email-templates.ts  — HTML email templates (all return { subject, html })
src/pages/api/email/        — API routes for sending
src/pages/admin/email/      — Admin UI (Email Centre + Compose)
```

### Gmail client (`src/lib/gmail.ts`)

The client uses `google.auth.JWT` (not `GoogleAuth`) to set the impersonation `subject`, which is required for domain-wide delegation. Without this, Gmail API calls fail with a 403.

```typescript
new google.auth.JWT(
  serviceAccountEmail,
  undefined,
  privateKey,          // PEM string with real newlines
  ['https://www.googleapis.com/auth/gmail.send'],
  senderAddress,       // user to impersonate
)
```

**Private key format:** `GOOGLE_SERVICE_ACCOUNT_KEY` stores the PEM key with literal `\n` sequences. The client replaces `\n` → real newlines at runtime with `key.replace(/\\n/g, '\n')`.

**Key exported functions:**

| Function | Description |
|----------|-------------|
| `sendEmail(options)` | Send to one recipient. Returns `{ success, messageId?, error? }`. Never throws. |
| `sendEmailBulk(recipients)` | Send individually to each recipient (no visible BCC). Uses `Promise.allSettled`. |

Both functions build MIME-formatted messages with `multipart/alternative` encoding (plain text + HTML).

---

## Email templates (`src/lib/email-templates.ts`)

Each template is a pure function returning `{ subject: string, html: string }`.

| Template function | Trigger |
|-------------------|---------|
| `welcomeEmail({ fullName, portalUrl })` | New member created / approved |
| `dbsExpiryWarningEmail({ fullName, expiryDate, daysUntilExpiry, uploadUrl? })` | DBS expiring within warn window |
| `dbsExpiredEmail({ fullName, expiryDate, uploadUrl? })` | DBS expired |
| `duesReminderEmail({ fullName, year, portalUrl })` | Member hasn't paid dues for the year |
| `documentUploadLinkEmail({ fullName, documentType, uploadUrl, expiresInDays? })` | Admin shares a document upload link |
| `memberStatusEmail({ fullName, newStatus, message?, portalUrl })` | Status changed to `approved`/`active`/`inactive` |

All templates share a common layout wrapper with:
- Brand Navy header with "100 Black Men of London / Member Portal"
- Single-column max-width 600px
- Brand Gold for alert borders and links
- Footer with contact email

---

## API routes

### `POST /api/email/send`

Generic single send. Used by the Compose page.

```json
{ "to": "member@example.com", "subject": "...", "html": "...", "personId": "uuid (optional)" }
```

Responses: `200 { success: true, messageId }` | `422` validation | `502` send failure

### `POST /api/email/welcome`

Sends the welcome email template to a member by their `person_id`.

```json
{ "person_id": "uuid" }
```

Looks up the member's name and email from the DB.

### `POST /api/email/dbs-reminders`

Bulk send DBS expiry warnings. Targets all active members whose latest DBS record is `expired` or `expiring_soon` within the warn window.

```json
{ "warn_days": 60, "dry_run": false }
```

Set `dry_run: true` to get the target list without sending.

Response includes `{ sent, failed, total, results[] }`.

### `POST /api/email/dues-reminders`

Bulk send dues reminders. Targets all active members who have no `paid_at` dues record for the given year.

```json
{ "year": 2025, "dry_run": false }
```

---

## Admin pages

### `/admin/email` — Email Centre

Dashboard showing three action cards:

- **Dues reminders** — count of active members without dues paid this year. Send button triggers `POST /api/email/dues-reminders` with a dry-run confirmation step (shows recipient count before sending).
- **DBS expiring soon** — count of active members with DBS expiring within 60 days.
- **DBS expired** — count with expired DBS. Send button uses `warn_days: 0` to target only expired.

Both DBS buttons call `POST /api/email/dbs-reminders` with different `warn_days` values.

All bulk sends do a `dry_run` first to show a `confirm()` dialog with the recipient count, then send on confirmation.

### `/admin/email/compose` — Compose

Custom email form. Supports:
- **Recipient type:** member dropdown (active members) or custom email address
- **Subject** and **Message** (plain text, auto-converted to paragraph HTML)
- **Preview** pane — renders the HTML in an `<iframe>` before sending
- `?person_id=` query param pre-selects a member (used by member profile "✉ Email" button)

The compose page appears on every member profile header as the "✉ Email" button.

---

## Audit logging

Every email send writes to `audit_log`:

```
actor_id: <acting admin's person_id>
action: 'create'
target_table: 'email_send' | 'email_bulk'
target_id: <person_id or reminder type>
after_value: { to, subject, messageId, type, sent, failed, ... }
```

Audit entries for bulk sends include aggregate counts (`sent`, `failed`, `total`).

---

## Environment variables

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=portal-server@your-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n
GMAIL_SENDER_ADDRESS=portal@100blackmenoflon.org
```
