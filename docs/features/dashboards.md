# Dashboards & Analytics

## Main dashboard (`/dashboard`)

The main dashboard gives admins an at-a-glance view of chapter health. All data is fetched in parallel with `Promise.all` on the server.

### Layout

```
Row 1 (4 stat cards):   Total members | Active | Pending review | Volunteers
Row 2 (3 compliance):   DBS expiring (60d) | DBS expired | Dues compliance % + progress bar
Main grid (3 columns):
  Col 1: Activity feed (last 10 audit_log entries, human-readable labels)
  Col 2: Upcoming CMP sessions | Recent praise feed
  Col 3: Quick actions (6 links) | Admin areas nav (12 links, navy background)
```

### Compliance metrics

**Dues compliance** = `membersPaidThisYear / activeMembers * 100`
- `membersPaidThisYear`: distinct active members with at least one dues record for the current year (any `paid_at` value), regardless of month
- Progress bar width is set via inline `style` because Tailwind can't interpolate dynamic values at build time

**DBS expiry** uses `expiry_date` on `dbs_records`. Expiring = within 60 days from today's server-rendered date.

### Activity feed

Uses `audit_log` ordered by `created_at desc`, limit 10. Human-readable labels are produced by two maps:

```typescript
const TABLE_LABELS: Record<string, string> = { people: 'Member', dues: 'Dues record', ... }
const ACTION_LABELS: Record<string, string> = { create: 'created', update: 'updated', delete: 'deleted', archive: 'archived' }
```

Entry format: `"{action} {table}" — {target_label} · {timeAgo}`

---

## Member profile recognition tab

Member profile pages (`/admin/members/:id`) include a **Recognition** tab that aggregates the member's awards, praise, and participation events in one place.

Data is fetched after the main member query using a parallel `Promise.all`:

```typescript
const [{ data: memberAwards }, { data: memberPraise }, { data: memberParticipation }] = await Promise.all([
  supabaseAdmin.from('awards').select('id, type, year, citation, created_at, people!awards_awarded_by_fkey(id, full_name)').eq('person_id', id ?? '').order('year', { ascending: false }),
  supabaseAdmin.from('praise').select('id, message, visibility, created_at, people!praise_given_by_fkey(id, full_name)').eq('recipient_id', id ?? '').eq('is_archived', false).order('created_at', { ascending: false }),
  supabaseAdmin.from('participation_events').select('id, event_name, event_date, notes, teams(name), pillars(name)').eq('person_id', id ?? '').eq('is_archived', false).order('event_date', { ascending: false }),
])
```

The tab badge shows the combined count of awards + praise when non-zero.

### Sections

**Awards** — Table with award type (from `AWARD_LABELS`), year, citation, and the awarding admin's name. Quick-link to `/admin/awards/new?person_id=:id`.

**Praise** — Card feed. Each card shows the giver's name, date, and message with a gold left-border. `admin_only` praise gets an amber "Admin only" badge. Quick-link to `/admin/praise/new?person_id=:id`.

**Participation events** — Table with event name, date, team or pillar, and notes. Quick-link to `/admin/participation/new?person_id=:id`.

---

## Analytics page (`/admin/analytics`)

Organisation-wide summary page with visualisations built from raw Supabase queries — no charting library dependency, all rendered as HTML bar charts via inline `style` widths.

### Data fetched (all parallel)

| Source | Purpose |
|--------|---------|
| `people` | Status/type counts, total membership |
| `dues` (current year) | Dues compliance for active members |
| `dbs_records` | DBS validity status per active member |
| `participation_events` grouped by `pillar_id` | Pillar participation bar chart |
| `participation_events` grouped by `team_id` | Team participation bar chart (top 8) |
| `people.joined_at` | Membership growth by year (last 8 years) |

### Sections

**Summary cards (top row):** Total members · Active (% of total) · Dues compliance % · DBS valid count with expired/expiring/missing breakdown

**Member status breakdown:** Horizontal bar chart, one bar per status. Bars coloured by semantic status (success=active, warning=pending, danger=left, etc.)

**DBS status (active members only):** Four bands — valid, expiring soon, expired, missing. Links to `/admin/dbs?filter=expired` and `/admin/dbs?filter=expiring` when counts are non-zero.

**Participation by pillar:** Bars relative to the highest-count pillar, coloured gold.

**Participation by team:** Top 8 teams, bars relative to highest count, coloured navy.

**Membership growth:** Bar chart of new member joins by year, last 8 years. Current year bar is gold; prior years are navy.

**Member type breakdown:** Table with count and % of total per `member_type` value.

### DBS calculation logic

For each active member, the latest DBS record (by `expiry_date`) is selected. The member is then classified:
- No record or null `expiry_date` → **Missing**
- `expiry_date < today` → **Expired**
- `expiry_date < today + 60 days` → **Expiring soon**
- Otherwise → **Valid**

### Dues compliance calculation

Same logic as the main dashboard: distinct `person_id`s from `dues` where `paid_at IS NOT NULL AND year = currentYear`, intersected with active member IDs.
