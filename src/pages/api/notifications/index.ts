import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = locals.user.person_id

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('recipient_id', personId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch notifications' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Mark all as read
  await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', personId)
    .eq('is_read', false)

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
