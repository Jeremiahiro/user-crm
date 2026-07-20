/**
 * POST /api/email/welcome
 *
 * Send a welcome email to a single member by person_id.
 * Looks up their name and email, generates the template, sends.
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail } from '@/lib/gmail'
import { welcomeEmail } from '@/lib/email-templates'
import { writeAuditLog } from '@/lib/audit'

const Schema = z.object({
  person_id: z.string().uuid(),
})

export const POST: APIRoute = async ({ request, locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { person_id } = parsed.data

  const { data: person, error } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email')
    .eq('id', person_id)
    .eq('is_archived', false)
    .single()

  if (error || !person) {
    return new Response(JSON.stringify({ error: 'Member not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const portalUrl = `${url.origin}/dashboard`
  const template = welcomeEmail({
    fullName: person.full_name as string,
    portalUrl,
  })

  const result = await sendEmail({
    to: person.email as string,
    subject: template.subject,
    html: template.html,
  })

  if (!result.success) {
    return new Response(
      JSON.stringify({ error: 'Failed to send email', detail: result.error }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'email_send',
    targetId: person_id,
    afterValue: { type: 'welcome', to: person.email, messageId: result.messageId },
  })

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
