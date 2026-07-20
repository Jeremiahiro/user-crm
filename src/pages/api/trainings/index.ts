/**
 * GET  /api/trainings  — list trainings
 *   Admin/lead: all active; member: only assigned ones
 * POST /api/trainings  — create training (admin + team leads)
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamLeadIds } from '@/lib/rbac'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(100000).optional().nullable(),
  external_url: z.string().url().optional().nullable().or(z.literal('')),
  requires_document: z.boolean().default(false),
  expected_document_type_id: z.string().uuid().optional().nullable(),
})

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const admin = isAdmin(locals.user)
  const leadIds = admin ? null : await getTeamLeadIds(locals.user.person_id)
  const isLead = admin || (leadIds && leadIds.size > 0)

  if (admin || isLead) {
    // Admins and leads see all active trainings
    const { data, error } = await supabaseAdmin
      .from('trainings')
      .select(`
        id, title, description, external_url, requires_document, is_active, created_at,
        expected_document_type:document_types(id, name),
        creator:people!created_by(full_name)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (error) return json({ error: error.message }, 500)
    return json({ data: data ?? [] })
  }

  // Regular members: only see their assigned trainings
  const personId = locals.user.person_id
  const { data: assignments } = await supabaseAdmin
    .from('training_assignments')
    .select('training_id, deadline')
    .or(`person_id.eq.${personId},scope.eq.all`)

  const assignedTrainingIds = [...new Set((assignments ?? []).map((a: any) => a.training_id))]
  if (assignedTrainingIds.length === 0) return json({ data: [] })

  const { data, error } = await supabaseAdmin
    .from('trainings')
    .select('id, title, description, external_url, requires_document, expected_document_type:document_types(id, name)')
    .in('id', assignedTrainingIds)
    .eq('is_active', true)
  if (error) return json({ error: error.message }, 500)
  return json({ data: data ?? [] })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const admin = isAdmin(locals.user)
  const leadIds = admin ? null : await getTeamLeadIds(locals.user.person_id)
  if (!admin && (!leadIds || leadIds.size === 0)) return json({ error: 'Forbidden' }, 403)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const { data, error } = await supabaseAdmin
    .from('trainings')
    .insert({
      ...parsed.data,
      external_url: parsed.data.external_url || null,
      expected_document_type_id: parsed.data.expected_document_type_id || null,
      created_by: locals.user.person_id,
    })
    .select()
    .single()

  if (error) return json({ error: error.message }, 500)
  return json({ data }, 201)
}
