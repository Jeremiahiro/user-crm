/**
 * POST /api/trainings/:id/complete
 * Self-report completion (only if requires_document = false).
 * Admins can also link an existing document_id to create a document-method completion.
 */
import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const CompleteSchema = z.object({
  document_id: z.string().uuid().optional().nullable(), // admin linking an approved doc
  notes: z.string().max(500).optional().nullable(),
})

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const trainingId = params.id ?? ''
  const { data: training } = await supabaseAdmin
    .from('trainings').select('id, requires_document').eq('id', trainingId).single()
  if (!training) return json({ error: 'Training not found' }, 404)

  let body: unknown
  try { body = await request.json() } catch { body = {} }

  const parsed = CompleteSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422)

  // If training requires a document, self-report is blocked
  if ((training as any).requires_document && !parsed.data.document_id) {
    return json({ error: 'This training requires a document upload to complete.' }, 422)
  }

  const method = parsed.data.document_id ? 'document' : 'self_reported'

  // Upsert — handles re-completion after a rejection gracefully
  const { data, error } = await supabaseAdmin
    .from('training_completions')
    .upsert(
      {
        training_id: trainingId,
        person_id: locals.user.person_id,
        method,
        document_id: parsed.data.document_id ?? null,
        notes: parsed.data.notes ?? null,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'training_id,person_id' }
    )
    .select()
    .single()

  if (error) return json({ error: error.message }, 500)
  return json({ data }, 201)
}
