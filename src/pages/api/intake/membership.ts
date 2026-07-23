import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const IntakeSchema = z.object({
  // Core identity — accept either full_name (Google Form) or first/last directly
  full_name:          z.string().min(1).optional(), // Google Form sends this; we split it
  first_name:         z.string().min(1).optional(),
  middle_name:        z.string().optional(),
  last_name:          z.string().optional(),
  email:              z.string().email(),

  // Contact
  phone:              z.string().optional(),
  email_secondary:    z.string().email().optional(),
  address:            z.string().optional(),
  date_of_birth:      z.string().optional(), // YYYY-MM-DD

  // Professional
  profession:         z.string().optional(),
  employer:           z.string().optional(),

  // Socials
  linkedin_url:       z.string().url().optional(),
  twitter_url:        z.string().url().optional(),
  instagram_url:      z.string().url().optional(),
  facebook_url:       z.string().url().optional(),

  // Interest form responses — multi-select, stored as comma-joined string
  pillar_interest:    z.union([z.string(), z.array(z.string())]).optional().transform(v =>
    Array.isArray(v) ? v.join(', ') : v
  ),
  committee_interest: z.union([z.string(), z.array(z.string())]).optional().transform(v =>
    Array.isArray(v) ? v.join(', ') : v
  ),
  why_join:           z.string().optional(),
  skills_qualities:   z.string().optional(),
  referral_source:    z.string().optional(),

  // Consent
  dbs_consent:        z.boolean().optional(),
  dues_consent:       z.boolean().optional(),

  // Controls
  send_welcome:       z.boolean().default(true),
})

export const POST: APIRoute = async ({ request }) => {
  // Authenticate via shared secret
  const secret = request.headers.get('x-intake-secret')
  if (!secret || secret !== import.meta.env.INTAKE_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = IntakeSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { send_welcome, full_name, ...rest } = parsed.data

  // Resolve first/last name — Google Forms send full_name; split it if needed
  let first_name = rest.first_name
  let last_name = rest.last_name
  if (!first_name && full_name) {
    const parts = full_name.trim().split(/\s+/)
    first_name = parts[0] ?? ''
    last_name = parts.length > 1 ? parts.slice(1).join(' ') : ''
  }
  if (!first_name) {
    return new Response(JSON.stringify({ error: 'first_name (or full_name) is required' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const fields = { ...rest, first_name, last_name: last_name ?? '' }

  // Check if a record already exists for this email
  const { data: existing } = await supabaseAdmin
    .from('people')
    .select('id, status, full_name')
    .eq('email', fields.email)
    .single()

  let personId: string
  let created: boolean

  if (existing) {
    // Update existing record — preserve status, merge new fields
    const { error } = await supabaseAdmin
      .from('people')
      .update({
        ...fields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) {
      console.error('[intake/membership] update error:', error)
      return new Response(JSON.stringify({ error: 'Failed to update record' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    personId = existing.id
    created = false

    await writeAuditLog({
      actorId: null,
      action: 'update',
      targetTable: 'people',
      targetId: personId,
      afterValue: fields as Record<string, unknown>,
    })
  } else {
    // Create new applicant record
    const { data: newPerson, error } = await supabaseAdmin
      .from('people')
      .insert({
        ...fields,
        status: 'applicant',
        source: 'google_form',
        person_types: [],
        intake_status: 'in_progress',
        applied_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !newPerson) {
      console.error('[intake/membership] insert error:', error)
      return new Response(JSON.stringify({ error: 'Failed to create record' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    personId = newPerson.id
    created = true

    await writeAuditLog({
      actorId: null,
      action: 'create',
      targetTable: 'people',
      targetId: personId,
      afterValue: { ...fields, status: 'applicant', source: 'google_form' },
    })
  }

  // TODO: send_welcome email when welcome email template exists

  return new Response(JSON.stringify({
    data: {
      id: personId,
      status: existing?.status ?? 'applicant',
      created,
    },
  }), {
    status: created ? 201 : 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
