import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: before } = await supabaseAdmin
    .from('praise').select('*').eq('id', params.id ?? '').single()

  if (!before) {
    return new Response(JSON.stringify({ error: 'Praise not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Soft archive
  const { data: updated, error } = await supabaseAdmin
    .from('praise')
    .update({ is_archived: true })
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !updated) {
    console.error('[DELETE /api/praise/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to archive praise' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'archive',
    targetTable: 'praise',
    targetId: params.id ?? '',
    beforeValue: before as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: updated }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
