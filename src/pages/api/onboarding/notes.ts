/**
 * POST   /api/onboarding/notes  — add a note to an applicant
 * DELETE /api/onboarding/notes  — remove a note by id
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }

  let body: { person_id?: string; note?: string } = {}
  try { body = await request.json() } catch { /* ok */ }

  if (!body.person_id || !body.note?.trim()) {
    return new Response(JSON.stringify({ error: 'person_id and note are required' }), { status: 422 })
  }

  // Resolve author from session email
  let authorId: string | null = null
  if (locals.user.email) {
    const { data: author } = await supabaseAdmin
      .from('people')
      .select('id')
      .eq('email', locals.user.email)
      .maybeSingle()
    authorId = author?.id ?? null
  }

  const { data: note, error } = await supabaseAdmin
    .from('onboarding_notes')
    .insert({ person_id: body.person_id, author_id: authorId, note: body.note.trim() })
    .select('id, note, created_at, author_id')
    .single()

  if (error) {
    console.error('[POST /api/onboarding/notes] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to save note' }), { status: 500 })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'onboarding_notes',
    targetId: note.id as string,
    afterValue: { person_id: body.person_id, note: body.note },
  })

  return new Response(JSON.stringify({ data: note }), { status: 201 })
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })
  }

  let body: { id?: string } = {}
  try { body = await request.json() } catch { /* ok */ }

  if (!body.id) {
    return new Response(JSON.stringify({ error: 'id is required' }), { status: 422 })
  }

  const { error } = await supabaseAdmin
    .from('onboarding_notes')
    .delete()
    .eq('id', body.id)

  if (error) {
    console.error('[DELETE /api/onboarding/notes] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete note' }), { status: 500 })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'onboarding_notes',
    targetId: body.id,
  })

  return new Response(JSON.stringify({ success: true }), { status: 200 })
}
