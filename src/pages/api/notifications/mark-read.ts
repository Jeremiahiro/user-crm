import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let id: string | null = null
  try {
    const body = await request.json() as { id?: string }
    id = body.id ?? null
  } catch { /* no body = mark all */ }

  let query = supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', locals.user.person_id)
    .eq('is_read', false)

  // If a specific notification ID is provided, scope to just that one
  if (id) query = query.eq('id', id)

  await query

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
