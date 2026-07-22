import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { createNotification, notifyMultiple } from '@/lib/notify'
import { sendEmail } from '@/lib/gmail'

const CreatePraiseSchema = z.object({
  // Accept either the new multi-recipient format or legacy single-recipient for backwards compat
  recipient_ids: z.array(z.string().uuid()).min(1, 'At least one recipient is required').optional(),
  recipient_id: z.string().uuid().optional(),
  message: z.string().min(1, 'Message is required').max(1000),
}).refine(d => d.recipient_ids?.length || d.recipient_id, {
  message: 'At least one recipient is required',
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const recipientId = url.searchParams.get('recipient_id')

  let query = supabaseAdmin
    .from('praise')
    .select('*, people!praise_recipient_id_fkey(id, full_name), people!praise_given_by_fkey(id, full_name)')
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (recipientId) query = query.eq('recipient_id', recipientId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/praise] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch praise' }), {
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

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = CreatePraiseSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Resolve the list of recipient IDs (multi or legacy single)
  const recipientIds: string[] = parsed.data.recipient_ids?.length
    ? parsed.data.recipient_ids
    : [parsed.data.recipient_id as string]

  const message = parsed.data.message
  const senderName = locals.user.name ?? 'A chapter member'
  const giverId = locals.user.person_id

  // Insert one praise record per recipient
  const inserts = recipientIds.map(rid => ({
    recipient_id: rid,
    message,
    visibility: 'public',
    given_by: giverId,
  }))

  const { data: praiseRecords, error } = await supabaseAdmin
    .from('praise')
    .insert(inserts)
    .select()

  if (error) {
    console.error('[POST /api/praise] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to give praise' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  for (const praiseRecord of (praiseRecords ?? [])) {
    await writeAuditLog({
      actorId: giverId,
      action: 'create',
      targetTable: 'praise',
      targetId: praiseRecord.id as string,
      afterValue: praiseRecord as Record<string, unknown>,
    })
  }

  // Fetch all recipients + all active members for broadcast
  const [{ data: recipients }, { data: allMembers }] = await Promise.all([
    supabaseAdmin.from('people').select('id, full_name, email').in('id', recipientIds),
    supabaseAdmin.from('people').select('id').eq('status', 'active').eq('is_archived', false),
  ])

  const recs = (recipients ?? []) as { id: string; full_name: string; email: string | null }[]
  const allMemberIds = ((allMembers ?? []) as { id: string }[]).map(m => m.id)

  // Names for the broadcast title
  const recipientNames = recs.map(r => r.full_name)
  const broadcastTitle = recipientNames.length === 1
    ? recipientNames[0] + ' received praise! ⭐'
    : recipientNames.slice(0, -1).join(', ') + ' & ' + recipientNames[recipientNames.length - 1] + ' received praise! ⭐'

  // 1. In-app notification to each recipient
  for (const rec of recs) {
    await createNotification({
      recipientId: rec.id,
      type: 'praise_received',
      title: 'You received praise! ⭐',
      body: senderName + ': ' + message.substring(0, 80),
      link: '/admin/praise',
    })
  }

  // 2. Broadcast to all other active members (exclude giver + all recipients)
  const excludeIds = new Set([giverId, ...recipientIds])
  const broadcastIds = allMemberIds.filter(id => !excludeIds.has(id))
  if (broadcastIds.length > 0) {
    await notifyMultiple(broadcastIds, {
      type: 'praise_broadcast',
      title: broadcastTitle,
      body: senderName + ': ' + message.substring(0, 80),
      link: '/admin/praise',
    })
  }

  // 3. Email each recipient (best-effort)
  for (const rec of recs) {
    if (!rec.email) continue
    const emailHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>'
      + '<body style="margin:0;padding:0;background:#f4f6fa;font-family:\'Segoe UI\',Arial,sans-serif;">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:32px 0;"><tr><td align="center">'
      + '<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">'
      + '<tr><td style="background:#0a1a3b;padding:32px 40px;text-align:center;">'
      + '<p style="color:#c9a227;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 8px;">100 Black Men of London</p>'
      + '<h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0;">You\'ve received praise ⭐</h1></td></tr>'
      + '<tr><td style="padding:40px 40px 32px;">'
      + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 20px;">Dear <strong>' + rec.full_name + '</strong>,</p>'
      + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 28px;"><strong>' + senderName + '</strong> has recognised your contribution:</p>'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ed;border-left:4px solid #c9a227;border-radius:0 8px 8px 0;margin-bottom:28px;">'
      + '<tr><td style="padding:20px 24px;">'
      + '<p style="color:#374151;font-size:15px;line-height:1.7;margin:0;font-style:italic;">"' + message + '"</p>'
      + '</td></tr></table>'
      + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0 0 20px;">Thank you for everything you do for our community.</p>'
      + '<p style="color:#374151;font-size:16px;line-height:1.7;margin:0;">Warm regards,<br/><strong>The 100 Black Men of London Team</strong></p>'
      + '</td></tr>'
      + '<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">'
      + '<p style="color:#9ca3af;font-size:12px;margin:0;">100 Black Men of London &middot; Member Portal</p></td></tr>'
      + '</table></td></tr></table></body></html>'

    await sendEmail({
      to: rec.email,
      subject: 'You\'ve been recognised by ' + senderName + ' | 100 Black Men of London',
      html: emailHtml,
    }).catch(err => console.error('[praise] Email failed for ' + rec.email + ':', err))
  }

  return new Response(JSON.stringify({ data: praiseRecords }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
