import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

const UpdateDbsSchema = z.object({
  certificate_reference: z.string().optional().nullable(),
  clearance_date: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  drive_url: z.string().url().optional().nullable().or(z.literal('')),
})

// PUT /api/dbs/:id — update a DBS record
export const PUT: APIRoute = async ({ params, request, locals }) => {
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
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdateDbsSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Re-compute expiry_date if clearance_date changed and no explicit expiry given
  let expiryDate = parsed.data.expiry_date ?? undefined
  if (!expiryDate && parsed.data.clearance_date) {
    const { data: setting } = await supabaseAdmin
      .from('org_settings')
      .select('value')
      .eq('key', 'dbs_validity_years')
      .single()
    const validityYears = parseInt(setting?.value ?? '3')
    const d = new Date(parsed.data.clearance_date)
    d.setFullYear(d.getFullYear() + validityYears)
    expiryDate = d.toISOString().slice(0, 10)
  }

  const updatePayload: Record<string, unknown> = {
    certificate_reference: parsed.data.certificate_reference ?? null,
    clearance_date: parsed.data.clearance_date ?? null,
    drive_url: parsed.data.drive_url || null,
  }
  if (expiryDate !== undefined) updatePayload.expiry_date = expiryDate

  const { data: record, error } = await supabaseAdmin
    .from('dbs_records')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[PUT /api/dbs/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update DBS record' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'dbs_records',
    targetId: id,
    afterValue: updatePayload,
  })

  return new Response(JSON.stringify({ data: record }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// DELETE /api/dbs/:id — delete a DBS record (Admin only)
export const DELETE: APIRoute = async ({ params, locals }) => {
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
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch before deleting for audit log
  const { data: existing } = await supabaseAdmin
    .from('dbs_records')
    .select('*')
    .eq('id', id)
    .single()

  const { error } = await supabaseAdmin.from('dbs_records').delete().eq('id', id)

  if (error) {
    console.error('[DELETE /api/dbs/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete DBS record' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'dbs_records',
    targetId: id,
    beforeValue: existing as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
