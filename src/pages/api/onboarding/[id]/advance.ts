/**
 * POST /api/onboarding/:id/advance
 *
 * Moves a member through the onboarding pipeline in any direction:
 *   Forward:   applicant → pending_review → approved → active
 *   Back:      pending_review → applicant, approved → pending_review
 *   Cancel:    any pre-active status → cancelled (stores reason in notes)
 *   Reinstate: cancelled → applicant
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail } from '@/lib/gmail'
import { memberStatusEmail } from '@/lib/email-templates'
import { writeAuditLog } from '@/lib/audit'

const FORWARD: Record<string, string> = {
  applicant:      'pending_review',
  pending_review: 'approved',
  approved:       'active',
}

const BACKWARD: Record<string, string> = {
  pending_review: 'applicant',
  approved:       'pending_review',
}

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }

  const { id } = params

  let body: {
    direction?: string  // 'forward' (default) | 'back' | 'cancel' | 'reinstate'
    send_email?: boolean
    reason?: string
    notes?: string
  } = {}
  try { body = await request.json() } catch { /* ok — use defaults */ }

  const direction = body.direction ?? 'forward'
  const send_email = body.send_email !== false

  const { data: person } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, status')
    .eq('id', id ?? '')
    .eq('is_archived', false)
    .single()

  if (!person) {
    return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404 })
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
  }

  const updatePayload: Record<string, unknown> = { status: nextStatus }
  if (nextStatus === 'active') {
    updatePayload.date_joined = new Date().toISOString().slice(0, 10)
  }
  if (nextStatus === 'cancelled' && body.reason) {
    updatePayload.notes = body.reason
  }

  const { error: updateError } = await supabaseAdmin
    .from('people')
    .update(updatePayload)
    .eq('id', id ?? '')

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Failed to update member status' }), { status: 500 })
  }

  if (nextStatus === 'active') {
    await supabaseAdmin
      .from('onboarding_checklists')
      .upsert({ person_id: id, completed_at: new Date().toISOString() }, { onConflict: 'person_id' })
  }

  if (body.notes) {
    await supabaseAdmin
      .from('onboarding_checklists')
      .upsert({ person_id: id, notes: body.notes }, { onConflict: 'person_id' })
  }

  let emailSent = false
  if (send_email && direction === 'forward' && person.email && (nextStatus === 'approved' || nextStatus === 'active')) {
    try {
      const template = memberStatusEmail({
        fullName: person.full_name as string,
        newStatus: nextStatus as 'approved' | 'active',
        portalUrl: url.origin,
      })
      const result = await sendEmail({ to: person.email as string, subject: template.subject, html: template.html })
      emailSent = result.success
    } catch { /* non-fatal */ }
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'people',
    targetId: id ?? '',
    beforeValue: { status: currentStatus },
    afterValue: { status: nextStatus, direction, email_sent: emailSent },
  })

  return new Response(
    JSON.stringify({ success: true, previousStatus: currentStatus, newStatus: nextStatus, emailSent }),
    { status: 200 }
  )
}
