import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

// POST /api/members/:id/login-access — toggle login_enabled
// Body: { enabled: boolean }
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Only super admins and admins can change login access
  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (typeof body.enabled !== 'boolean') {
    return new Response(JSON.stringify({ error: '`enabled` must be a boolean' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error } = await supabaseAdmin
    .from('people')
    .update({ login_enabled: body.enabled })
    .eq('id', id)

  if (error) {
    console.error('[login-access] update error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update login access' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'people',
    targetId: id,
    afterValue: { login_enabled: body.enabled },
  })

  return new Response(JSON.stringify({ data: { login_enabled: body.enabled } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
