import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

const UpdatePositionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100).optional(),
  description: z.string().optional().nullable(),
  order_of_precedence: z.coerce.number().int().optional().nullable(),
})

// PUT /api/positions/:id — update position details
export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdatePositionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin
    .from('elected_positions').select('*').eq('id', id).single()

  const { data: position, error } = await supabaseAdmin
    .from('elected_positions')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error || !position) {
    console.error('[PUT /api/positions/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update position' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'elected_positions',
    targetId: id,
    beforeValue: before as Record<string, unknown>,
    afterValue: position as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: position }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// DELETE /api/positions/:id — delete a position (only if no tenures assigned)
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { count } = await supabaseAdmin
    .from('elected_position_tenures')
    .select('id', { count: 'exact', head: true })
    .eq('position_id', id)

  if ((count ?? 0) > 0) {
    return new Response(
      JSON.stringify({ error: 'Cannot delete a position that has tenure history.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: position } = await supabaseAdmin
    .from('elected_positions').select('title').eq('id', id).single()

  const { error } = await supabaseAdmin.from('elected_positions').delete().eq('id', id)

  if (error) {
    console.error('[DELETE /api/positions/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete position' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'elected_positions',
    targetId: id,
    beforeValue: { title: position?.title },
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
