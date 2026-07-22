/**
 * POST /api/committees/:id/members  — add a person to a committee
 * DELETE /api/committees/:id/members — remove a person from a committee
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { writeAuditLog } from '@/lib/audit'

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const AddMemberSchema = z.object({
  personId: z.string().uuid(),
  isLead:   z.boolean().optional().default(false),
})

const RemoveMemberSchema = z.object({
  personId: z.string().uuid(),
})

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Admins only' }, 403)

  const committeeId = params.id ?? ''

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = AddMemberSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid body' }, 422)

  const { personId, isLead } = parsed.data

  const { data: existing } = await supabaseAdmin
    .from('person_committees')
    .select('person_id')
    .eq('committee_id', committeeId)
    .eq('person_id', personId)
    .maybeSingle()

  if (existing) return json({ error: 'This person is already a member of the committee.' }, 409)

  const { data: committee } = await supabaseAdmin
    .from('committees')
    .select('name')
    .eq('id', committeeId)
    .single()

  const { error } = await supabaseAdmin
    .from('person_committees')
    .insert({
      committee_id: committeeId,
      person_id:    personId,
      is_lead:      isLead,
      joined_at:    new Date().toISOString(),
    })

  if (error) {
    console.error('[POST /api/committees/:id/members]', error)
    return json({ error: error.message }, 500)
  }

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'create',
    targetTable: 'person_committees',
    targetId:    personId,
    afterValue:  { committee_id: committeeId, committee_name: committee?.name, person_id: personId, is_lead: isLead, added_by: locals.user.person_id },
  })

  return json({ ok: true }, 201)
}

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Admins only' }, 403)

  const committeeId = params.id ?? ''

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = RemoveMemberSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid body' }, 422)

  const { personId } = parsed.data

  const { error } = await supabaseAdmin
    .from('person_committees')
    .delete()
    .eq('committee_id', committeeId)
    .eq('person_id', personId)

  if (error) {
    console.error('[DELETE /api/committees/:id/members]', error)
    return json({ error: error.message }, 500)
  }

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'delete',
    targetTable: 'person_committees',
    targetId:    personId,
    afterValue:  { committee_id: committeeId, person_id: personId, removed_by: locals.user.person_id },
  })

  return json({ ok: true }, 200)
}
