import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// DELETE = mark month as unpaid (removes the dues record — not a compliance record)
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: due } = await supabaseAdmin
    .from('dues')
    .select('*')
    .eq('id', params.dueId ?? '')
    .eq('person_id', params.id ?? '')
    .single()

  if (!due) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error } = await supabaseAdmin.from('dues').delete().eq('id', params.dueId ?? '')

  if (error) {
    console.error('[DELETE /api/members/:id/dues/:dueId] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to remove dues record' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'dues',
    targetId: params.dueId ?? '',
    beforeValue: due as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: { id: params.dueId } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
