/**
 * GET  /api/onboarding/:id  — Fetch full onboarding status for a member
 * POST /api/onboarding/:id  — Update a non-derivable checklist milestone
 *
 * The GET response includes both stored milestones and derived checklist items
 * computed from other tables (DBS, dues, documents, team assignment).
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

// ─── GET ─────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params
  const currentYear = new Date().getFullYear()

  // Fetch person + checklist + related data in parallel
  const [
    { data: person },
    { data: checklist },
    { data: dbs },
    { data: dues },
    { data: documents },
    { data: teams },
  ] = await Promise.all([
    supabaseAdmin.from('people').select('id, full_name, email, status, applied_at, date_joined, phone, address, date_of_birth').eq('id', id ?? '').single(),
    supabaseAdmin.from('onboarding_checklists').select('*').eq('person_id', id ?? '').maybeSingle(),
    supabaseAdmin.from('dbs_records').select('id').eq('person_id', id ?? '').eq('is_archived', false).limit(1),
    supabaseAdmin.from('dues').select('id').eq('person_id', id ?? '').eq('year', currentYear).not('paid_at', 'is', null).limit(1),
    supabaseAdmin.from('documents').select('id').eq('person_id', id ?? '').eq('upload_status', 'matched').limit(1),
    supabaseAdmin.from('person_teams').select('team_id').eq('person_id', id ?? '').limit(1),
  ])

  if (!person) {
    return new Response(JSON.stringify({ error: 'Member not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Derived checklist items
  const profileComplete = !!(
    person.full_name && person.email && person.phone && person.address && person.date_of_birth
  )

  const derived = {
    profile_complete: profileComplete,
    dbs_submitted: (dbs?.length ?? 0) > 0,
    dues_paid: (dues?.length ?? 0) > 0,
    document_uploaded: (documents?.length ?? 0) > 0,
    team_assigned: (teams?.length ?? 0) > 0,
  }

  return new Response(JSON.stringify({ data: { person, checklist, derived } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

const MILESTONE_FIELDS = [
  'welcome_sent_at',
  'dbs_completed_at',
  'reference_checked_at',
  'induction_done_at',
  'agreement_signed_at',
] as const

const UpdateSchema = z.object({
  // Pass the field name and true/false to set/clear the timestamp
  field: z.enum(MILESTONE_FIELDS),
  completed: z.boolean(),
  notes: z.string().optional(),
})

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { field, completed, notes } = parsed.data

  // Upsert the checklist row
  const updatePayload: Record<string, unknown> = {
    person_id: id,
    [field]: completed ? new Date().toISOString() : null,
  }
  if (notes !== undefined) updatePayload.notes = notes

  const { data: checklist, error } = await supabaseAdmin
    .from('onboarding_checklists')
    .upsert(updatePayload, { onConflict: 'person_id' })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/onboarding/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update checklist' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'onboarding_checklists',
    targetId: id ?? '',
    afterValue: { field, completed },
  })

  return new Response(JSON.stringify({ data: checklist }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
