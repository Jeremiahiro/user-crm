/**
 * POST /api/email/send
 *
 * Generic single-recipient email send. Used by the compose page.
 * Writes an audit log entry for every send.
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { sendEmail, sendEmailBulk } from '@/lib/gmail'
import { writeAuditLog } from '@/lib/audit'

const SendSchema = z.object({
  // Accept a single email or an array
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1).max(500),
  html: z.string().min(1),
  personId: z.string().uuid().optional(),
})

export const POST: APIRoute = async ({ request, locals }) => {
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

  const parsed = SendSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { to, subject, html, personId } = parsed.data
  const recipients = Array.isArray(to) ? to : [to]

  // Send individually so each recipient gets a separate email (no address leakage)
  let failures: { to: string; error?: string }[] = []
  let successes: { to: string; messageId?: string }[] = []

  if (recipients.length === 1) {
    const result = await sendEmail({ to: recipients[0], subject, html })
    if (result.success) {
      successes = [{ to: recipients[0], messageId: result.messageId }]
    } else {
      failures = [{ to: recipients[0], error: result.error }]
    }
  } else {
    const results = await sendEmailBulk(recipients.map(addr => ({ to: addr, subject, html })))
    for (const r of results) {
      if (r.success) successes.push({ to: r.to, messageId: (r as any).messageId })
      else failures.push({ to: r.to, error: r.error })
    }
  }

  if (successes.length === 0) {
    // All failed
    const firstError = failures[0]?.error ?? 'Unknown error'
    console.error('[email/send] All sends failed:', failures)
    return new Response(
      JSON.stringify({ error: firstError, failures }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // At least some succeeded — audit log and respond
  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'email_send',
    targetId: personId ?? null,  // only store UUID; email addresses go in afterValue
    afterValue: { to: recipients, subject, sent: successes.length, failed: failures.length },
  })

  return new Response(JSON.stringify({
    success: true,
    sent: successes.length,
    failed: failures.length,
    failures: failures.length > 0 ? failures : undefined,
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
