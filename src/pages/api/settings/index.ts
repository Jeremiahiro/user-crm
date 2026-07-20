/**
 * GET  /api/settings  — returns all org_settings as { key: value } map
 * POST /api/settings  — upserts a single setting (Super Admin only)
 *
 * Body (POST): { key: string, value: string }
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const UpdateSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string().min(1, 'Value is required'),
})

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const { data, error } = await supabaseAdmin
    .from('org_settings')
    .select('key, value')
    .order('key')

  if (error) {
    console.error('[GET /api/settings] DB error:', error)
    return json({ error: 'Failed to fetch settings' }, 500)
  }

  const map = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  return json({ data: map })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  // Super Admin only
  const isSuperAdmin = locals.user.roles?.includes('Super Admin') ?? false
  if (!isSuperAdmin) return json({ error: 'Forbidden — Super Admin only' }, 403)

  let body: unknown
  try { body = await request.json() } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)
  }

  const { key, value } = parsed.data

  const { data: record, error } = await supabaseAdmin
    .from('org_settings')
    .upsert(
      { key, value, updated_by: locals.user.person_id, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    .select()
    .single()

  if (error) {
    console.error('[POST /api/settings] DB error:', error)
    return json({ error: 'Failed to update setting' }, 500)
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'org_settings',
    targetId: key,
    afterValue: record as Record<string, unknown>,
  })

  return json({ data: record })
}
