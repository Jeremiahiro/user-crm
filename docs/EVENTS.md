# Events Feature — Design & Implementation Plan

**Project:** 100 Black Men of London — Chapter CRM  
**Status:** Planned  
**Author:** Engineering  

---

## Overview

The Events feature lets team leads and admins schedule, manage, and publish events for their teams and the chapter. A shared calendar surfaces all events relevant to the viewer. Recurring events (e.g. weekly meetings) are supported. Admins and team leads configure per-event notifications; in-app is always on. Members can export events to their personal calendar or subscribe to a live feed, and — for org-email users — events can be pushed directly to their Google Calendar.

---

## Decisions (Resolved)

| Question | Decision |
|----------|----------|
| Who can create chapter-wide events? | Admins **and** team leads |
| RSVP mandatory? | No — always optional |
| Past/cancelled events retained? | Yes — archive view |
| Event visibility | Configurable per event (see below) |
| Reminders | In-app + email + iCal export + Google Calendar push |

---

## Event Visibility Model

Every event has a `visibility` field that controls who can see it.

| Value | Visible to |
|-------|-----------|
| `chapter` | All active members, team leads, admins |
| `team` | Members of that specific team, team leads, admins |
| `leads` | Team leads (any team) and admins only — internal coordination |

**Rules:**
- Chapter-wide events (`team_id IS NULL`) default to `chapter` visibility.
- Team events default to `team` visibility but can be promoted to `chapter` (e.g. a team hosting a chapter event).
- `leads` visibility is for things like lead meetings that members don't need to see.

**Calendar view filtering by viewer:**
- Admin: sees everything.
- Team lead: sees `chapter`, `leads`, and `team` events for their teams.
- Member: sees `chapter` events + `team` events for their own teams only. Never sees `leads` events.

---

## Goals

- Team leads and admins can create, edit, and delete events.
- A global calendar shows all events the viewer is permitted to see.
- Conflict detection: overlapping events for the same audience are flagged.
- Recurring events (meetings, etc.) with per-occurrence edit and cancel.
- Configurable notifications: in-app always; email opt-in per event.
- Three ways for users to get events into their personal calendar:
  1. Download a one-off `.ics` file for any event.
  2. Subscribe to a personal iCal feed URL (auto-updates in any calendar app).
  3. Push directly to their Google Calendar (org email only, via Google Calendar API).

---

## Database Schema

### `events` table

```sql
create table events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  location        text,                          -- free text or URL for virtual

  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  all_day         boolean not null default false,

  -- Scope
  team_id         uuid references teams(id) on delete set null,  -- null = chapter-wide
  pillar_id       uuid references pillars(id) on delete set null,

  -- Visibility
  visibility      text not null default 'chapter'
    check (visibility in ('chapter', 'team', 'leads')),

  -- Recurrence (RFC 5545 RRULE subset)
  is_recurring    boolean not null default false,
  recurrence_rule text,                          -- e.g. 'FREQ=WEEKLY;BYDAY=MO'
  recurrence_ends_at timestamptz,               -- null = no end date

  -- Notification config
  notify_email          boolean not null default false,
  notify_days_before    int     not null default 1,
  notify_google_cal     boolean not null default false, -- push to Google Calendar?

  -- Meta
  created_by      uuid not null references people(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_cancelled    boolean not null default false
);

create index events_starts_at_idx  on events(starts_at);
create index events_team_id_idx    on events(team_id);
create index events_visibility_idx on events(visibility);
```

### `event_occurrences` table

Materialised instances of recurring events (generated up to 2 years ahead).

```sql
create table event_occurrences (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  occurrence_date date not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  is_cancelled    boolean not null default false,

  unique(event_id, occurrence_date)
);

create index event_occurrences_starts_at_idx on event_occurrences(starts_at);
```

### `event_attendees` table

Optional RSVP tracking. RSVP is never mandatory.

```sql
create table event_attendees (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  person_id   uuid not null references people(id) on delete cascade,
  status      text not null default 'invited'
    check (status in ('invited', 'confirmed', 'declined')),
  added_at    timestamptz not null default now(),

  unique(event_id, person_id)
);
```

