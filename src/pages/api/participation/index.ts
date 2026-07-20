import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreateParticipationSchema = z.object({
  person_id: z.string().uuid('Member is required'),
  event_name: z.string().min(1, 'Event name is required'),
  event_date: z.string().optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  pillar_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = url.searchParams.get('person_id')
  const teamId = url.searchParams.get('team_id')
  const pillarId = url.searchParams.get('pillar_id')

  let query = supabaseAdmin
    .from('participation_events')
    .select('*, people(id, full_name), teams(id, name), pillars(id, name)')
    .eq('is_archived', false)
    .order('event_date', { ascending: false })

  if (personId) query = query.eq('person_id', personId)
  if (teamId) query = query.eq('team_id', teamId)
  if (pillarId) query = query.eq('pillar_id', pillarId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/participation] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch participation events' }), {
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

  const parsed = CreateParticipationSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: event, error } = await supabaseAdmin
    .from('participation_events')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/participation] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to log participation event' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'participation_events',
    targetId: event.id as string,
    afterValue: event as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: event }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
