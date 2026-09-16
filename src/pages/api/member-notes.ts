/**
 * POST   /api/member-notes  — add a note to a member's profile
 * DELETE /api/member-notes  — remove a note by id
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { writeAuditLog } from '@/lib/audit'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Admins only' }), { status: 403 })
  }

  let body: { person_id?: string; note?: string } = {}
  try { body = await request.json() } catch { /* ok */ }

  if (!body.person_id || !body.note?.trim()) {
    return new Response(JSON.stringify({ error: 'person_id and note are required' }), { status: 422 })
  }

  const authorId = locals.user.person_id

  const { data: entry, error } = await supabaseAdmin
    .from('member_notes')
    .insert({
      person_id: body.person_id,
      note:      body.note.trim(),
      author_id: authorId,
    })
    .select('id, note, created_at')
    .single()

  if (error) {
    console.error('[POST /api/member-notes] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to save note' }), { status: 500 })
  }

  // Resolve author name for the optimistic UI update
  const { data: author } = await supabaseAdmin
    .from('people')
    .select('full_name')
    .eq('id', authorId)
    .single()

  await writeAuditLog({
    actorId:     authorId,
    action:      'create',
    targetTable: 'member_notes',
    targetId:    entry.id as string,
    afterValue:  { person_id: body.person_id, note: body.note },
  })

  return new Response(JSON.stringify({
    data: {
      id:          entry.id,
      note:        entry.note,
      author_name: author?.full_name ?? null,
      created_at:  entry.created_at,
    },
  }), { status: 201 })
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Admins only' }), { status: 403 })
  }

  let body: { id?: string } = {}
  try { body = await request.json() } catch { /* ok */ }

  if (!body.id) {
    return new Response(JSON.stringify({ error: 'id is required' }), { status: 422 })
  }

  const { data: entry } = await supabaseAdmin
    .from('member_notes')
    .select('id')
    .eq('id', body.id)
    .single()

  if (!entry) {
    return new Response(JSON.stringify({ error: 'Note not found' }), { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('member_notes')
    .delete()
    .eq('id', body.id)

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to delete note' }), { status: 500 })
  }

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'delete',
    targetTable: 'member_notes',
    targetId:    body.id,
  })

  return new Response(JSON.stringify({ success: true }), { status: 200 })
}