### `calendar_tokens` table

Personal iCal feed tokens. Each person gets one stable token so they can subscribe from any calendar app without re-authenticating.

```sql
create table calendar_tokens (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade unique,
  token       text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at  timestamptz not null default now()
);
```

---

## RBAC

| Action | Admin | Team Lead | Member |
|--------|-------|-----------|--------|
| View chapter calendar | ✅ | ✅ | ✅ |
| View leads events | ✅ | ✅ | ❌ |
| View team events | ✅ | ✅ (own teams) | ✅ (own teams) |
| Create chapter event | ✅ | ✅ | ❌ |
| Create team event | ✅ | ✅ (own) | ❌ |
| Edit / delete event | ✅ | ✅ (own) | ❌ |
| Cancel single recurrence | ✅ | ✅ (own) | ❌ |
| Set email / Google Cal flags | ✅ | ✅ (own) | ❌ |
| RSVP | ✅ | ✅ | ✅ |
| Download .ics | ✅ | ✅ | ✅ (visible events) |
| iCal feed subscription | ✅ | ✅ | ✅ |

---

## Pages & Routes

### Pages (`src/pages/admin/events/`)

| Path | Access | Description |
|------|--------|-------------|
| `/admin/events` | All | Calendar view (month/week), filtered by viewer permissions |
| `/admin/events/new` | Admin, Team Lead | Create event form |
| `/admin/events/[id]` | All (visible) | Event detail, RSVP, export options |
| `/admin/events/[id]/edit` | Admin, creator | Edit event |
| `/admin/events/archive` | All | Past and cancelled events |

### API Routes (`src/pages/api/events/`)

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| `POST` | `/api/events` | Admin, Team Lead | Create event + generate occurrences + notify |
| `PATCH` | `/api/events/[id]` | Admin, creator | Update event |
| `DELETE` | `/api/events/[id]` | Admin, creator | Cancel event |
| `PATCH` | `/api/events/[id]/occurrences/[date]` | Admin, creator | Cancel single recurrence |
| `POST` | `/api/events/[id]/rsvp` | Authenticated | Confirm or decline (optional) |
| `GET` | `/api/events/[id]/export.ics` | Authenticated (visible) | Download single-event .ics file |
| `GET` | `/api/calendar/feed` | Token in query (`?token=`) | Personal iCal feed (no session required) |
| `POST` | `/api/events/[id]/google-cal` | Authenticated | Push event to viewer's Google Calendar |
| `POST` | `/api/cron/event-reminders` | Vercel cron secret | Daily reminder job |

### Middleware additions

```typescript
// src/middleware.ts — nonAdminAllowed
/^\/admin\/events$/,
/^\/admin\/events\/new$/,
/^\/admin\/events\/[^/]+$/,
/^\/admin\/events\/[^/]+\/edit$/,
/^\/admin\/events\/archive$/,
```

---

## Calendar View

Built with vanilla HTML/CSS — no FullCalendar or similar library.

**Month view** — grid of days; events rendered as coloured pills. Multi-day events span columns.  
**Week view** — time-slotted columns per day; good for spotting intra-week conflicts.

**Colour coding:**
- Chapter-wide → navy (brand primary)
- Team events → teal
- Leads-only → purple
- Cancelled → muted / strikethrough

**Conflict detection** (server-side at render time): if two events for the same audience group overlap in time, both show a ⚠️ badge.

**Filtering:** `?team=<id>`, `?month=YYYY-MM`, `?visibility=team|chapter|leads`

---

## Recurring Events

### Supported RRULE patterns

| Pattern | Example use |
|---------|-------------|
| `FREQ=WEEKLY;BYDAY=MO` | Every Monday meeting |
| `FREQ=WEEKLY;BYDAY=MO,WE` | Mon + Wed sessions |
| `FREQ=MONTHLY;BYDAY=1MO` | First Monday of month |
| `FREQ=MONTHLY;BYMONTHDAY=15` | 15th of every month |
| `FREQ=DAILY` | Daily standups |

Occurrence expansion uses the `rrule` npm package server-side, generating rows up to 2 years ahead.

### Editing recurring events — three options

