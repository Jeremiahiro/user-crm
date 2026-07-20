import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { createNotification, notifyMultiple } from '@/lib/notify'

export const POST: APIRoute = async ({ request }) => {
  // ── Auth: validate CRON_SECRET ─────────────────────────────────────────────
  const secret = import.meta.env.CRON_SECRET
  const authHeader = request.headers.get('Authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    const now = new Date()
    const month = now.getUTCMonth() + 1 // 1-based
    const day   = now.getUTCDate()

    // ── 1. Find people whose birthday is today ────────────────────────────────
    // date_of_birth is stored as a date (YYYY-MM-DD). We match on month + day
    // using Postgres EXTRACT via a raw filter. Supabase supports this via .filter().
    const { data: birthdayPeople, error: bErr } = await supabaseAdmin
      .from('people')
      .select('id, full_name, first_name')
      .not('date_of_birth', 'is', null)
      .eq('status', 'active')
      .filter('date_of_birth', 'not.is', null)

    if (bErr) {
      console.error('[birthday-notifications] people query error:', bErr)
      return new Response(JSON.stringify({ error: bErr.message }), { status: 500 })
    }

    type PersonRow = { id: string; full_name: string; first_name: string; date_of_birth?: string }

    // Filter in JS — extract month/day from the date_of_birth string (YYYY-MM-DD)
    // Fetching all active people is fine given typical org sizes; avoids raw SQL
    const { data: allPeople } = await supabaseAdmin
      .from('people')
      .select('id, full_name, first_name, date_of_birth, status')
      .eq('status', 'active')
      .not('date_of_birth', 'is', null)

    const todayBirthdays = ((allPeople ?? []) as (PersonRow & { date_of_birth: string; status: string })[])
      .filter(p => {
        const dob = p.date_of_birth
        if (!dob) return false
        const [, mm, dd] = dob.split('-').map(Number)
        return mm === month && dd === day
      })

    if (todayBirthdays.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No birthdays today' }), { status: 200 })
    }

    // ── 2. Fetch all other active people IDs (broadcast recipients) ───────────
    const { data: everyoneData } = await supabaseAdmin
      .from('people')
      .select('id')
      .eq('status', 'active')

    const everyoneIds = new Set(((everyoneData ?? []) as { id: string }[]).map(p => p.id))

    // ── 3. Deduplication: skip people already notified today ──────────────────
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
    const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()

    const { data: alreadySent } = await supabaseAdmin
      .from('notifications')
      .select('recipient_id')
      .eq('type', 'birthday_personal')
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd)

    const alreadyNotified = new Set(((alreadySent ?? []) as { recipient_id: string }[]).map(n => n.recipient_id))

    const toProcess = todayBirthdays.filter(p => !alreadyNotified.has(p.id))

    if (toProcess.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'Already sent today' }), { status: 200 })
    }

    // ── 4. Send notifications ─────────────────────────────────────────────────
    for (const person of toProcess) {
      // Personal notification → birthday person
      await createNotification({
        recipientId: person.id,
        type: 'birthday_personal',
        title: `🎂 Happy Birthday, ${person.first_name}!`,
        body: 'Wishing you a wonderful day from the whole team! 🎉',
      })

      // Broadcast → everyone else
      const broadcastIds = [...everyoneIds].filter(id => id !== person.id)
      if (broadcastIds.length > 0) {
        await notifyMultiple(broadcastIds, {
          type: 'birthday_broadcast',
          title: `🎂 It's ${person.full_name}'s birthday today!`,
          body: 'Send them your wishes 🎉',
        })
      }
    }

    return new Response(JSON.stringify({ sent: toProcess.length }), { status: 200 })
  } catch (err) {
    console.error('[birthday-notifications] unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }
}
