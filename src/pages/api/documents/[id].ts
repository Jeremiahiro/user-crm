/**
 * GET    /api/documents/:id  — get single doc + fresh signed URL (admin/lead/owner)
 * PUT    /api/documents/:id  — update title or review status (admin/lead review)
 * DELETE /api/documents/:id  — hard delete doc + storage file (admin only)
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamMemberIds } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

const BUCKET = 'member-documents'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ReviewSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['approved', 'rejected', 'pending']).optional(),
  review_notes: z.string().max(1000).optional().nullable(),
  /** Admin only — reassign which person this document belongs to */
  person_id: z.string().uuid().optional(),
})

async function canAccess(user: any, doc: { person_id: string }) {
  if (isAdmin(user)) return true
  if (user.person_id === doc.person_id) return true
  const ids = await getTeamMemberIds(user.person_id)
  return ids.has(doc.person_id)
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const { data: doc, error } = await supabaseAdmin
    .from('documents')
    .select(`*, document_types(id, name, slug, requires_expiry, requires_issuer), reviewer:people!reviewed_by(full_name), training:trainings(id, title)`)
    .eq('id', params.id ?? '')
    .single()

  if (error || !doc) return json({ error: 'Not found' }, 404)
  if (!(await canAccess(locals.user, doc as { person_id: string }))) return json({ error: 'Forbidden' }, 403)

  // Generate a fresh signed URL (1 hour) for viewing
  const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl((doc as any).storage_path, 60 * 60)
  return json({ data: { ...doc, view_url: signed?.signedUrl ?? null } })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const { data: doc } = await supabaseAdmin.from('documents').select('*').eq('id', params.id ?? '').single()
  if (!doc) return json({ error: 'Not found' }, 404)

  // Only admin or team lead of the member can review/edit
  if (!isAdmin(locals.user)) {
    const ids = await getTeamMemberIds(locals.user.person_id)
    if (!ids.has((doc as any).person_id)) return json({ error: 'Forbidden' }, 403)
  }

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const parsed = ReviewSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  const updates: Record<string, unknown> = {}
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.person_id !== undefined) {
    if (!isAdmin(locals.user)) return json({ error: 'Only admins can reassign documents' }, 403)
    updates.person_id = parsed.data.person_id
  }
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status
    updates.reviewed_by = locals.user.person_id
    updates.reviewed_at = new Date().toISOString()
    updates.review_notes = parsed.data.review_notes ?? null
  }

  const { data: updated, error } = await supabaseAdmin
    .from('documents').update(updates).eq('id', params.id ?? '').select().single()
  if (error || !updated) return json({ error: 'Failed to update' }, 500)

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'documents',
    targetId: params.id ?? '',
    beforeValue: doc as Record<string, unknown>,
    afterValue: updates,
  })

  const personId = (doc as any).person_id as string
  const docTitle = (doc as any).title as string

  // If status changed: notify member + handle training completion
  if (parsed.data.status === 'approved') {
    await createNotification({
      recipientId: personId,
      type: 'document_approved',
      title: 'Document approved',
      body: `Your document "${docTitle}" has been approved.`,
      link: '/admin/documents',
    })

    // Auto-complete linked training if set
    const trainingId = (doc as any).training_id as string | null
    if (trainingId) {
      await supabaseAdmin
        .from('training_completions')
        .upsert(
          { training_id: trainingId, person_id: personId, method: 'document', document_id: params.id, completed_at: new Date().toISOString() },
          { onConflict: 'training_id,person_id' }
        )
    }
  }

  if (parsed.data.status === 'rejected') {
    // Unwind training completion if this document was its proof
    await supabaseAdmin
      .from('training_completions')
      .delete()
      .eq('person_id', personId)
      .eq('document_id', params.id ?? '')

    await createNotification({
      recipientId: personId,
      type: 'document_rejected',
      title: 'Document needs attention',
      body: `Your document "${docTitle}" was not accepted. ${parsed.data.review_notes ? 'Note: ' + parsed.data.review_notes : 'Please re-upload.'}`,
      link: '/admin/documents',
    })
  }

  return json({ data: updated })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)
  if (!isAdmin(locals.user)) return json({ error: 'Forbidden' }, 403)

  const { data: doc } = await supabaseAdmin.from('documents').select('*').eq('id', params.id ?? '').single()
  if (!doc) return json({ error: 'Not found' }, 404)

  // Remove from storage
  const storagePath = (doc as any).storage_path as string
  await supabaseAdmin.storage.from(BUCKET).remove([storagePath])

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'delete',
    targetTable: 'documents',
    targetId: params.id ?? '',
    beforeValue: doc as Record<string, unknown>,
  })

  const { error } = await supabaseAdmin.from('documents').delete().eq('id', params.id ?? '')
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