1. **This occurrence only** — cancels/edits the `event_occurrences` row.
2. **This and future** — sets `recurrence_ends_at` on the parent, creates new series.
3. **All occurrences** — updates parent, regenerates future occurrences.

---

## Reminder Strategy

Four independent channels; creators choose which apply per event.

### 1. In-app notification (always on)

Uses existing `notifyMultiple()` in `src/lib/notify.ts`.

New notification types:
```typescript
// notifications/index.astro TAG_TYPES addition:
events: ['event_created', 'event_updated', 'event_cancelled', 'event_reminder']

// TYPE_ICONS addition:
event_created:   '📅',
event_updated:   '✏️',
event_cancelled: '🚫',
event_reminder:  '⏰',
```

### 2. Email reminder (opt-in per event) 

Toggle: `notify_email = true` on the event.  
Sent by the daily cron job `N` days before (`notify_days_before`).  
Uses existing `sendEmailBulk()` from `src/lib/gmail.ts`.

**Cron job** — `src/pages/api/cron/event-reminders.ts`:
```
GET /api/cron/event-reminders
Authorization: Bearer <CRON_SECRET>
```

`vercel.json`:
```json
{ "crons": [{ "path": "/api/cron/event-reminders", "schedule": "0 8 * * *" }] }
```

Env var `CRON_SECRET` must be added to Vercel project settings.

### 3. iCal / ICS file download (one-off export)

`GET /api/events/[id]/export.ics` returns a valid RFC 5545 `.ics` file for that event (or all its occurrences if recurring). The user opens it to add to any calendar app (Apple Calendar, Google Calendar, Outlook).

No external library needed — the ICS format is straightforward text.

Example output:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//100 Black Men of London//CRM//EN
BEGIN:VEVENT
UID:<event-id>@100bmol.org.uk
DTSTART:20260901T180000Z
DTEND:20260901T200000Z
SUMMARY:Monthly Chapter Meeting
DESCRIPTION:...
LOCATION:London, SE1
END:VEVENT
END:VCALENDAR
```

### 4. Personal iCal feed (live subscription)

`GET /api/calendar/feed?token=<personal_token>` returns an `.ics` feed of all events visible to that person, updating dynamically.

The user copies this URL into their calendar app ("Subscribe to calendar") and it stays current — new events appear automatically, cancellations disappear.

**Token management:**  
- Generated on first use (lazy creation in `calendar_tokens` table).
- Exposed on the member's profile page or a dedicated "My Calendar" settings page.
- The token is unauthenticated by design (calendar apps don't send cookies) but is a long random hex string — treat it like an API key.
- Token can be regenerated (invalidates old subscription URL).

**Feed content:** all `chapter` events + `team` events for the person's teams + `leads` events if they're a team lead.

### 5. Google Calendar push (org email only)

Toggle: `notify_google_cal = true` on the event.

When an event is created (or updated/cancelled), the CRM pushes a Google Calendar event to each audience member's primary calendar using the **Google Calendar API** with the existing service account + domain-wide delegation.

**Why this works without extra setup:**  
The service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) already has domain-wide delegation configured for Gmail. Adding the Calendar scope requires:
1. Adding `https://www.googleapis.com/auth/calendar` to the service account's authorised scopes in Google Workspace Admin → Security → API Controls → Domain-wide Delegation.
2. Adding it to the auth client in `src/lib/google.ts`.

**Implementation — `src/lib/gcal.ts`:**

```typescript
import { google } from 'googleapis'

function getCalendarClient(impersonateEmail: string) {
  return google.calendar({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
      credentials: {
        client_email: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: parsePrivateKey(),
      },
      clientOptions: { subject: impersonateEmail },
      scopes: ['https://www.googleapis.com/auth/calendar'],
    }),
  })
}

export async function pushEventToCalendar(
  recipientEmail: string,
  event: { id: string; title: string; description?: string; location?: string; startsAt: Date; endsAt: Date }
): Promise<string | null>   // returns Google Calendar event ID for later update/delete

export async function updateCalendarEvent(recipientEmail: string, gcalEventId: string, updates: {...}): Promise<void>

export async function cancelCalendarEvent(recipientEmail: string, gcalEventId: string): Promise<void>
```

