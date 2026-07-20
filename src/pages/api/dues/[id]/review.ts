import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

const Schema = z.object({
  action: z.enum(['approve', 'reject']),
})

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user
  if (!user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch the submission
  const { data: submission, error: fetchError } = await supabaseAdmin
    .from('dues_submissions')
    .select('id, person_id, year, month, status')
    .eq('id', id ?? '')
    .maybeSingle()

  if (fetchError || !submission) {
    return new Response(JSON.stringify({ error: 'Submission not found.' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  type Submission = { id: string; person_id: string; year: number; month: number; status: string }
  const sub = submission as Submission

  if (sub.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'Submission is no longer pending.' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { action } = parsed.data
  const monthName = MONTH_NAMES[(sub.month - 1)]

  if (action === 'approve') {
    // Insert confirmed dues row
    const { error: duesError } = await supabaseAdmin
      .from('dues')
      .upsert({
        person_id: sub.person_id,
        year: sub.year,
        month: sub.month,
        paid_at: new Date().toISOString(),
        recorded_by: user.person_id,
      }, { onConflict: 'person_id,year,month' })

    if (duesError) {
      console.error('[dues review approve] dues insert error:', duesError)
      return new Response(JSON.stringify({ error: 'Failed to record payment.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Notify member
    await createNotification({
      recipientId: sub.person_id,
      type: 'dues_approved',
      title: `✅ ${monthName} ${sub.year} dues approved`,
      body: 'Your dues payment has been confirmed.',
      link: '/dues',
    })
  } else {
    // Notify member of rejection
    await createNotification({
      recipientId: sub.person_id,
      type: 'dues_rejected',
      title: `❌ ${monthName} ${sub.year} dues not approved`,
      body: 'Your dues submission was not approved. Please contact an admin if you believe this is an error.',
      link: '/dues',
    })
  }

  // Update submission status
  const { error: updateError } = await supabaseAdmin
    .from('dues_submissions')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_by: user.person_id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', sub.id)

  if (updateError) {
    console.error('[dues review] update error:', updateError)
  }

  await writeAuditLog({
    actorId: user.person_id,
    action: 'update',
    targetTable: 'dues_submissions',
    targetId: sub.id,
    afterValue: { status: action === 'approve' ? 'approved' : 'rejected' },
  })

  return new Response(JSON.stringify({ ok: true, action }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
