---
name: astro-api-route
description: >
  Scaffolds a typed Astro API endpoint for the 100BMOL Member Portal with auth, Zod validation,
  Supabase queries, audit logging, and structured JSON responses. Use this skill whenever you
  need to create a server-side API route — form submissions, CRUD operations, webhook handlers,
  file uploads, or any server action. Trigger for requests like "create an API route for X",
  "add a POST endpoint to save Y", "build the API for member creation", "handle the form
  submission for Z", or any time data needs to be written to the database.
---

# Astro API Route — 100BMOL Portal

You are creating a server-side API endpoint for the **100 Black Men of London Member Portal**.
API routes live in `src/pages/api/` and follow strict conventions for auth, validation, and
audit logging.

## Route file structure

```
src/pages/api/
  members/
    index.ts          # GET (list) + POST (create)
    [id].ts           # GET (single) + PUT (update) + DELETE (archive)
    [id]/
      dues.ts         # Nested resource
  positions/
    [id]/
      assign.ts       # Action endpoint
```

## Standard route template

```typescript
// src/pages/api/members/index.ts
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'

// Zod schema — defines and validates the request body
const CreateMemberSchema = z.object({
  full_name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  person_types: z.array(z.enum(['member', 'mentor', 'volunteer', 'alumni', 'parent', 'trustee'])).min(1),
  status: z.enum(['applicant', 'pending_review', 'approved', 'active', 'inactive', 'alumni', 'left']).default('applicant'),
})

export const POST: APIRoute = async ({ request, locals }) => {
  // 1. Auth check
  const user = locals.user
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 2. Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = CreateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 3. Database operation
  const { data: member, error } = await supabaseAdmin
    .from('people')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/members] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create member' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 4. Audit log — every mutation must be logged
  await writeAuditLog({
    actorId: user.id,
    action: 'create',
    targetTable: 'people',
    targetId: member.id,
    afterValue: member,
  })

  // 5. Return success
  return new Response(JSON.stringify({ data: member }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const GET: APIRoute = async ({ url, locals }) => {
  const user = locals.user
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Query params
  const status = url.searchParams.get('status')
  const teamId = url.searchParams.get('team_id')

  let query = supabaseAdmin
    .from('people')
    .select('*, person_teams(team_id)')
    .eq('is_archived', false)
    .order('full_name')

  if (status) query = query.eq('status', status)
  if (teamId) query = query.eq('person_teams.team_id', teamId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/members] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch members' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

## Audit log helper

Create `src/lib/audit.ts`:

```typescript
import { supabaseAdmin } from './supabase'
import type { AuditAction } from '@/types/domain'

interface AuditEntry {
  actorId: string
  action: AuditAction
  targetTable: string
  targetId: string
  beforeValue?: Record<string, unknown>
  afterValue?: Record<string, unknown>
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const { error } = await supabaseAdmin.from('audit_log').insert({
    actor_id: entry.actorId,
    action: entry.action,
    target_table: entry.targetTable,
    target_id: entry.targetId,
    before_value: entry.beforeValue ?? null,
    after_value: entry.afterValue ?? null,
  })

  if (error) {
    // Log but don't throw — audit failure should not break the operation
    console.error('[AuditLog] Failed to write entry:', error)
  }
}
```

## HTTP method patterns

| Operation | Method | Status | Body |
|---|---|---|---|
| Create | POST | 201 | `{ data: newRecord }` |
| Read list | GET | 200 | `{ data: records[] }` |
| Read single | GET | 200 | `{ data: record }` |
| Update | PUT or PATCH | 200 | `{ data: updatedRecord }` |
| Archive (soft delete) | DELETE | 200 | `{ data: { id, is_archived: true } }` |
| Validation error | — | 422 | `{ error: 'Validation failed', issues: {...} }` |
| Auth error | — | 401 | `{ error: 'Unauthorised' }` |
| Not found | — | 404 | `{ error: 'Not found' }` |
| Server error | — | 500 | `{ error: 'Human-readable message' }` |

## Atomic operations (elected position tenure assignment)

For operations that must succeed or fully roll back, use a Supabase transaction via RPC:

```typescript
// Call a Postgres function that runs in a transaction
const { data, error } = await supabaseAdmin.rpc('assign_elected_tenure', {
  p_position_id: positionId,
  p_person_id: personId,
  p_term_start: termStart,
  p_elected_by: electedBy,
  p_actor_id: user.id,
})
```

Define the function in a migration file. Never simulate transactions in application code.

## Form submission from Astro pages

When a page uses `<form method="POST">`, handle it in the same `.astro` file:

```astro
---
if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData()
  const result = await fetch(`${Astro.url.origin}/api/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: Astro.request.headers.get('cookie') ?? '' },
    body: JSON.stringify(Object.fromEntries(form)),
  })
  if (result.ok) return Astro.redirect('/admin/members')
}
---
```

Or for simple cases, write the Supabase query directly in the page frontmatter (acceptable for
straightforward creates with no complex validation).

## Rules

- **Every mutation writes to audit_log** — no exceptions
- **Zod validates every request body** — never trust raw input
- **Auth checked first** — before any DB call
- **supabaseAdmin for all server-side writes** — anon key is for client-side reads only
- **No `any`** — type everything, especially parsed request bodies
- **Console.error all DB errors** with the route path as prefix: `[POST /api/x]`
- **Never hard-delete** — set `is_archived = true`, return the updated record
