/**
 * PUT    /api/document-types/:id  — update (admin only)
 * DELETE /api/document-types/:id  — deactivate (admin only); cannot delete if docs reference it
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional().nullable(),
  requires_expiry: z.boolean().optional(),
  requires_issuer: z.boolean().optional(),
  is_training_linkable: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const { data, error } = await supabaseAdmin
    .from('document_types')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error) return json({ error: error.message }, 500)
  if (!data) return json({ error: 'Not found' }, 404)
  return json({ data })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  const id = params.id ?? ''

  // Check if any documents use this type — if so, only deactivate, never delete
  const { count } = await supabaseAdmin
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('document_type_id', id)

  if (count && count > 0) {
    // Deactivate instead of hard delete
    const { data, error } = await supabaseAdmin
      .from('document_types')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single()
    if (error) return json({ error: error.message }, 500)
    return json({ data, deactivated: true })
  }

  const { error } = await supabaseAdmin.from('document_types').delete().eq('id', id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
