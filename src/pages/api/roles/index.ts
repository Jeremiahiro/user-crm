import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const MODULES = [
  'members', 'volunteers', 'teams', 'pillars', 'elected_positions',
  'elected_tenures', 'dues', 'dbs_records', 'documents', 'mentees',
  'cmp_years', 'cmp_sessions', 'cmp_attendance', 'awards', 'praise',
  'participation_events', 'roles', 'permissions', 'user_role_assignment',
  'onboarding_pipeline', 'audit_log',
]

const CreateRoleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  permissions: z.array(z.object({
    module: z.string(),
    operation: z.enum(['create', 'read', 'update', 'delete']),
    scope: z.enum(['all', 'own_team', 'own_record']).default('all'),
  })).default([]),
})

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('*, role_permissions(module, operation, scope), user_roles(count)')
    .order('name')

  if (error) {
    console.error('[GET /api/roles] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch roles' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data, modules: MODULES }), {
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

  const parsed = CreateRoleSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: role, error: roleError } = await supabaseAdmin
    .from('roles')
    .insert({ name: parsed.data.name, description: parsed.data.description })
    .select()
    .single()

  if (roleError) {
    console.error('[POST /api/roles] DB error:', roleError)
    return new Response(JSON.stringify({ error: 'Failed to create role' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (parsed.data.permissions.length > 0) {
    await supabaseAdmin.from('role_permissions').insert(
      parsed.data.permissions.map(p => ({ role_id: role.id, ...p }))
    )
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'roles',
    targetId: role.id as string,
    afterValue: role as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: role }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
