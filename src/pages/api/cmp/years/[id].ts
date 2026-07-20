import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const UpdateYearSchema = z.object({
  name: z.string().min(1).optional(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: year, error } = await supabaseAdmin
    .from('cmp_programme_years')
    .select(`
      *,
      cmp_sessions(
        id, title, session_date, session_time, location, type, is_cancelled,
        cmp_attendance(id, status, mentee_id, person_id)
      )
    `)
    .eq('id', params.id ?? '')
    .single()

  if (error || !year) {
    return new Response(JSON.stringify({ error: 'Programme year not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data: year }), {
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

  const parsed = UpdateYearSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin
    .from('cmp_programme_years').select('*').eq('id', params.id ?? '').single()

  const { data: year, error } = await supabaseAdmin
    .from('cmp_programme_years')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !year) {
    console.error('[PUT /api/cmp/years/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update programme year' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'cmp_programme_years',
    targetId: year.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: year as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: year }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
