/**
 * GET  /api/document-types  — list active types (all authenticated users)
 * POST /api/document-types  — create a new type (admin only)
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  requires_expiry: z.boolean().default(false),
  requires_issuer: z.boolean().default(false),
  is_training_linkable: z.boolean().default(false),
  sort_order: z.number().int().default(0),
})

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const includeInactive = url.searchParams.get('all') === 'true' && isAdmin(locals.user)

  let query = supabaseAdmin
    .from('document_types')
    .select('id, name, slug, description, requires_expiry, requires_issuer, is_training_linkable, sort_order, is_active')
    .order('sort_order')
    .order('name')

  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)
  return json({ data: data ?? [] })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  // Generate slug from name
  const slug = parsed.data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

  const { data, error } = await supabaseAdmin
    .from('document_types')
    .insert({ ...parsed.data, slug, created_by: locals.user.person_id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return json({ error: 'A document type with this name already exists' }, 409)
    return json({ error: error.message }, 500)
  }

  return json({ data }, 201)
}
