/**
 * CMP Attendance API
 *
 * POST — Upsert a single attendance record.
 *        Supports four roles: mentor (person_id), mentee (mentee_id),
 *        parent and visitor (visitor_name).
 * DELETE — Remove an attendance record by id.
 */

import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const UpsertAttendanceSchema = z.discriminatedUnion('role', [
  // Mentee attendance (person is in the mentees table)
  z.object({
    session_id:   z.string().uuid(),
    role:         z.literal('mentee'),
    mentee_id:    z.string().uuid(),
    status:       z.enum(['present', 'absent', 'apology']),
  }),
  // Mentor attendance (person is in the people table)
  z.object({
    session_id:   z.string().uuid(),
    role:         z.literal('mentor'),
    person_id:    z.string().uuid(),
    status:       z.enum(['present', 'absent', 'apology']),
  }),
  // Parent attendance (ad-hoc name, not in people table)
  z.object({
    session_id:    z.string().uuid(),
    role:          z.literal('parent'),
    visitor_name:  z.string().min(1),
    status:        z.enum(['present', 'absent', 'apology']).default('present'),
  }),
  // Visitor attendance (ad-hoc name, not in people table)
  z.object({
    session_id:    z.string().uuid(),
    role:          z.literal('visitor'),
    visitor_name:  z.string().min(1),
    status:        z.enum(['present', 'absent', 'apology']).default('present'),
  }),
])

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpsertAttendanceSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { session_id, role, status } = parsed.data
  const now = new Date().toISOString()

  // Build upsert payload and conflict target based on role
  let upsertPayload: Record<string, unknown>
  let onConflict: string

  if (role === 'mentee') {
    const { mentee_id } = parsed.data as { mentee_id: string }
    upsertPayload = { session_id, role, mentee_id, status, recorded_by: locals.user.person_id, recorded_at: now }
    onConflict = 'session_id,mentee_id'
  } else if (role === 'mentor') {
    const { person_id } = parsed.data as { person_id: string }
    upsertPayload = { session_id, role, person_id, status, recorded_by: locals.user.person_id, recorded_at: now }
    onConflict = 'session_id,person_id,role'
  } else {
    // parent / visitor — no unique upsert, always insert
    const { visitor_name } = parsed.data as { visitor_name: string }
    const { data: record, error } = await supabaseAdmin
      .from('cmp_attendance')
      .insert({ session_id, role, visitor_name, status, recorded_by: locals.user.person_id, recorded_at: now })
      .select()
      .single()

    if (error) {
      console.error('[POST /api/cmp/attendance] DB error:', error)
      return new Response(JSON.stringify({ error: 'Failed to save attendance' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    await writeAuditLog({
      actorId: locals.user.person_id,
      action: 'create',
      targetTable: 'cmp_attendance',
      targetId: record.id as string,
      afterValue: record as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ data: record }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: record, error } = await supabaseAdmin
    .from('cmp_attendance')
    .upsert(upsertPayload as never, { onConflict, ignoreDuplicates: false })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/cmp/attendance] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to save attendance' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'cmp_attendance',
    targetId: record.id as string,
    afterValue: record as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: record }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = body as { id?: string }
  if (!id) {
    return new Response(JSON.stringify({ error: 'id is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error } = await supabaseAdmin.from('cmp_attendance').delete().eq('id', id)

  if (error) {
    console.error('[DELETE /api/cmp/attendance] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete attendance record' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'cmp_attendance',
    targetId: id,
  })

  return new Response(JSON.stringify({ data: { id } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
