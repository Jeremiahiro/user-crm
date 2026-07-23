/**
 * GET  /api/onboarding/:id  — Fetch full onboarding status for an applicant
 * POST /api/onboarding/:id  — Toggle a checklist item (complete or uncomplete)
 *
 * Checklist items are grouped by stage:
 *   in_progress:  interview | documentation | reference_check
 *   in_training:  safeguarding | mentoring_100_way | dbs_check
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { writeAuditLog } from '@/lib/audit'

const CHECKLIST_ITEMS = {
  interview:         { stage: 'in_progress', label: 'Interview' },
  documentation:     { stage: 'in_progress', label: 'Documentation submitted' },
  reference_check:   { stage: 'in_progress', label: 'Reference check' },
  safeguarding:      { stage: 'in_training', label: 'Safeguarding' },
  mentoring_100_way: { stage: 'in_training', label: 'Mentoring the 100 WAY' },
  dbs_check:         { stage: 'in_training', label: 'DBS Check' },
} as const

export type ChecklistItemKey = keyof typeof CHECKLIST_ITEMS

// ─── GET ─────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }

  const { id } = params

  const [
    { data: person },
    { data: checklistItems },
    { data: timeline },
    { data: dues },
    { data: teams },
  ] = await Promise.all([
    supabaseAdmin
      .from('people')
      .select('id, full_name, email, status, applied_at, date_joined, phone, address, date_of_birth, cancellation_type, cancellation_reason')
      .eq('id', id ?? '')
      .single(),
    supabaseAdmin
      .from('onboarding_checklist_items')
      .select('item_key, stage, completed_at, completed_by_id')
      .eq('person_id', id ?? ''),
    supabaseAdmin
      .from('onboarding_timeline')
      .select('id, event_type, from_stage, to_stage, item_key, item_label, completed, note, author_id, created_at')
      .eq('person_id', id ?? '')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('dues')
      .select('id')
      .eq('person_id', id ?? '')
      .eq('year', new Date().getFullYear())
      .not('paid_at', 'is', null)
      .limit(1),
    supabaseAdmin
      .from('person_teams')
      .select('team_id')
      .eq('person_id', id ?? '')
      .limit(1),
  ])

  if (!person) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }

  // Build a keyed map of completed items for easy lookup
  const completedMap: Record<string, { completed_at: string; completed_by_id: string | null }> = {}
  for (const item of checklistItems ?? []) {
    if (item.completed_at) {
      completedMap[item.item_key] = { completed_at: item.completed_at, completed_by_id: item.completed_by_id }
    }
  }

  const profileComplete = !!(person.full_name && person.email && person.phone && person.address && person.date_of_birth)

  const derived = {
    profile_complete: profileComplete,
    dues_paid: (dues?.length ?? 0) > 0,
    team_assigned: (teams?.length ?? 0) > 0,
  }

  return new Response(
    JSON.stringify({ data: { person, checklistItems: completedMap, timeline, derived, CHECKLIST_ITEMS } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

// ─── POST ─────────────────────────────────────────────────────────────────────

const UpdateSchema = z.object({
  item_key:  z.enum(Object.keys(CHECKLIST_ITEMS) as [ChecklistItemKey, ...ChecklistItemKey[]]),
  completed: z.boolean(),
  note:      z.string().optional(),
})

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Admins only' }), { status: 403 })
  }

  const { id } = params

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422 },
    )
  }

  const { item_key, completed, note } = parsed.data
  const itemMeta = CHECKLIST_ITEMS[item_key]
  const authorId = locals.user.person_id
  const now = new Date().toISOString()

  // Upsert the checklist item state
  const { error: upsertError } = await supabaseAdmin
    .from('onboarding_checklist_items')
    .upsert(
      {
        person_id:       id,
        item_key,
        stage:           itemMeta.stage,
        completed_at:    completed ? now : null,
        completed_by_id: completed ? authorId : null,
        note:            note ?? null,
        updated_at:      now,
      },
      { onConflict: 'person_id,item_key' },
    )

  if (upsertError) {
    console.error('[POST /api/onboarding/:id] checklist upsert error:', upsertError)
    return new Response(JSON.stringify({ error: 'Failed to update checklist' }), { status: 500 })
  }

  // Write timeline event
  await supabaseAdmin.from('onboarding_timeline').insert({
    person_id:  id,
    event_type: 'checklist',
    item_key,
    item_label: itemMeta.label,
    completed,
    note:       note ?? null,
    author_id:  authorId,
    created_at: now,
  })

  await writeAuditLog({
    actorId:     authorId,
    action:      'update',
    targetTable: 'onboarding_checklist_items',
    targetId:    id ?? '',
    afterValue:  { item_key, completed },
  })

  return new Response(
    JSON.stringify({ success: true, item_key, completed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
