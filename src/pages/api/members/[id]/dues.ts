import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { createNotification } from '@/lib/notify'

const CreateDuesSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
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

  const parsed = CreateDuesSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: due, error } = await supabaseAdmin
    .from('dues')
    .insert({
      person_id: params.id,
      year: parsed.data.year,
      month: parsed.data.month,
      paid_at: new Date().toISOString(),
      recorded_by: locals.user.person_id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/members/:id/dues] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to record dues' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'dues',
    targetId: due.id as string,
    afterValue: due as Record<string, unknown>,
  })

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const monthName = MONTH_NAMES[parsed.data.month - 1]
  await createNotification({
    recipientId: params.id as string,
    type: 'dues_approved',
    title: `✅ ${monthName} ${parsed.data.year} dues confirmed`,
    body: 'An admin has recorded your dues payment.',
    link: '/dues',
  })

  return new Response(JSON.stringify({ data: due }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
