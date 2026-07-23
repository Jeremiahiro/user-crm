import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'

const VALID_TYPES = ['member', 'mentor', 'volunteer', 'parent', 'trustee']

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorised', { status: 401 })

  const typeParam    = url.searchParams.get('type') ?? ''
  const statusFilter = url.searchParams.get('status') ?? ''
  const searchQ      = url.searchParams.get('q') ?? ''
  const teamFilter   = url.searchParams.get('team_id') ?? ''
  const typeFilter   = VALID_TYPES.includes(typeParam) ? typeParam : ''

  type MemberRow = {
    id: string
    full_name: string
    email: string
    status: string
    person_types: string[]
    date_joined: string | null
    phone: string | null
    person_teams: { is_team_lead: boolean; teams: { name: string } | null }[]
    user_roles: { roles: { name: string } | null }[]
  }

  // Resolve team filter to person IDs
  let teamPersonIds: string[] | null = null
  if (teamFilter) {
    const { data: ptRows } = await supabaseAdmin
      .from('person_teams')
      .select('person_id')
      .eq('team_id', teamFilter)
    teamPersonIds = (ptRows ?? []).map(r => r.person_id as string)
  }

  let query = supabaseAdmin
    .from('people')
    .select('id, full_name, email, status, person_types, date_joined, phone, person_teams(is_team_lead, teams(name)), user_roles!user_roles_person_id_fkey(roles(name))')
    .eq('is_archived', false)
    .order('full_name')

  if (typeFilter)    query = query.contains('person_types', [typeFilter])
  if (statusFilter)  query = query.eq('status', statusFilter)
  if (searchQ)       query = query.ilike('full_name', `%${searchQ}%`)
  if (teamPersonIds) query = query.in('id', teamPersonIds.length > 0 ? teamPersonIds : ['00000000-0000-0000-0000-000000000000'])

  const { data: rawMembers, error: queryError } = await query
  if (queryError) {
    console.error('[GET /admin/members/export] Supabase error:', queryError)
    return new Response(JSON.stringify({ error: queryError.message }), { status: 500 })
  }
  const members = (rawMembers ?? []) as unknown as MemberRow[]

  function fmtDate(iso: string | null) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-GB')
  }

  const rows = members.map(m => {
    const teams = m.person_teams
      .filter(pt => pt.teams)
      .map(pt => `${pt.teams!.name}${pt.is_team_lead ? ' (Lead)' : ''}`)
      .join('; ')
    const roles = m.user_roles
      .filter(pr => pr.roles)
      .map(pr => pr.roles!.name)
      .join('; ')
    return [
      m.full_name,
      m.email,
      m.phone ?? '',
      m.status,
      (m.person_types ?? []).join('; '),
      fmtDate(m.date_joined),
      teams,
      roles,
    ]
  })

  const headers = ['Name', 'Email', 'Phone', 'Status', 'Types', 'Date Joined', 'Teams', 'Roles']
  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')

  const typePart   = typeFilter   ? `-${typeFilter}s`   : ''
  const statusPart = statusFilter ? `-${statusFilter}`  : ''
  const filename   = `members${typePart}${statusPart}-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
