import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreateSessionSchema = z.object({
  programme_year_id: z.string().uuid('Programme year is required'),
  title: z.string().min(1, 'Title is required'),
  session_date: z.string().min(1, 'Session date is required'),
  session_time: z.string().optional().nullable(),
  session_end_time: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  type: z.enum(['regular', 'special', 'trip']).optional().nullable(),
  notes: z.string().optional().nullable(),
  is_cancelled: z.boolean().optional().default(false),
  cancellation_reason: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const yearId = url.searchParams.get('year_id')

  let query = supabaseAdmin
    .from('cmp_sessions')
    .select('*, cmp_programme_years(id, name), cmp_attendance(id, status)')
    .order('session_date', { ascending: true })

  if (yearId) query = query.eq('programme_year_id', yearId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/cmp/sessions] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch sessions' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

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

  const parsed = CreateSessionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: session, error } = await supabaseAdmin
    .from('cmp_sessions')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/cmp/sessions] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create session' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'cmp_sessions',
    targetId: session.id as string,
    afterValue: session as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: session }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
