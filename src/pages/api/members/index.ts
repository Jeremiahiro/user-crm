import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreateMemberSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  middle_name: z.string().max(100).optional(),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address'),
  email_secondary: z.string().email('Invalid secondary email').optional().nullable(),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  person_types: z.array(z.enum(['member', 'mentor', 'volunteer', 'alumni', 'parent', 'trustee'])).default(['member']),
  status: z.enum(['applicant', 'pending_review', 'approved', 'active', 'suspended', 'inactive', 'alumni', 'left']).default('applicant'),
  source: z.enum(['google_form', 'manual']).optional(),
  date_joined: z.string().optional(),
  notes: z.string().optional(),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const status = url.searchParams.get('status')
  const teamId = url.searchParams.get('team_id')
  const search = url.searchParams.get('q')

  let query = supabaseAdmin
    .from('people')
    .select('id, full_name, email, phone, status, person_types, profile_photo_url, date_joined, is_archived, person_teams(team_id, is_team_lead, teams(name))')
    .eq('is_archived', false)
    .order('full_name')

  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
    if (statuses.length === 1) {
      query = query.eq('status', statuses[0])
    } else if (statuses.length > 1) {
      query = query.in('status', statuses)
    }
  }
  if (search) query = query.ilike('full_name', `%${search}%`)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/members] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch members' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Client-side filter by team (Supabase embedded filter on join is complex)
  const filtered = teamId
    ? (data ?? []).filter((p) => {
        const pt = p.person_teams as { team_id: string }[]
        return pt?.some((t) => t.team_id === teamId)
      })
    : (data ?? [])

  return new Response(JSON.stringify({ data: filtered }), {
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

  const parsed = CreateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: member, error } = await supabaseAdmin
    .from('people')
    .insert({ ...parsed.data, source: parsed.data.source ?? 'manual' })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/members] DB error:', error)
    const isDupe = error.code === '23505'
    return new Response(
      JSON.stringify({ error: isDupe ? 'A member with this email already exists.' : 'Failed to create member' }),
      { status: isDupe ? 409 : 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'people',
    targetId: member.id as string,
    afterValue: member as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: member }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
