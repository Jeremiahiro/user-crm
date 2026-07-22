import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const UpdateCommitteeSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().optional(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const { data, error } = await supabaseAdmin
    .from('committees')
    .select('*, person_committees(person_id, is_chair, joined_at, people(id, full_name, email, status, profile_photo_url))')
    .eq('id', params.id ?? '')
    .single()

  if (error || !data) return json({ error: 'Not found' }, 404)

  return json({ data }, 200)
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Admins only' }, 403)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const parsed = UpdateCommitteeSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const { data: before } = await supabaseAdmin.from('committees').select('*').eq('id', params.id ?? '').single()

  const { data: committee, error } = await supabaseAdmin
    .from('committees')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !committee) {
    console.error('[PUT /api/committees/:id] DB error:', error)
    return json({ error: 'Failed to update committee' }, 500)
  }

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'update',
    targetTable: 'committees',
    targetId:    committee.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue:  committee as Record<string, unknown>,
  })

  return json({ data: committee }, 200)
}

export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  const committeeId = params.id ?? ''
  const permanent   = url.searchParams.get('permanent') === 'true'

  const { count: memberCount } = await supabaseAdmin
    .from('person_committees')
    .select('*', { count: 'exact', head: true })
    .eq('committee_id', committeeId)

  if ((memberCount ?? 0) > 0) {
    return json({ error: 'This committee has members assigned. Remove them before archiving or deleting.' }, 409)
  }

  const { data: before } = await supabaseAdmin.from('committees').select('*').eq('id', committeeId).single()

  if (permanent) {
    const { error } = await supabaseAdmin.from('committees').delete().eq('id', committeeId)
    if (error) return json({ error: 'Failed to delete committee' }, 500)
    await writeAuditLog({
      actorId:     locals.user.person_id,
      action:      'delete',
      targetTable: 'committees',
      targetId:    committeeId,
      beforeValue: before as Record<string, unknown>,
    })
    return json({ ok: true }, 200)
  }

  const { data: committee, error } = await supabaseAdmin
    .from('committees')
    .update({ is_active: false })
    .eq('id', committeeId)
    .select()
    .single()

  if (error || !committee) return json({ error: 'Failed to archive committee' }, 500)

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'archive',
    targetTable: 'committees',
    targetId:    committee.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue:  committee as Record<string, unknown>,
  })

  return json({ data: committee }, 200)
}
