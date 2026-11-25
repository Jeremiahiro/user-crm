import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { requireAdmin } from '@/lib/http'
import { isAdmin } from '@/lib/rbac'
import { assignOfficeHolder } from '@/lib/offices'

const AssignTenureSchema = z.object({
  person_id: z.string().uuid('Member is required'),
  term_start: z.string().min(1, 'Term start date is required'),
  elected_by: z.enum(['chapter_vote', 'board_appointment', 'co_option']),
  notes: z.string().optional(),
})

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user || !isAdmin(locals.user)) return requireAdmin(locals.user)!

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = AssignTenureSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const result = await assignOfficeHolder({
    positionId: params.id ?? '',
    personId: parsed.data.person_id,
    termStart: parsed.data.term_start,
    electedBy: parsed.data.elected_by,
    notes: parsed.data.notes ?? null,
    actorId: locals.user.person_id,
  })

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data: result.tenure }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user || !isAdmin(locals.user)) return requireAdmin(locals.user)!

  const tenureId = url.searchParams.get('tenure_id')
  if (!tenureId) {
    return new Response(JSON.stringify({ error: 'tenure_id query parameter is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: tenure, error: fetchErr } = await supabaseAdmin
    .from('elected_position_tenures')
    .select('id, person_id, position_id')
    .eq('id', tenureId)
    .single()

  if (fetchErr || !tenure) {
    return new Response(JSON.stringify({ error: 'Tenure not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error: deleteErr } = await supabaseAdmin
    .from('elected_position_tenures')
    .delete()
    .eq('id', tenureId)

  if (deleteErr) {
    console.error('[DELETE /api/positions/:id/assign] DB error:', deleteErr)
    return new Response(JSON.stringify({ error: 'Failed to delete tenure' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'tenure_delete',
    targetTable: 'elected_position_tenures',
    targetId: tenureId,
    beforeValue: tenure as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
