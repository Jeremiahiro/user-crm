import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!isAdmin(locals.user)) {
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

  // Fetch the assignment
  const { data: assignment } = await supabaseAdmin
    .from('buddy_assignments')
    .select('id, person_id, buddy_id, ended_at')
    .eq('id', id)
    .maybeSingle()

  if (!assignment) {
    return new Response(JSON.stringify({ error: 'Assignment not found.' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  type AssignmentRow = { id: string; person_id: string; buddy_id: string; ended_at: string | null }
  const a = assignment as AssignmentRow

  if (a.ended_at) {
    return new Response(JSON.stringify({ error: 'This pairing has already ended.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // End the pairing
  await supabaseAdmin
    .from('buddy_assignments')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)

  // Fetch names
  const { data: people } = await supabaseAdmin
    .from('people')
    .select('id, full_name')
    .in('id', [a.person_id, a.buddy_id])

  type PersonName = { id: string; full_name: string }
  const peopleMap = new Map(((people ?? []) as PersonName[]).map(p => [p.id, p.full_name]))
  const personName = peopleMap.get(a.person_id) ?? 'Your buddy'
  const buddyName = peopleMap.get(a.buddy_id) ?? 'Your buddy'

  // Notify both
  await createNotification({
    recipientId: a.person_id,
    type: 'buddy_ended',
    title: 'Your buddy pairing has ended.',
    body: `Your pairing with ${buddyName} has ended.`,
    link: '/dashboard',
  })
  await createNotification({
    recipientId: a.buddy_id,
    type: 'buddy_ended',
    title: 'Your buddy pairing has ended.',
    body: `Your pairing with ${personName} has ended.`,
    link: '/dashboard',
  })

  // Audit log
  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'buddy_assignments',
    targetId: id,
    afterValue: { ended_at: new Date().toISOString() },
  })

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
