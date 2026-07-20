import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorised', { status: 401 })

  type MemberRow = {
    id: string
    full_name: string
    email: string
    status: string
    person_types: string[]
    date_joined: string | null
    phone: string | null
    person_teams: { is_team_lead: boolean; teams: { name: string } | null }[]
    person_roles: { roles: { name: string } | null }[]
  }

  const { data: rawMembers } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, status, person_types, date_joined, phone, person_teams(is_team_lead, teams(name)), person_roles(roles(name))')
    .eq('is_archived', false)
    .order('full_name')

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
    const roles = m.person_roles
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

  const filename = `members-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
