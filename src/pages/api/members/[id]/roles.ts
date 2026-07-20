import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// POST /api/members/:id/roles — assign a role (Super Admin only)
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const isSuperAdmin = locals.user.roles?.includes('Super Admin') ?? false
  if (!isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Only Super Admins can assign roles.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = z.object({ role_id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const personId = params.id ?? ''
  const { role_id } = parsed.data

  // Verify role exists
  const { data: role } = await supabaseAdmin.from('roles').select('id, name').eq('id', role_id).single()
  if (!role) {
    return new Response(JSON.stringify({ error: 'Role not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Upsert — idempotent if already assigned
  const { error } = await supabaseAdmin
    .from('user_roles')
    .upsert(
      { person_id: personId, role_id, assigned_by: locals.user.person_id, assigned_at: new Date().toISOString() },
      { onConflict: 'person_id,role_id' }
    )

  if (error) {
    console.error('[POST /api/members/:id/roles] DB error:', error)
    return new Response(JSON.stringify({ error: `Failed to assign role: ${error.message}` }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'user_roles',
    targetId: personId,
    afterValue: { person_id: personId, role_id, role_name: role.name },
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

// DELETE /api/members/:id/roles?role_id=... — revoke a role (Super Admin only)
export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const isSuperAdmin = locals.user.roles?.includes('Super Admin') ?? false
  if (!isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Only Super Admins can revoke roles.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = params.id ?? ''
  const roleId = url.searchParams.get('role_id')
  if (!roleId) {
    return new Response(JSON.stringify({ error: 'role_id query param is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: role } = await supabaseAdmin.from('roles').select('name').eq('id', roleId).single()

  const { error } = await supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('person_id', personId)
    .eq('role_id', roleId)

  if (error) {
    console.error('[DELETE /api/members/:id/roles] DB error:', error)
    return new Response(JSON.stringify({ error: `Failed to revoke role: ${error.message}` }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'user_roles',
    targetId: personId,
    beforeValue: { person_id: personId, role_id: roleId, role_name: role?.name },
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
