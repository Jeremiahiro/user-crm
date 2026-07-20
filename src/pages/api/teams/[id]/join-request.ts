import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { createNotification, notifyMultiple } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

// Returns person_ids for all Super Admins + Chapter Leadership
async function getLeadershipIds(): Promise<string[]> {
  const { data: roles } = await supabaseAdmin
    .from('roles')
    .select('id')
    .in('name', ['Super Admin', 'Chapter Leadership'])

  const roleIds = (roles ?? []).map((r: { id: string }) => r.id)
  if (roleIds.length === 0) return []

  const { data: assignments } = await supabaseAdmin
    .from('user_roles')
    .select('person_id')
    .in('role_id', roleIds)

  return [...new Set((assignments ?? []).map((a: { person_id: string }) => a.person_id))]
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const teamId = params.id
  if (!teamId) {
    return new Response(JSON.stringify({ error: 'Missing team id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = locals.user.person_id

  // Parse optional message from body
  let message: string | null = null
  try {
    const body = await request.json() as { message?: string }
    message = body.message ?? null
  } catch { /* no body is fine */ }

  // Fetch team
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('id, name')
    .eq('id', teamId)
    .single()

  if (!team) {
    return new Response(JSON.stringify({ error: 'Team not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check not already a member
  const { data: membership } = await supabaseAdmin
    .from('person_teams')
    .select('id')
    .eq('person_id', personId)
    .eq('team_id', teamId)
    .maybeSingle()

  if (membership) {
    return new Response(JSON.stringify({ error: 'You are already a member of this team.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check no pending request
  const { data: existingRequest } = await supabaseAdmin
    .from('team_join_requests')
    .select('id, status')
    .eq('person_id', personId)
    .eq('team_id', teamId)
    .maybeSingle()

  if (existingRequest) {
    return new Response(JSON.stringify({ error: `You already have a ${existingRequest.status} request for this team.` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Insert request
  const { data: joinRequest, error: insertError } = await supabaseAdmin
    .from('team_join_requests')
    .insert({ person_id: personId, team_id: teamId, message, status: 'pending' })
    .select()
    .single()

  if (insertError) {
    console.error('[POST /api/teams/[id]/join-request] DB error:', insertError)
    return new Response(JSON.stringify({ error: 'Failed to submit request.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch requester name
  const { data: requester } = await supabaseAdmin
    .from('people')
    .select('full_name')
    .eq('id', personId)
    .single()

  const requesterName = (requester as { full_name: string } | null)?.full_name ?? 'A member'

  // Always notify Super Admin + Chapter Leadership, plus any team leads
  const [leadershipIds, teamLeadsData] = await Promise.all([
    getLeadershipIds(),
    supabaseAdmin
      .from('person_teams')
      .select('person_id')
      .eq('team_id', teamId)
      .eq('is_team_lead', true),
  ])

  const teamLeadIds = ((teamLeadsData.data ?? []) as { person_id: string }[]).map(r => r.person_id)
  const recipientIds = [...new Set([...leadershipIds, ...teamLeadIds])]
    .filter(id => id !== personId) // don't notify the requester themselves

  if (recipientIds.length > 0) {
    await notifyMultiple(recipientIds, {
      type: 'team_join_request',
      title: `${requesterName} wants to join ${(team as { name: string }).name}`,
      body: message ?? undefined,
      link: `/admin/teams/${teamId}`,
      data: { request_id: (joinRequest as { id: string }).id, person_id: personId, team_id: teamId },
    })
  }

  return new Response(JSON.stringify({ data: joinRequest }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const teamId = params.id
  if (!teamId) {
    return new Response(JSON.stringify({ error: 'Missing team id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Only admins or team leads can approve/reject
  const adminRoles = ['Super Admin', 'Admin', 'Chapter Leadership']
  const userIsAdmin = locals.user.roles?.some((r: string) => adminRoles.includes(r)) ?? false

  if (!userIsAdmin) {
    // Check if team lead
    const { data: lead } = await supabaseAdmin
      .from('person_teams')
      .select('id')
      .eq('team_id', teamId)
      .eq('person_id', locals.user.person_id)
      .eq('is_team_lead', true)
      .maybeSingle()

    if (!lead) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  let body: { requestId: string; action: 'approve' | 'reject'; reason?: string }
  try {
    body = await request.json() as { requestId: string; action: 'approve' | 'reject'; reason?: string }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { requestId, action, reason } = body
  if (!requestId || !['approve', 'reject'].includes(action)) {
    return new Response(JSON.stringify({ error: 'requestId and action (approve|reject) are required.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (action === 'reject' && !reason?.trim()) {
    return new Response(JSON.stringify({ error: 'A reason is required when rejecting a request.' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch the request
  const { data: joinRequest } = await supabaseAdmin
    .from('team_join_requests')
    .select('*, teams(name)')
    .eq('id', requestId)
    .eq('team_id', teamId)
    .single()

  if (!joinRequest) {
    return new Response(JSON.stringify({ error: 'Request not found.' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  type JoinRequestRow = { id: string; person_id: string; team_id: string; status: string; teams: { name: string } | null }
  const jr = joinRequest as unknown as JoinRequestRow

  // Update status
  await supabaseAdmin
    .from('team_join_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_by: locals.user.person_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  // If approved, add to team
  if (action === 'approve') {
    await supabaseAdmin
      .from('person_teams')
      .insert({ person_id: jr.person_id, team_id: teamId, is_team_lead: false })
  }

  const teamName = jr.teams?.name ?? 'the team'
  const reviewerName = locals.user.name ?? 'An admin'

  // Notify requester
  await createNotification({
    recipientId: jr.person_id,
    type: action === 'approve' ? 'team_join_approved' : 'team_join_rejected',
    title: action === 'approve'
      ? `Your request to join ${teamName} was approved! 🎉`
      : `Your request to join ${teamName} was not approved.`,
    body: action === 'reject' && reason ? reason : undefined,
    link: `/admin/teams/${teamId}`,
  })

  // Notify Super Admin + Chapter Leadership of the decision
  const leadershipIds = await getLeadershipIds()
  const leadershipToNotify = leadershipIds.filter(id => id !== locals.user.person_id)

  if (leadershipToNotify.length > 0) {
    // Fetch requester name for the notification
    const { data: requesterData } = await supabaseAdmin
      .from('people')
      .select('full_name')
      .eq('id', jr.person_id)
      .single()
    const requesterName = (requesterData as { full_name: string } | null)?.full_name ?? 'A member'

    await notifyMultiple(leadershipToNotify, {
      type: action === 'approve' ? 'team_join_approved' : 'team_join_rejected',
      title: action === 'approve'
        ? `${reviewerName} approved ${requesterName}'s request to join ${teamName}`
        : `${reviewerName} declined ${requesterName}'s request to join ${teamName}`,
      body: action === 'reject' && reason ? reason : undefined,
      link: `/admin/teams/${teamId}`,
    })
  }

  // Audit log
  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'team_join_requests',
    targetId: requestId,
    afterValue: { status: action === 'approve' ? 'approved' : 'rejected' },
  })

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
