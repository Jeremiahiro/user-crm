import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreatePillarSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  display_order: z.coerce.number().int().optional(),
})

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await supabaseAdmin
    .from('pillars')
    .select('*')
    .order('display_order', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[GET /api/pillars] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch pillars' }), {
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

  const parsed = CreatePillarSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: pillar, error } = await supabaseAdmin
    .from('pillars')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/pillars] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create pillar' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'pillars',
    targetId: pillar.id as string,
    afterValue: pillar as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: pillar }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
