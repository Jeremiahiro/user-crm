import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const UpdatePillarSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('pillars')
    .select('*')
    .eq('id', params.id ?? '')
    .single()

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
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

  const parsed = UpdatePillarSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin
    .from('pillars').select('*').eq('id', params.id ?? '').single()

  const { data: pillar, error } = await supabaseAdmin
    .from('pillars')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !pillar) {
    console.error('[PUT /api/pillars/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update pillar' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'pillars',
    targetId: pillar.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: pillar as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: pillar }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Block archive if teams assigned to this pillar
  const { count: teamCount } = await supabaseAdmin
    .from('teams')
    .select('*', { count: 'exact', head: true })
    .eq('pillar_id', params.id ?? '')
    .eq('is_active', true)

  if (teamCount && teamCount > 0) {
    return new Response(
      JSON.stringify({ error: 'Cannot archive: this pillar has active teams assigned. Reassign or archive the teams first.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin
    .from('pillars').select('*').eq('id', params.id ?? '').single()

  const { data: pillar, error } = await supabaseAdmin
    .from('pillars')
    .update({ is_active: false })
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !pillar) {
    console.error('[DELETE /api/pillars/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to archive pillar' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'archive',
    targetTable: 'pillars',
    targetId: pillar.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: pillar as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: pillar }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
