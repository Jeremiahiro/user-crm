import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const AssignTenureSchema = z.object({
  person_id: z.string().uuid('Member is required'),
  term_start: z.string().min(1, 'Term start date is required'),
  elected_by: z.enum(['chapter_vote', 'board_appointment', 'co_option']),
  notes: z.string().optional(),
})

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

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

  const positionId = params.id ?? ''

  // Get position to check for linked role
  const { data: position } = await supabaseAdmin
    .from('elected_positions')
    .select('*, linked_system_role_id')
    .eq('id', positionId)
    .single()

  if (!position) {
    return new Response(JSON.stringify({ error: 'Position not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Close existing active tenure (term_end IS NULL) — atomic via two operations
  const { data: existingTenure } = await supabaseAdmin
    .from('elected_position_tenures')
    .select('id, person_id')
    .eq('position_id', positionId)
    .is('term_end', null)
    .single()

  if (existingTenure) {
    const { error: closeError } = await supabaseAdmin
      .from('elected_position_tenures')
      .update({ term_end: parsed.data.term_start })
      .eq('id', existingTenure.id as string)

    if (closeError) {
      console.error('[POST /api/positions/:id/assign] Failed to close existing tenure:', closeError)
      return new Response(JSON.stringify({ error: 'Failed to close existing tenure' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    await writeAuditLog({
      actorId: locals.user.person_id,
      action: 'tenure_end',
      targetTable: 'elected_position_tenures',
      targetId: existingTenure.id as string,
      afterValue: { term_end: parsed.data.term_start },
    })
  }

  // Create new tenure
  const { data: newTenure, error: createError } = await supabaseAdmin
    .from('elected_position_tenures')
    .insert({
      position_id: positionId,
      person_id: parsed.data.person_id,
      term_start: parsed.data.term_start,
      elected_by: parsed.data.elected_by,
      notes: parsed.data.notes ?? null,
      created_by: locals.user.person_id,
    })
    .select()
    .single()

  if (createError || !newTenure) {
    console.error('[POST /api/positions/:id/assign] Failed to create tenure:', createError)
    return new Response(JSON.stringify({ error: 'Failed to create tenure' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'tenure_create',
    targetTable: 'elected_position_tenures',
    targetId: newTenure.id as string,
    afterValue: newTenure as Record<string, unknown>,
  })

  // Auto-grant linked role if position has one
  const linkedRoleId = position.linked_system_role_id as string | null
  if (linkedRoleId) {
    const { error: roleError } = await supabaseAdmin.from('user_roles').insert({
      person_id: parsed.data.person_id,
      role_id: linkedRoleId,
      assigned_by: locals.user.person_id,
    })

    if (roleError && roleError.code !== '23505') {
      // Log but don't fail — role may already exist
      console.error('[POST /api/positions/:id/assign] Role grant warning:', roleError)
    } else {
      await writeAuditLog({
        actorId: locals.user.person_id,
        action: 'role_grant',
        targetTable: 'user_roles',
        targetId: parsed.data.person_id,
        afterValue: { role_id: linkedRoleId, reason: 'elected_position_auto_grant' },
      })
    }
  }

  return new Response(JSON.stringify({ data: newTenure }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

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
