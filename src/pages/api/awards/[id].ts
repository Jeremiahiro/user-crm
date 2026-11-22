import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { requireAdmin } from '@/lib/http'
import { isAdmin } from '@/lib/rbac'

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user || !isAdmin(locals.user)) return requireAdmin(locals.user)!

  const { data: before } = await supabaseAdmin
    .from('awards').select('*').eq('id', params.id ?? '').single()

  if (!before) {
    return new Response(JSON.stringify({ error: 'Award not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error } = await supabaseAdmin
    .from('awards')
    .delete()
    .eq('id', params.id ?? '')

  if (error) {
    console.error('[DELETE /api/awards/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete award' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'awards',
    targetId: params.id ?? '',
    beforeValue: before as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: { id: params.id } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
