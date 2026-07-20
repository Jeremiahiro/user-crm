# Audit Log

## Purpose

Every mutation in the portal — creating a member, updating a role, archiving a team, assigning a tenure — produces an immutable record in the `audit_log` table. The audit log exists to answer "who changed what, and when?" for any record in the system. It is the authoritative trail for governance, dispute resolution, and compliance.

---

## Writing Audit Entries

All application code uses the `writeAuditLog()` helper from `src/lib/audit.ts`. It is never called with raw SQL:

```typescript
import { writeAuditLog } from '@/lib/audit'

await writeAuditLog({
  actorId: locals.user.person_id,  // UUID of the logged-in person
  action: 'update',
  targetTable: 'people',
  targetId: member.id,
  beforeValue: existingRecord,     // Full row snapshot before the change
  afterValue: updatedRecord,       // Full row snapshot after the change
})
```

The function inserts one row into `audit_log` using `supabaseAdmin` (the service role client). If the insert fails for any reason, the error is logged to `console.error` with the prefix `[AuditLog] Failed to write entry:`, but **the exception is not re-thrown**. This design means an audit log failure can never cause the underlying mutation to fail or surface an error to the user.

This is an intentional trade-off. The audit log is important, but it is a secondary concern to the operation succeeding. If audit writes begin failing consistently, the `console.error` output in Vercel's function logs will surface this for investigation.

---

## Record Structure

Each row in `audit_log` has the following columns:

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key, auto-generated |
| `actor_id` | `uuid` | The `people.id` of the user who performed the action |
| `action` | `text` | One of the eight action types listed below |
| `target_table` | `text` | The name of the table that was modified |
| `target_id` | `uuid` | The primary key of the affected row |
| `before_value` | `jsonb` | Full snapshot of the row before the change (null for create actions) |
| `after_value` | `jsonb` | Full snapshot of the row after the change (null for delete/archive when appropriate) |
| `created_at` | `timestamptz` | Timestamp of the audit entry, set by the database |

---

## Action Types

| Action | When used |
|---|---|
| `create` | A new record was inserted |
| `update` | An existing record's fields were changed |
| `delete` | A record was hard-deleted (only for roles never assigned to a user) |
| `archive` | A record was soft-deleted (`is_archived = true` or `is_active = false`) |
| `role_grant` | A role was assigned to a person (`user_roles` insert) |
| `role_revoke` | A role was removed from a person (`user_roles` delete) |
| `tenure_create` | A new elected position tenure was recorded |
| `tenure_end` | An existing tenure was closed by setting `term_end` |

---

## Append-Only Enforcement

The audit log is protected at three layers:

**RLS policies.** Two restrictive policies on the `audit_log` table make updates and deletes impossible for all roles including the service role:

```sql
create policy "audit_log_no_update" on audit_log
  as restrictive for update using (false);

create policy "audit_log_no_delete" on audit_log
  as restrictive for delete using (false);
```

**No API route.** There is no `PUT` or `DELETE` endpoint for `/api/audit-log`. The table is read-only from the application layer.

**No admin UI action.** The audit log view in the admin dashboard is read-only. There are no edit or delete buttons.

---

## Reading Audit Entries

The `audit_log` table is readable by all authenticated users (`FOR SELECT TO authenticated USING (true)`). In practice, read access is gated at the UI level — only the Admin dashboard and member profile pages surface audit history, and only to users with appropriate roles.

Queries typically filter by `target_table` and `target_id` to fetch the history for a specific record, or by `actor_id` to see everything a particular person has done. Indexes exist on `actor_id`, `(target_table, target_id)`, and `created_at` to keep these queries fast.

---

## Business Rules

**Every mutation must call `writeAuditLog()`.** This is a code convention, not an enforcement mechanism. All API routes in `src/pages/api/` are expected to call `writeAuditLog()` after every successful database write. Code reviewers should verify this during PR review.

**Before and after snapshots.** For `update` and `archive` actions, pass both `beforeValue` and `afterValue` so the exact change is visible without needing to reconstruct it. Fetch the `before` snapshot immediately before performing the update, not after. For `create`, only `afterValue` is needed. For `delete`, only `beforeValue` is needed.

**`actor_id` is always the authenticated user.** Never pass a hardcoded ID or a system user ID. If `locals.user.person_id` is unavailable for any reason, the write will still proceed (the column allows null FK references), but this situation should be investigated — it implies a route that is not properly protected by authentication middleware.

**The audit log is not a message queue.** It records what happened, not what should happen. Do not use it to drive workflows or trigger downstream effects. That is the job of the application layer.
