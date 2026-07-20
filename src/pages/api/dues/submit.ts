import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin } from '@/lib/rbac'
import { notifyMultiple } from '@/lib/notify'

const Schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

// POST — member submits a dues payment claim
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user
  if (!user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Admins use the direct dues entry.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { year, month } = parsed.data

  // Check not already confirmed paid
  const { data: alreadyPaid } = await supabaseAdmin
    .from('dues')
    .select('id')
    .eq('person_id', user.person_id)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()

  if (alreadyPaid) {
    return new Response(JSON.stringify({ error: 'This month is already marked as paid.' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Upsert: allow re-submission if previously rejected
  const { data: submission, error } = await supabaseAdmin
    .from('dues_submissions')
    .upsert({
      person_id: user.person_id,
      year,
      month,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      reviewed_by: null,
      reviewed_at: null,
    }, { onConflict: 'person_id,year,month' })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/dues/submit]', error)
    return new Response(JSON.stringify({ error: 'Failed to submit.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Notify all admins
  const ADMIN_ROLES = ['Super Admin', 'Admin', 'Chapter Leadership']
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

  const { data: memberData } = await supabaseAdmin
    .from('people')
    .select('full_name')
    .eq('id', user.person_id)
    .single()

  const { data: adminPeople } = await supabaseAdmin
    .from('people')
    .select('id, person_roles(roles(name))')
    .eq('is_archived', false)
    .in('status', ['active', 'approved'])

  type PersonWithRoles = { id: string; person_roles: { roles: { name: string } | null }[] }
  const adminIds = ((adminPeople ?? []) as PersonWithRoles[])
    .filter(p => p.person_roles?.some(pr => pr.roles && ADMIN_ROLES.includes(pr.roles.name)))
    .map(p => p.id)
    .filter(id => id !== user.person_id)

  if (adminIds.length > 0) {
    const monthName = MONTH_NAMES[month - 1]
    const memberName = (memberData as { full_name: string } | null)?.full_name ?? 'A member'
    await notifyMultiple(adminIds, {
      type: 'dues_submitted',
      title: `💰 Dues submission — ${memberName}`,
      body: `${memberName} submitted ${monthName} ${year} dues for approval.`,
      link: '/admin/dues',
    })
  }

  return new Response(JSON.stringify({ data: submission }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

// DELETE — member retracts a pending submission
export const DELETE: APIRoute = async ({ request, locals }) => {
  const user = locals.user
  if (!user?.person_id) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Validation failed' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { year, month } = parsed.data

  const { error } = await supabaseAdmin
    .from('dues_submissions')
    .delete()
    .eq('person_id', user.person_id)
    .eq('year', year)
    .eq('month', month)
    .eq('status', 'pending') // only retract pending ones

  if (error) {
    console.error('[DELETE /api/dues/submit]', error)
    return new Response(JSON.stringify({ error: 'Failed to retract.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
