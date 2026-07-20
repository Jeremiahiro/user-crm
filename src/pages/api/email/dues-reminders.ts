/**
 * POST /api/email/dues-reminders
 *
 * Send dues reminder emails to all active members who have not paid
 * dues for the current year.
 *
 * Body: { year?: number }  (default current year)
 *
 * Returns a summary of sent / failed counts.
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmailBulk } from '@/lib/gmail'
import { duesReminderEmail } from '@/lib/email-templates'
import { writeAuditLog } from '@/lib/audit'

const Schema = z.object({
  year: z.number().int().min(2020).max(2100).optional(),
  dry_run: z.boolean().default(false),
})

export const POST: APIRoute = async ({ request, locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json().catch(() => ({})) } catch {
    body = {}
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const targetYear = parsed.data.year ?? new Date().getFullYear()
  const { dry_run } = parsed.data

  // Fetch active members
  const { data: members } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email')
    .eq('status', 'active')
    .eq('is_archived', false)

  // Fetch dues records for the target year (members who have paid at least one month)
  const { data: duesRows } = await supabaseAdmin
    .from('dues')
    .select('person_id')
    .eq('year', targetYear)
    .not('paid_at', 'is', null)

  const paidIds = new Set((duesRows ?? []).map(d => d.person_id))
  const unpaidMembers = (members ?? []).filter(m => !paidIds.has(m.id) && m.email)

  const portalUrl = url.origin

  const recipients = unpaidMembers.map(person => {
    const template = duesReminderEmail({
      fullName: person.full_name as string,
      year: targetYear,
      portalUrl,
    })
    return { to: person.email as string, subject: template.subject, html: template.html, name: person.full_name as string }
  })

  if (dry_run) {
    return new Response(
      JSON.stringify({
        dry_run: true,
        targets: recipients.map(r => ({ to: r.to, name: r.name })),
        year: targetYear,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const results = await sendEmailBulk(recipients)
  const sent = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'email_bulk',
    targetId: 'dues_reminders',
    afterValue: { type: 'dues_reminders', year: targetYear, sent, failed, total: recipients.length },
  })

  return new Response(
    JSON.stringify({ success: true, year: targetYear, sent, failed, total: recipients.length, results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
