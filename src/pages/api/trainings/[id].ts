/**
 * GET    /api/trainings/:id  — detail + current user's assignment/completion
 * PUT    /api/trainings/:id  — update (admin or creator lead)
 * DELETE /api/trainings/:id  — archive (admin only; blocks if active future assignments)
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const UpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(100000).optional().nullable(),
  external_url: z.string().url().optional().nullable().or(z.literal('')),
  requires_document: z.boolean().optional(),
  expected_document_type_id: z.string().uuid().optional().nullable(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const { data: training, error } = await supabaseAdmin
    .from('trainings')
    .select(`
      *,
      expected_document_type:document_types(id, name, slug),
      creator:people!created_by(full_name),
      training_assignments(id, scope, team_id, person_id, deadline)
    `)
    .eq('id', params.id ?? '')
    .single()

  if (error || !training) return json({ error: 'Not found' }, 404)

  // Get current user's completion if any
  const { data: completion } = await supabaseAdmin
    .from('training_completions')
    .select('id, method, completed_at, document_id')
    .eq('training_id', params.id ?? '')
    .eq('person_id', locals.user.person_id)
    .maybeSingle()

  return json({ data: { ...training, my_completion: completion ?? null } })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const admin = isAdmin(locals.user)
  if (!admin) {
    // Team leads can only edit trainings they created
    const { data: training } = await supabaseAdmin.from('trainings').select('created_by').eq('id', params.id ?? '').single()
    if (!training || (training as any).created_by !== locals.user.person_id) return json({ error: 'Forbidden' }, 403)
  }

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const updates: Record<string, unknown> = { ...parsed.data }
  if ('external_url' in updates) updates.external_url = (updates.external_url as string) || null
  if ('expected_document_type_id' in updates) updates.expected_document_type_id = (updates.expected_document_type_id as string) || null

  const { data, error } = await supabaseAdmin.from('trainings').update(updates).eq('id', params.id ?? '').select().single()
  if (error || !data) return json({ error: 'Failed to update training' }, 500)
  return json({ data })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  // Block archive if active assignments with future deadlines exist
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await supabaseAdmin
    .from('training_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('training_id', params.id ?? '')
    .or(`deadline.is.null,deadline.gte.${today}`)

  if (count && count > 0) {
    return json({ error: `Cannot archive: ${count} active assignment(s) exist. Remove them first.` }, 409)
  }

  const { error } = await supabaseAdmin.from('trainings').update({ is_active: false }).eq('id', params.id ?? '')
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
