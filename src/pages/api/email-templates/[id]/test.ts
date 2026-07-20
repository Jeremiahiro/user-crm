import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail } from '@/lib/gmail'
import { isAdmin } from '@/lib/rbac'

const TestSchema = z.object({
  to: z.string().email('Valid email required'),
})

function applyVariables(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params
  const { data: template } = await supabaseAdmin
    .from('email_templates').select('subject, html_body').eq('id', id ?? '').single()

  if (!template) {
    return new Response(JSON.stringify({ error: 'Template not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = TestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const vars: Record<string, string> = {
    full_name: 'John Smith',
    first_name: 'John',
    last_name: 'Smith',
    year: String(new Date().getFullYear()),
    award_type: 'Member of the Year',
    citation: 'For outstanding service to the chapter.',
  }

  const html = applyVariables(template.html_body as string, vars)
  const subject = `[TEST] ${applyVariables(template.subject as string, vars)}`

  const result = await sendEmail({ to: parsed.data.to, subject, html })

  if (!result.success) {
    return new Response(JSON.stringify({ error: result.error ?? 'Failed to send test email' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
