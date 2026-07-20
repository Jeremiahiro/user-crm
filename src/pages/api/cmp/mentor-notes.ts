import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })

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

  await writeAuditLog({ action: 'create', table: 'cmp_mentor_notes', recordId: data.id, actorEmail: locals.user.email, newValues: { mentee_id, note: note.trim() } })
  return new Response(JSON.stringify(data), { status: 201 })
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })

  let body: { id?: string }
  try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const { id } = body
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 })

  const { error } = await supabaseAdmin.from('cmp_mentor_notes').delete().eq('id', id)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  await writeAuditLog({ action: 'delete', table: 'cmp_mentor_notes', recordId: id, actorEmail: locals.user.email })
  return new Response(JSON.stringify({ success: true }))
}
