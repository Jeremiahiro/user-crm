import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { requireCmpStaff } from '@/lib/http'
import { canManageCmp } from '@/lib/rbac'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !canManageCmp(locals.user)) return requireCmpStaff(locals.user)!

  let body: { mentee_id?: string; note?: string }
  try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const { mentee_id, note } = body
  if (!mentee_id || !note?.trim()) {
    return new Response(JSON.stringify({ error: 'mentee_id and note are required' }), { status: 400 })
  }

  // Find author person_id from email
  const { data: author } = await supabaseAdmin
    .from('people').select('id').eq('email', locals.user.email).single()

  const { data, error } = await supabaseAdmin
    .from('cmp_mentor_notes')
    .insert({ mentee_id, note: note.trim(), author_id: author?.id ?? null })
    .select()
    .single()

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'cmp_mentor_notes',
    targetId: data.id as string,
    afterValue: { mentee_id, note: note.trim() },
  })
  return new Response(JSON.stringify(data), { status: 201 })
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !canManageCmp(locals.user)) return requireCmpStaff(locals.user)!

  let body: { id?: string }
  try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const { id } = body
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 })

  const { error } = await supabaseAdmin.from('cmp_mentor_notes').delete().eq('id', id)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'cmp_mentor_notes',
    targetId: id,
  })
  return new Response(JSON.stringify({ success: true }))
}
