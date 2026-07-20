import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const UpdateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  permissions: z.array(z.object({
    module: z.string(),
    operation: z.enum(['create', 'read', 'update', 'delete']),
    scope: z.enum(['all', 'own_team', 'own_record']).default('all'),
  })).optional(),
})

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: existing } = await supabaseAdmin.from('roles').select('*').eq('id', params.id ?? '').single()
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdateRoleSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const updateData: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description

  const { data: role, error } = await supabaseAdmin
    .from('roles')
    .update(updateData)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !role) {
    console.error('[PUT /api/roles/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update role' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Replace permissions if provided
  if (parsed.data.permissions !== undefined) {
    await supabaseAdmin.from('role_permissions').delete().eq('role_id', params.id ?? '')
    if (parsed.data.permissions.length > 0) {
      await supabaseAdmin.from('role_permissions').insert(
        parsed.data.permissions.map(p => ({ role_id: params.id, ...p }))
      )
    }
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'roles',
    targetId: role.id as string,
    beforeValue: existing as Record<string, unknown>,
    afterValue: role as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: role }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: role } = await supabaseAdmin.from('roles').select('*').eq('id', params.id ?? '').single()
  if (!role) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (role.is_system_protected as boolean) {
    return new Response(
      JSON.stringify({ error: 'Cannot archive system-protected roles.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // If users ever assigned → archive only, not delete
  const { count: assignedCount } = await supabaseAdmin
    .from('user_roles')
    .select('*', { count: 'exact', head: true })
    .eq('role_id', params.id ?? '')

  if (assignedCount && assignedCount > 0) {
    // Archive
    const { data: archived, error } = await supabaseAdmin
      .from('roles')
      .update({ is_archived: true })
      .eq('id', params.id ?? '')
      .select()
      .single()

    if (error || !archived) {
      return new Response(JSON.stringify({ error: 'Failed to archive role' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    await writeAuditLog({
      actorId: locals.user.person_id,
      action: 'archive',
      targetTable: 'roles',
      targetId: params.id ?? '',
      beforeValue: role as Record<string, unknown>,
      afterValue: archived as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ data: archived, action: 'archived' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // No users ever assigned — hard delete is allowed
  const { error } = await supabaseAdmin.from('roles').delete().eq('id', params.id ?? '')
  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to delete role' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'roles',
    targetId: params.id ?? '',
    beforeValue: role as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: { id: params.id }, action: 'deleted' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
