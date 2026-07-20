import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreateDbsSchema = z.object({
  person_id: z.string().uuid('Member is required'),
  certificate_reference: z.string().optional(),
  clearance_date: z.string().optional(),
  expiry_date: z.string().optional(),
  drive_url: z.string().url().optional().or(z.literal('')),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Optionally filter by person_id
  const personId = url.searchParams.get('person_id')

  let query = supabaseAdmin
    .from('dbs_records')
    .select('*, people(id, full_name)')
    .order('created_at', { ascending: false })

  if (personId) query = query.eq('person_id', personId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/dbs] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch DBS records' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, locals }) => {
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

  const parsed = CreateDbsSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Compute expiry_date if not provided but clearance_date is present
  let expiryDate = parsed.data.expiry_date || null
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

  const { data: record, error } = await supabaseAdmin
    .from('dbs_records')
    .insert({
      person_id: parsed.data.person_id,
      certificate_reference: parsed.data.certificate_reference || null,
      clearance_date: parsed.data.clearance_date || null,
      expiry_date: expiryDate,
      drive_url: parsed.data.drive_url || null,
      recorded_by: locals.user.person_id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/dbs] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create DBS record' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'dbs_records',
    targetId: record.id as string,
    afterValue: record as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: record }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
