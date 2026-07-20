/**
 * POST /api/email/dbs-reminders
 *
 * Send DBS expiry reminder emails to all active members whose DBS is
 * expired or expiring within the specified window.
 *
 * Body: { warn_days?: number }  (default 60)
 *
 * Returns a summary of sent / failed / skipped counts.
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmailBulk } from '@/lib/gmail'
import { dbsExpiryWarningEmail, dbsExpiredEmail } from '@/lib/email-templates'
import { classifyDbs } from '@/lib/compliance'
import { writeAuditLog } from '@/lib/audit'

const Schema = z.object({
  // warn_days can be passed explicitly; if omitted we read from org_settings
  warn_days: z.number().int().min(1).max(365).optional(),
  dry_run: z.boolean().default(false), // if true, returns targets without sending
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

  // Resolve warn_days: explicit param takes precedence, otherwise read from org_settings
  let warn_days = parsed.data.warn_days
  if (warn_days === undefined) {
    const { data: setting } = await supabaseAdmin
      .from('org_settings')
      .select('value')
      .eq('key', 'dbs_warn_days')
      .single()
    warn_days = parseInt(setting?.value ?? '60')
  }

  const { dry_run } = parsed.data
  const today = new Date()

  // Fetch all active members with their latest DBS record
  const { data: members } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, dbs_records(expiry_date)')
    .eq('status', 'active')
    .eq('is_archived', false)

  type PersonRow = {
    id: string
    full_name: string
    email: string
    dbs_records: { expiry_date: string | null }[]
  }

  const rows = (members ?? []) as unknown as PersonRow[]
  const uploadBaseUrl = `${url.origin}/upload`

  type Recipient = { to: string; subject: string; html: string; name: string; status: string; expiry: string | null }
  const recipients: Recipient[] = []

  for (const person of rows) {
    if (!person.email) continue

    // Pick the latest DBS record by expiry date
    const latestDbs = person.dbs_records
      .filter(d => d.expiry_date)
      .sort((a, b) => (a.expiry_date! > b.expiry_date! ? -1 : 1))[0]

    const expiryDate = latestDbs?.expiry_date ?? null
    const status = classifyDbs(expiryDate, today, warn_days)

    if (status === 'valid' || status === 'missing') continue

    const expiryFormatted = expiryDate
      ? new Date(expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : ''

    let template: { subject: string; html: string }

    if (status === 'expired') {
      template = dbsExpiredEmail({
        fullName: person.full_name,
        expiryDate: expiryFormatted,
        uploadUrl: `${uploadBaseUrl}`,
      })
    } else {
      const daysLeft = expiryDate
        ? Math.ceil((new Date(expiryDate).getTime() - today.getTime()) / 86_400_000)
        : 0
      template = dbsExpiryWarningEmail({
        fullName: person.full_name,
        expiryDate: expiryFormatted,
        daysUntilExpiry: daysLeft,
        uploadUrl: `${uploadBaseUrl}`,
      })
    }

    recipients.push({
      to: person.email,
      subject: template.subject,
      html: template.html,
      name: person.full_name,
      status,
      expiry: expiryDate,
    })
  }

  if (dry_run) {
    return new Response(
      JSON.stringify({
        dry_run: true,
        targets: recipients.map(r => ({ to: r.to, name: r.name, status: r.status, expiry: r.expiry })),
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
    targetId: 'dbs_reminders',
    afterValue: { type: 'dbs_reminders', warn_days, sent, failed, total: recipients.length },
  })

  return new Response(
    JSON.stringify({ success: true, sent, failed, total: recipients.length, results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
