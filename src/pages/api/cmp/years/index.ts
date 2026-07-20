import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreateYearSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('cmp_programme_years')
    .select('*, cmp_sessions(id)')
    .order('start_date', { ascending: false })

  if (error) {
    console.error('[GET /api/cmp/years] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch programme years' }), {
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

  const parsed = CreateYearSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: year, error } = await supabaseAdmin
    .from('cmp_programme_years')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/cmp/years] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create programme year' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'cmp_programme_years',
    targetId: year.id as string,
    afterValue: year as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: year }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
