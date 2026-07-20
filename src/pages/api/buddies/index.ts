import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

export const POST: APIRoute = async ({ request, locals }) => {
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

  let body: { person_id: string; buddy_id: string; notes?: string }
  try {
    body = await request.json() as { person_id: string; buddy_id: string; notes?: string }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { person_id, buddy_id, notes } = body

  if (!person_id || !buddy_id) {
    return new Response(JSON.stringify({ error: 'person_id and buddy_id are required.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (person_id === buddy_id) {
    return new Response(JSON.stringify({ error: 'A person cannot be their own buddy.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if person already has a buddy assigned to them
  const { data: existingForPerson } = await supabaseAdmin
    .from('buddy_assignments')
    .select('id')
    .eq('person_id', person_id)
    .is('ended_at', null)
    .maybeSingle()

  if (existingForPerson) {
    return new Response(JSON.stringify({ error: 'This member already has an active buddy.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if the selected buddy is already at the limit (max 3 active buddying relationships)
  const MAX_BUDDYING = 3
  const { count: buddyingCount } = await supabaseAdmin
    .from('buddy_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('buddy_id', buddy_id)
    .is('ended_at', null)

  if ((buddyingCount ?? 0) >= MAX_BUDDYING) {
    return new Response(JSON.stringify({ error: `This person is already buddying ${MAX_BUDDYING} members (the maximum).` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch names for notification
  const { data: people } = await supabaseAdmin
    .from('people')
    .select('id, full_name')
    .in('id', [person_id, buddy_id])

  type PersonName = { id: string; full_name: string }
  const peopleMap = new Map(((people ?? []) as PersonName[]).map(p => [p.id, p.full_name]))
  const personName = peopleMap.get(person_id) ?? 'Your buddy'
  const buddyName = peopleMap.get(buddy_id) ?? 'Your buddy'

  // Check for a previously ended assignment with the same pair — re-activate instead of inserting
  const { data: endedAssignment } = await supabaseAdmin
    .from('buddy_assignments')
    .select('id')
    .eq('person_id', person_id)
    .eq('buddy_id', buddy_id)
    .not('ended_at', 'is', null)
    .limit(1)
    .maybeSingle()

  let assignment: { id: string } | null = null
  let assignmentError = null

  if (endedAssignment) {
    const { data: reactivated, error: updateError } = await supabaseAdmin
      .from('buddy_assignments')
      .update({ ended_at: null, assigned_by: locals.user.person_id, notes: notes ?? null, assigned_at: new Date().toISOString() })
      .eq('id', (endedAssignment as { id: string }).id)
      .select()
      .single()
    assignment = reactivated as { id: string } | null
    assignmentError = updateError
  } else {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('buddy_assignments')
      .insert({ person_id, buddy_id, assigned_by: locals.user.person_id, notes: notes ?? null })
      .select()
      .single()
    assignment = inserted as { id: string } | null
    assignmentError = insertError
  }

  if (assignmentError) {
    console.error('[POST /api/buddies] DB error:', assignmentError)
    return new Response(JSON.stringify({ error: 'Failed to create buddy assignment.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Notify both
  await createNotification({
    recipientId: person_id,
    type: 'buddy_assigned',
    title: 'You have been assigned a buddy!',
    body: `${buddyName} is your new buddy.`,
    link: '/dashboard',
  })
  await createNotification({
    recipientId: buddy_id,
    type: 'buddy_assigned',
    title: 'You have been assigned a buddy!',
    body: `${personName} is your new buddy.`,
    link: '/dashboard',
  })

  // Audit log
  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'buddy_assignments',
    targetId: (assignment as { id: string }).id,
    afterValue: assignment as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: assignment }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