**Tracking Google Calendar event IDs:**  
Store the returned Google Calendar event ID per-person per-event so we can update or cancel it later:

```sql
alter table event_attendees
  add column gcal_event_id text;  -- null if not pushed to Google Calendar
```

**Caveats:**
- Only works for `@100bmol.org.uk` (org) email addresses. Personal Gmail addresses outside the domain cannot be impersonated.
- If a member's org email is inactive or suspended, the push will silently fail (log but don't throw).

---

## Email Template

New template in `src/lib/email-templates.ts`:

```typescript
export function eventNotificationEmail(opts: {
  recipientName: string
  eventTitle: string
  eventDate: string
  eventLocation?: string
  description?: string
  rsvpUrl: string
  icsUrl: string          // link to download .ics
  action: 'created' | 'updated' | 'cancelled' | 'reminder'
}): string
```

The email includes a prominent "Add to Calendar" button that links to the `.ics` download URL — the easiest path for users who aren't using Google Calendar or the live feed.

---

## File Structure

```
src/
├── pages/
│   ├── admin/events/
│   │   ├── index.astro           # Calendar view
│   │   ├── new.astro             # Create form
│   │   ├── archive.astro         # Past + cancelled events
│   │   └── [id].astro           # Detail + RSVP + export options
│   │   └── [id]/
│   │       └── edit.astro       # Edit form
│   └── api/
│       ├── events/
│       │   ├── index.ts          # POST create
│       │   └── [id]/
│       │       ├── index.ts      # PATCH, DELETE
│       │       ├── rsvp.ts       # POST rsvp
│       │       ├── export.ics.ts # GET ics download
│       │       ├── google-cal.ts # POST push to Google Cal
│       │       └── occurrences/
│       │           └── [date].ts # PATCH single occurrence
│       ├── calendar/
│       │   └── feed.ts           # GET iCal feed (token auth)
│       └── cron/
│           └── event-reminders.ts
└── lib/
    ├── events.ts                  # generateOccurrences, getAudience, buildICS
    └── gcal.ts                    # Google Calendar API helpers
```

---

## New Types (`domain.ts` additions)

```typescript
export type EventVisibility = 'chapter' | 'team' | 'leads'
export type AttendeeStatus = 'invited' | 'confirmed' | 'declined'

export interface ChapterEvent {
  id: string
  title: string
  description?: string
  location?: string
  starts_at: string
  ends_at: string
  all_day: boolean
  team_id?: string
  pillar_id?: string
  visibility: EventVisibility
  is_recurring: boolean
  recurrence_rule?: string
  recurrence_ends_at?: string
  notify_email: boolean
  notify_days_before: number
  notify_google_cal: boolean
  created_by: string
  created_at: string
  updated_at: string
  is_cancelled: boolean
}
```

---

## Phased Rollout

### Phase 1 — Core events (non-recurring)

- DB: `events`, `event_attendees`
- Pages: calendar list view, create form, detail page, archive
- API: POST create, PATCH edit, DELETE cancel
- Visibility model enforced server-side
- In-app notifications on create/update/cancel
- One-off `.ics` file download

### Phase 2 — Recurring events

- DB: `event_occurrences`
- RRULE expansion via `rrule` npm package
- Edit-one / edit-future / edit-all modal
- Cancel single occurrence

### Phase 3 — Email notifications & iCal feed

- `notify_email` toggle in form
- Email template with "Add to Calendar" button
- Cron job for daily reminders (`CRON_SECRET` env var)
- `calendar_tokens` table + personal iCal feed endpoint
- Feed URL exposed on member profile / settings

### Phase 4 — Google Calendar integration

- `gcal.ts` library (Calendar API, service account)
- `notify_google_cal` toggle in form
- Push on create, update on edit, cancel on delete
- `gcal_event_id` stored per attendee row
- Google Workspace Admin: add Calendar scope to domain-wide delegation

### Phase 5 — RSVP & conflict detection

- RSVP API + UI (confirm / decline — always optional)
- Conflict indicator on calendar for overlapping events
- Attendee list on event detail page
