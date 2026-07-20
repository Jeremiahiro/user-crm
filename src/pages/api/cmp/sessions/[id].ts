import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const UpdateSessionSchema = z.object({
  title: z.string().min(1).optional(),
  session_date: z.string().optional(),
  session_time: z.string().optional().nullable(),
  session_end_time: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  type: z.enum(['regular', 'special', 'trip']).optional().nullable(),
  notes: z.string().optional().nullable(),
  is_cancelled: z.boolean().optional(),
  cancellation_reason: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: session, error } = await supabaseAdmin
    .from('cmp_sessions')
    .select(`
      *,
      cmp_programme_years(id, name),
      cmp_attendance(
        id, status, recorded_at,
        mentee_id, mentees(id, full_name),
        person_id, people(id, full_name)
      )
    `)
    .eq('id', params.id ?? '')
    .single()

  if (error || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data: session }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
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

  const parsed = UpdateSessionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin
    .from('cmp_sessions').select('*').eq('id', params.id ?? '').single()

  const { data: session, error } = await supabaseAdmin
    .from('cmp_sessions')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !session) {
    console.error('[PUT /api/cmp/sessions/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update session' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'cmp_sessions',
    targetId: session.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: session as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: session }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Block delete if session has attendance records
  const { count } = await supabaseAdmin
    .from('cmp_attendance')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', params.id ?? '')

  if ((count ?? 0) > 0) {
    return new Response(
      JSON.stringify({ error: 'Cannot delete a session with attendance records. Clear attendance first.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { error } = await supabaseAdmin
    .from('cmp_sessions')
    .delete()
    .eq('id', params.id ?? '')

  if (error) {
    console.error('[DELETE /api/cmp/sessions/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete session' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'cmp_sessions',
    targetId: params.id ?? '',
  })

  return new Response(JSON.stringify({ data: { id: params.id } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
