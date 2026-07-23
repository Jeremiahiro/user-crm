import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const CreateCommitteeSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
})

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const { data, error } = await supabaseAdmin
    .from('committees')
    .select('*, person_committees(person_id)')
    .order('name')

  if (error) {
    console.error('[GET /api/committees] DB error:', error)
    return json({ error: 'Failed to fetch committees' }, 500)
  }

  return json({ data }, 200)
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Admins only' }, 403)

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const parsed = CreateCommitteeSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const { data: committee, error } = await supabaseAdmin
    .from('committees')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    console.error('[POST /api/committees] DB error:', error)
    return json({ error: 'Failed to create committee' }, 500)
  }

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'create',
    targetTable: 'committees',
    targetId:    committee.id as string,
    afterValue:  committee as Record<string, unknown>,
  })

  return json({ data: committee }, 201)
}
