import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })

  let body: {
    mentee_id?: string
    called_at?: string
    duration_minutes?: number | null
    outcome?: string
    summary?: string | null
  }
  try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const { mentee_id, called_at, duration_minutes, outcome, summary } = body
  if (!mentee_id || !called_at) {
    return new Response(JSON.stringify({ error: 'mentee_id and called_at are required' }), { status: 400 })
  }

  const VALID_OUTCOMES = ['reached', 'no_answer', 'left_voicemail', 'rescheduled']
  if (outcome && !VALID_OUTCOMES.includes(outcome)) {
    return new Response(JSON.stringify({ error: 'Invalid outcome' }), { status: 400 })
  }

  const { data: caller } = await supabaseAdmin
    .from('people').select('id').eq('email', locals.user.email).single()

  const { data, error } = await supabaseAdmin
    .from('cmp_call_logs')
    .insert({
      mentee_id,
      called_at,
      duration_minutes: duration_minutes ?? null,
      outcome: outcome ?? 'reached',
      summary: summary?.trim() ?? null,
      caller_id: caller?.id ?? null,
    })
    .select()
    .single()

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  await writeAuditLog({ action: 'create', table: 'cmp_call_logs', recordId: data.id, actorEmail: locals.user.email, newValues: { mentee_id, called_at, outcome } })
  return new Response(JSON.stringify(data), { status: 201 })
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 })

  let body: { id?: string }
  try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const { id } = body
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 })

  const { error } = await supabaseAdmin.from('cmp_call_logs').delete().eq('id', id)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  await writeAuditLog({ action: 'delete', table: 'cmp_call_logs', recordId: id, actorEmail: locals.user.email })
  return new Response(JSON.stringify({ success: true }))
}
