import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { sendEmail } from '@/lib/gmail'
import { createNotification, notifyMultiple } from '@/lib/notify'
import { isAdmin } from '@/lib/rbac'

const AWARD_TYPE_LABELS: Record<string, string> = {
  member_of_the_year:    'Member of the Year',
  volunteer_of_the_year: 'Volunteer of the Year',
  mentor_of_the_year:    'Mentor of the Year',
  rising_star:           'Rising Star',
  community_impact:      'Community Impact',
  leadership_excellence: 'Leadership Excellence',
  special_recognition:   'Special Recognition',
}

const AWARD_TYPES = [
  'member_of_the_year',
  'volunteer_of_the_year',
  'mentor_of_the_year',
  'rising_star',
  'community_impact',
  'leadership_excellence',
  'special_recognition',
] as const

const CreateAwardSchema = z.object({
  person_id: z.string().uuid('Member is required'),
  type: z.enum(AWARD_TYPES, { message: 'Invalid award type' }),
  year: z.number().int().min(2000).max(2100),
  citation: z.string().optional().nullable(),
  awarded_by: z.string().uuid().optional().nullable(),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = url.searchParams.get('person_id')
  const year = url.searchParams.get('year')
  const admin = isAdmin(locals.user)

  let query = supabaseAdmin
    .from('awards')
    .select('*, people!awards_person_id_fkey(id, full_name), people!awards_awarded_by_fkey(id, full_name)')
    .order('year', { ascending: false })
    .order('created_at', { ascending: false })

  // Non-admins can only see their own awards
  if (!admin) {
    if (!locals.user.person_id) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    query = query.eq('person_id', locals.user.person_id)
  } else {
    if (personId) query = query.eq('person_id', personId)
  }
  if (year) query = query.eq('year', parseInt(year))

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/awards] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch awards' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Forbidden — only admins can give awards' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = CreateAwardSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: award, error } = await supabaseAdmin
    .from('awards')
    .insert({ ...parsed.data, awarded_by: parsed.data.awarded_by ?? locals.user.person_id })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/awards] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create award' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'awards',
    targetId: award.id as string,
    afterValue: award as Record<string, unknown>,
  })

  // Send email + in-app notifications
  if (parsed.data.person_id) {
    const [{ data: recipient }, { data: allMembers }] = await Promise.all([
      supabaseAdmin
        .from('people')
        .select('full_name, email')
        .eq('id', parsed.data.person_id)
        .single(),
      supabaseAdmin
        .from('people')
        .select('id')
        .eq('status', 'active')
        .eq('is_archived', false)
        .neq('id', parsed.data.person_id),
    ])

    const rec = recipient as { full_name: string; email: string | null } | null
    const awardLabel = AWARD_TYPE_LABELS[parsed.data.type] ?? parsed.data.type
    const yearStr = String(parsed.data.year)

    // In-app notification to recipient
    await createNotification({
      recipientId: parsed.data.person_id,
      type: 'award_received',
      title: 'You received an award! 🏆',
      body: awardLabel + ' ' + yearStr,
      link: '/admin/awards',
    })

    // Broadcast in-app notification to all other active members
    const otherMemberIds = ((allMembers ?? []) as { id: string }[]).map(m => m.id)
    if (otherMemberIds.length > 0) {
      await notifyMultiple(otherMemberIds, {
        type: 'award_broadcast',
        title: (rec?.full_name ?? 'A member') + ' received an award! 🏆',
        body: awardLabel + ' ' + yearStr,
        link: '/admin/awards',
      })
    }

    // Email notification (best-effort, don't fail the request if email fails)
    if (rec?.email) {
      const citationHtml = parsed.data.citation
        ? '<p style="color:#6b7280;font-size:14px;font-style:italic;margin:12px 0 0;line-height:1.6;">"' + parsed.data.citation + '"</p>'
        : ''

      const emailHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>'
        + '<body style="margin:0;padding:0;background:#f4f6fa;font-family:\'Segoe UI\',Arial,sans-serif;">'
        + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:32px 0;"><tr><td align="center">'
        + '<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">'
        + '<tr><td style="background:#0a1a3b;padding:32px 40px;text-align:center;">'
        + '<p style="color:#c9a227;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 8px;">100 Black Men of London</p>'
        + '<h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0;">You\'ve received an award 🏆</h1></td></tr>'
        + '<tr><td style="padding:40px 40px 32px;">'
        + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 20px;">Dear <strong>' + rec.full_name + '</strong>,</p>'
        + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 28px;">We are delighted to recognise your outstanding contribution. You have been awarded:</p>'
        + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ed;border:2px solid #c9a227;border-radius:10px;margin-bottom:28px;">'
        + '<tr><td style="padding:24px 28px;text-align:center;">'
        + '<p style="color:#c9a227;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 6px;">' + yearStr + '</p>'
        + '<p style="color:#0a1a3b;font-size:22px;font-weight:800;margin:0;">' + awardLabel + '</p>'
        + citationHtml
        + '</td></tr></table>'
        + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 20px;">This recognition reflects the dedication and impact you bring to our community.</p>'
        + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0;">Warm regards,<br/><strong>The 100 Black Men of London Team</strong></p>'
        + '</td></tr>'
        + '<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">'
        + '<p style="color:#9ca3af;font-size:12px;margin:0;">100 Black Men of London &middot; Member Portal</p></td></tr>'
        + '</table></td></tr></table></body></html>'

      await sendEmail({
        to: rec.email,
        subject: 'Congratulations — ' + awardLabel + ' ' + yearStr + ' | 100 Black Men of London',
        html: emailHtml,
      }).catch(err => console.error('[awards] Email failed:', err))
    }
  }

  return new Response(JSON.stringify({ data: award }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
