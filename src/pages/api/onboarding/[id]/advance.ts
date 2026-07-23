/**
 * POST /api/onboarding/:id/advance
 *
 * Moves an applicant through the onboarding pipeline:
 *   Forward:   applicant → in_progress → in_training → active
 *   Back:      in_progress → applicant, in_training → in_progress
 *   Cancel:    any pre-active status → cancelled (with type + reason)
 *   Reinstate: cancelled → applicant
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { sendEmail } from '@/lib/gmail'
import { memberStatusEmail } from '@/lib/email-templates'
import { writeAuditLog } from '@/lib/audit'

const FORWARD: Record<string, string> = {
  applicant:   'in_progress',
  in_progress: 'in_training',
  in_training: 'active',
}

const BACKWARD: Record<string, string> = {
  in_progress: 'applicant',
  in_training: 'in_progress',
}

const STAGE_LABELS: Record<string, string> = {
  applicant:   'Applicant',
  in_progress: 'In Progress',
  in_training: 'In Training',
  active:      'Activated',
  cancelled:   'Cancelled',
}

const CANCELLATION_TYPES = ['opted_out', 'training_incomplete', 'eligibility', 'no_response', 'other'] as const

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Admins only' }), { status: 403 })
  }

  const { id } = params

  let body: {
    direction?:          string
    send_email?:         boolean
    reason?:             string
    cancellation_type?:  string
    notes?:              string
  } = {}
  try { body = await request.json() } catch { /* use defaults */ }

  const direction  = body.direction ?? 'forward'
  const send_email = body.send_email !== false

  const { data: person } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, status')
    .eq('id', id ?? '')
    .eq('is_archived', false)
    .single()

  if (!person) {
    return new Response(JSON.stringify({ error: 'Person not found' }), { status: 404 })
  }

  const currentStatus = person.status as string
  let nextStatus: string

  if (direction === 'cancel') {
    if (currentStatus === 'active') {
      return new Response(JSON.stringify({ error: 'Cannot cancel an active member via onboarding.' }), { status: 422 })
    }
    nextStatus = 'cancelled'
  } else if (direction === 'reinstate') {
    if (currentStatus !== 'cancelled') {
      return new Response(JSON.stringify({ error: 'Only cancelled applications can be reinstated.' }), { status: 422 })
    }
    nextStatus = 'applicant'
  } else if (direction === 'back') {
    const prev = BACKWARD[currentStatus]
    if (!prev) {
      return new Response(JSON.stringify({ error: `Cannot move back from "${currentStatus}".` }), { status: 422 })
    }
    nextStatus = prev
  } else {
    const next = FORWARD[currentStatus]
    if (!next) {
      return new Response(JSON.stringify({ error: `Cannot advance from "${currentStatus}".` }), { status: 422 })
    }
    nextStatus = next

    // Gate: all current-stage checklist items must be complete before advancing
    const CHECKLIST_GATES: Record<string, string[]> = {
      in_progress: ['interview', 'documentation', 'reference_check'],
      in_training: ['safeguarding', 'mentoring_100_way', 'dbs_check'],
    }
    const required = CHECKLIST_GATES[currentStatus]
    if (required) {
      const { data: done } = await supabaseAdmin
        .from('onboarding_checklist_items')
        .select('item_key')
        .eq('person_id', id ?? '')
        .in('item_key', required)
        .not('completed_at', 'is', null)

      const completedKeys = new Set((done ?? []).map((r: any) => r.item_key))
      const missing = required.filter(k => !completedKeys.has(k))
      if (missing.length > 0) {
        const labels: Record<string, string> = {
          interview:         'Interview',
          documentation:     'Documentation submitted',
          reference_check:   'Reference check',
          safeguarding:      'Safeguarding',
          mentoring_100_way: 'Mentoring the 100 WAY',
          dbs_check:         'DBS Check',
        }
        return new Response(JSON.stringify({
          error: `Complete all checklist items first: ${missing.map(k => labels[k] ?? k).join(', ')}`,
        }), { status: 422 })
      }
    }
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = { status: nextStatus }

  if (nextStatus === 'active') {
    updatePayload.date_joined   = new Date().toISOString().slice(0, 10)
    updatePayload.person_types  = ['member']
  }

  if (nextStatus === 'cancelled') {
    if (body.reason) updatePayload.cancellation_reason = body.reason
    if (body.cancellation_type && (CANCELLATION_TYPES as readonly string[]).includes(body.cancellation_type)) {
      updatePayload.cancellation_type = body.cancellation_type
    }
  }

  if (nextStatus === 'applicant' && currentStatus === 'cancelled') {
    // Reinstatement — clear cancellation fields
    updatePayload.cancellation_reason = null
    updatePayload.cancellation_type   = null
  }

  const { error: updateError } = await supabaseAdmin
    .from('people')
    .update(updatePayload)
    .eq('id', id ?? '')

  if (updateError) {
    console.error('[advance] update error:', updateError)
    return new Response(JSON.stringify({ error: 'Failed to update status' }), { status: 500 })
  }

  // Write timeline event
  const authorId = locals.user.person_id
  const now      = new Date().toISOString()

  await supabaseAdmin.from('onboarding_timeline').insert({
    person_id:  id,
    event_type: 'stage_change',
    from_stage: currentStatus,
    to_stage:   nextStatus,
    note:       body.reason ?? body.notes ?? null,
    author_id:  authorId,
    created_at: now,
  })

  // Email notification
  let emailSent = false
  if (
    send_email &&
    direction === 'forward' &&
    person.email &&
    (nextStatus === 'active' || nextStatus === 'in_progress' || nextStatus === 'in_training')
  ) {
    try {
      const template = memberStatusEmail({
        fullName:  person.full_name as string,
        newStatus: nextStatus as 'in_progress' | 'in_training' | 'active',
        portalUrl: url.origin,
      })
      const result = await sendEmail({
        to:      person.email as string,
        subject: template.subject,
        html:    template.html,
      })
      emailSent = result.success
    } catch { /* non-fatal */ }
  }

  await writeAuditLog({
    actorId:     authorId,
    action:      'update',
    targetTable: 'people',
    targetId:    id ?? '',
    beforeValue: { status: currentStatus },
    afterValue:  { status: nextStatus, direction, email_sent: emailSent },
  })

  return new Response(
    JSON.stringify({
      success:        true,
      previousStatus: currentStatus,
      newStatus:      nextStatus,
      label:          STAGE_LABELS[nextStatus] ?? nextStatus,
      emailSent,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
