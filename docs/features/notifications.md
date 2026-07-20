# Notifications

This document specifies how the portal surfaces system alerts to administrators. Notifications are in-app only — no emails are sent for system events unless explicitly stated.

---

## Design Principles

**In-app, not email.** Operational alerts (DBS expiry, compliance gaps, etc.) are shown inside the portal to logged-in admins. This keeps the admin in control of remediation without generating email noise for members.

**Admin is the actor.** For events like DBS renewal, it is the admin who acts — not the member. Therefore alerts go to admin dashboards, not member inboxes.

**Non-blocking.** Notification banners are informational, not modal. Admins can dismiss or ignore them and continue working.

---

## Notification Types

### 1. DBS Expiry Alert

| Property | Value |
|---|---|
| Who sees it | Admins and Super Admins |
| Where | Admin dashboard header banner + DBS Status board (`/admin/dbs`) |
| Trigger | Member DBS expiry date is within 90 days, or already expired |
| Email sent? | **No** — in-app only |
| Who renews | **Admin** (not the member) — admin initiates and records DBS renewal via the DBS Records module |

**Why admin-only:** DBS checks are arranged and paid for by the organisation. The admin controls the renewal process, so the alert must reach them directly.

**Priority thresholds:**

| Days to expiry | Severity | Badge colour |
|---|---|---|
| > 90 days | OK | Green |
| 31–90 days | Warning | Amber |
| 0–30 days | Urgent | Red |
| Expired | Critical | Red (bold) |

---

### 2. Dues Reminder (Planned)

| Property | Value |
|---|---|
| Who sees it | Admin dashboard |
| Where | Dashboard summary card |
| Trigger | End of financial year approaching with unpaid dues |
| Email sent? | TBD — may require member notification via Gmail API in a later phase |

---

### 3. Application Pending Review (Planned)

| Property | Value |
|---|---|
| Who sees it | Admins |
| Trigger | New intake form submission sets a person's status to `applicant` |
| Where | Dashboard notification badge on "Applications" nav item |
| Email sent? | No |

---

## Implementation Plan

Notifications are not yet implemented as a dedicated system. The current approach uses DB queries at page-load time:

- The DBS Status board (`/admin/dbs`) already queries all people with expiring/expired DBS records on page load.
- The admin dashboard will surface a count of pending-review applicants via a query on the `people` table.

**Future work — Notification centre:**

When a proper notification system is built, it should:

1. Write notification records to a `notifications` table on relevant events (DBS expiry detected, new applicant, etc.)
2. Expose a bell icon in the nav bar showing unread count
3. Allow admins to mark notifications as read/dismissed
4. Support notification preferences per admin (which types they want to see)

A `notifications` table schema (for future reference):

```sql
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references people(id),  -- admin who should see it
  type        text not null,  -- 'dbs_expiry', 'new_applicant', 'dues_overdue', etc.
  title       text not null,
  body        text,
  link_url    text,           -- deep link into the relevant page
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
```

This table is not yet created. Implement it when building Phase 6+ dashboard enhancements.

---

## What Is NOT a Notification

- **DBS expiry email to the member** — members do not arrange their own DBS. Admin handles it.
- **Email blast for dues** — member email communication is handled via the Gmail API module (Phase 7), not the notification system.
- **Audit log entries** — these are records, not alerts. See `docs/features/audit-log.md`.
