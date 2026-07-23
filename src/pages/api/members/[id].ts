import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin, getTeamMemberIds } from '@/lib/rbac'

// Fields a member may edit on their own profile (no sensitive admin-only fields)
const SelfUpdateFields = new Set([
  'first_name', 'middle_name', 'last_name',
  'phone', 'email_secondary', 'address', 'gender',
])

const UpdateMemberSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  middle_name: z.string().max(100).optional().nullable(),
  last_name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  email_secondary: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  person_types: z.array(z.enum(['member', 'mentor', 'volunteer', 'parent', 'trustee'])).optional(),
  status: z.enum(['applicant', 'pending_review', 'active', 'suspended', 'inactive']).optional(),
  date_joined: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetId = params.id ?? ''
  const admin = isAdmin(locals.user)
  const ownRecord = locals.user.person_id === targetId

  if (!admin && !ownRecord) {
    // Allow team leads to view members on their teams
    const teamMemberIds = await getTeamMemberIds(locals.user.person_id)
    if (!teamMemberIds.has(targetId)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const { data, error } = await supabaseAdmin
    .from('people')
    .select(`
      *,
      person_teams(
        is_team_lead,
        joined_at,
        teams(id, name, pillars(name))
      ),
      user_roles(
        assigned_at,
        roles(id, name, description)
      ),
      elected_position_tenures(
        id,
        term_start,
        term_end,
        elected_by,
        elected_positions(title)
      ),
      dbs_records(id, certificate_reference, clearance_date, expiry_date, created_at),
      dues(id, year, month, paid_at)
    `)
    .eq('id', targetId)
    .single()

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetId = params.id ?? ''
  const admin = isAdmin(locals.user)
  const ownRecord = locals.user.person_id === targetId

  if (!admin && !ownRecord) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Non-admins editing their own profile: strip sensitive admin-only fields
  let updateData: typeof parsed.data = parsed.data
  if (!admin && ownRecord) {
    updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) => SelfUpdateFields.has(key))
    ) as typeof parsed.data
  }

  const { data: before } = await supabaseAdmin.from('people').select('*').eq('id', targetId).single()

  const { data: member, error } = await supabaseAdmin
    .from('people')
    .update(updateData)
    .eq('id', targetId)
    .select()
    .single()

  if (error || !member) {
    console.error('[PUT /api/members/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update member' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'people',
    targetId: targetId,
    beforeValue: before as Record<string, unknown>,
    afterValue: member as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: member }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, request, locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = params.id ?? ''
  const action = url.searchParams.get('action') // 'permanent' for hard delete

  // ── Hard delete (Super Admin only) ──────────────────────────────────────────
  if (action === 'permanent') {
    const isSuperAdmin = locals.user.roles?.includes('Super Admin') ?? false
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: 'Only Super Admins can permanently delete members.' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: before } = await supabaseAdmin.from('people').select('*').eq('id', personId).single()
    if (!before) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Audit first (before data is gone)
    await writeAuditLog({
      actorId: locals.user.person_id,
      action: 'delete',
      targetTable: 'people',
      targetId: personId,
      beforeValue: before as Record<string, unknown>,
    })

    // 1. Nullify actor/reference columns (keep the records, just lose the link)
    await Promise.all([
      supabaseAdmin.from('audit_log').update({ actor_id: null }).eq('actor_id', personId),
      supabaseAdmin.from('awards').update({ awarded_by: null }).eq('awarded_by', personId),
      supabaseAdmin.from('praise').update({ given_by: null }).eq('given_by', personId),
      supabaseAdmin.from('cmp_attendance').update({ recorded_by: null }).eq('recorded_by', personId),
      supabaseAdmin.from('mentees').update({ mentor_id: null }).eq('mentor_id', personId),
      supabaseAdmin.from('elected_position_tenures').update({ created_by: null }).eq('created_by', personId),
      supabaseAdmin.from('dbs_records').update({ recorded_by: null }).eq('recorded_by', personId),
      supabaseAdmin.from('dues').update({ set_by: null }).eq('set_by', personId),
    ])

    // 2. Delete owned records (non-cascade tables)
    await Promise.all([
      supabaseAdmin.from('elected_position_tenures').delete().eq('person_id', personId),
      supabaseAdmin.from('documents').delete().eq('person_id', personId),
      supabaseAdmin.from('awards').delete().eq('person_id', personId),
      supabaseAdmin.from('praise').delete().eq('recipient_id', personId),
      supabaseAdmin.from('participation_events').delete().eq('person_id', personId),
      supabaseAdmin.from('cmp_attendance').delete().eq('person_id', personId),
      supabaseAdmin.from('comms_log').delete().eq('person_id', personId),
    ])

    // 3. Delete the person — cascade handles person_teams, user_roles, dues, dbs_records, onboarding_records
    const { error } = await supabaseAdmin.from('people').delete().eq('id', personId)
    if (error) {
      console.error('[DELETE /api/members/:id?action=permanent] DB error:', error)
      return new Response(JSON.stringify({ error: `Failed to delete member: ${error.message}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Soft archive (default) — admin only ────────────────────────────────────
  if (!isAdmin(locals.user)) {
    return new Response(JSON.stringify({ error: 'Only admins can archive members.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { count: activeTenures } = await supabaseAdmin
    .from('elected_position_tenures')
    .select('*', { count: 'exact', head: true })
    .eq('person_id', personId)
    .is('term_end', null)

  if (activeTenures && activeTenures > 0) {
    return new Response(
      JSON.stringify({ error: 'Cannot archive: this member holds an active elected position. End their tenure first.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin.from('people').select('*').eq('id', personId).single()

  const { data: member, error } = await supabaseAdmin
    .from('people')
    .update({ is_archived: true })
    .eq('id', personId)
    .select()
    .single()

  if (error || !member) {
    console.error('[DELETE /api/members/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to archive member' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'archive',
    targetTable: 'people',
    targetId: member.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: member as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: member }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
