import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

const CATEGORIES = ['general', 'welcome', 'award', 'reminder', 'event'] as const

const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional().nullable(),
  subject: z.string().min(1, 'Subject is required').max(300),
  html_body: z.string().min(1, 'HTML body is required'),
  category: z.enum(CATEGORIES).default('general'),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const category = url.searchParams.get('category')
  const includeArchived = url.searchParams.get('archived') === '1'

  let query = supabaseAdmin
    .from('email_templates')
    .select('id, name, description, subject, category, is_active, created_at, updated_at')
    .order('name', { ascending: true })

  if (!includeArchived) query = query.eq('is_active', true)
  if (category) query = query.eq('category', category)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/email-templates] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch templates' }), {
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

  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = CreateTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: template, error } = await supabaseAdmin
    .from('email_templates')
    .insert({ ...parsed.data, created_by: locals.user.person_id })
    .select()
    .single()

  if (error || !template) {
    console.error('[POST /api/email-templates] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create template' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'email_templates',
    targetId: template.id as string,
    afterValue: template as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: template }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
