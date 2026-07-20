import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { createNotification } from '@/lib/notify'
import { writeAuditLog } from '@/lib/audit'

const ChangeSchema = z.object({
  person_id: z.string().uuid(),
  month: z.number().int().min(1).max(12),
  paid: z.boolean(),
  submission_id: z.string().uuid().optional(),
})

const BodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  changes: z.array(ChangeSchema).min(1).max(500),
})

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user
  if (!user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { year, changes } = parsed.data
  const errors: string[] = []
  let applied = 0

  for (const change of changes) {
    const { person_id, month, paid, submission_id } = change
    const monthName = MONTH_NAMES[month - 1]

    if (paid) {
      // Mark as paid: upsert dues record
      const { data: due, error: duesError } = await supabaseAdmin
        .from('dues')
        .upsert({
          person_id,
          year,
          month,
          paid_at: new Date().toISOString(),
          recorded_by: user.person_id,
        }, { onConflict: 'person_id,year,month' })
        .select('id')
        .single()

      if (duesError) {
        errors.push(`Failed to record ${monthName} for ${person_id}: ${duesError.message}`)
        continue
      }

      // If there was a pending submission, approve it
      if (submission_id) {
        await supabaseAdmin
          .from('dues_submissions')
          .update({
            status: 'approved',
            reviewed_by: user.person_id,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', submission_id)
          .eq('status', 'pending')
      }

      // Notify member
      await createNotification({
        recipientId: person_id,
        type: 'dues_approved',
        title: `✅ ${monthName} ${year} dues confirmed`,
        body: 'An admin has recorded your dues payment.',
        link: '/dues',
      })

      if (due?.id) {
        await writeAuditLog({
          actorId: user.person_id,
          action: 'create',
          targetTable: 'dues',
          targetId: due.id as string,
          afterValue: { person_id, year, month, paid_at: new Date().toISOString() },
        })
      }
    } else {
      // Unmark: delete dues record
      const { error: deleteError } = await supabaseAdmin
        .from('dues')
        .delete()
        .eq('person_id', person_id)
        .eq('year', year)
        .eq('month', month)

      if (deleteError) {
        errors.push(`Failed to remove ${monthName} for ${person_id}: ${deleteError.message}`)
        continue
      }

      await writeAuditLog({
        actorId: user.person_id,
        action: 'delete',
        targetTable: 'dues',
        targetId: `${person_id}/${year}/${month}`,
        afterValue: { person_id, year, month, removed: true },
      })
    }

    applied++
  }

  if (errors.length > 0 && applied === 0) {
    return new Response(JSON.stringify({ error: 'All changes failed', errors }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, applied, errors }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
