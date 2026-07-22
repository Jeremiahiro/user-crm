/**
 * POST   /api/onboarding/notes  — add a note to an applicant's timeline
 * DELETE /api/onboarding/notes  — remove a timeline note by id
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
    .from('onboarding_timeline')
    .insert({
      person_id:  body.person_id,
      event_type: 'note',
      note:       body.note.trim(),
      author_id:  authorId,
    })
    .select('id, note, author_id, created_at')
    .single()

  if (error) {
    console.error('[POST /api/onboarding/notes] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to save note' }), { status: 500 })
  }

  await writeAuditLog({
    actorId:     authorId,
    action:      'create',
    targetTable: 'onboarding_timeline',
    targetId:    entry.id as string,
    afterValue:  { person_id: body.person_id, note: body.note },
  })

  return new Response(JSON.stringify({ data: entry }), { status: 201 })
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

  // Only allow deleting note-type events (not system stage_change or checklist events)
  const { data: entry } = await supabaseAdmin
    .from('onboarding_timeline')
    .select('id, event_type, author_id')
    .eq('id', body.id)
    .single()

  if (!entry) {
    return new Response(JSON.stringify({ error: 'Note not found' }), { status: 404 })
  }
  if (entry.event_type !== 'note') {
    return new Response(JSON.stringify({ error: 'Cannot delete system events' }), { status: 422 })
  }

  const { error } = await supabaseAdmin
    .from('onboarding_timeline')
    .delete()
    .eq('id', body.id)

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to delete note' }), { status: 500 })
  }

  await writeAuditLog({
    actorId:     locals.user.person_id,
    action:      'delete',
    targetTable: 'onboarding_timeline',
    targetId:    body.id,
  })

  return new Response(JSON.stringify({ success: true }), { status: 200 })
}
