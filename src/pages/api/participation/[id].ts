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
    .from('participation_events').select('*').eq('id', params.id ?? '').single()

  if (!before) {
    return new Response(JSON.stringify({ error: 'Event not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('participation_events')
    .update({ is_archived: true })
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !updated) {
    console.error('[DELETE /api/participation/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to archive event' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'archive',
    targetTable: 'participation_events',
    targetId: params.id ?? '',
    beforeValue: before as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: updated }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
