import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreatePositionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  description: z.string().optional(),
  order_of_precedence: z.coerce.number().int().optional(),
  linked_system_role_id: z.string().uuid().optional().nullable(),
})

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('elected_positions')
    .select(`
      *,
      roles:linked_system_role_id(name),
      elected_position_tenures(
        id, term_start, term_end,
        people(id, full_name, profile_photo_url)
      )
    `)
    .order('order_of_precedence', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[GET /api/positions] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch positions' }), {
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

  const parsed = CreatePositionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: position, error } = await supabaseAdmin
    .from('elected_positions')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/positions] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create position' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'elected_positions',
    targetId: position.id as string,
    afterValue: position as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: position }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
