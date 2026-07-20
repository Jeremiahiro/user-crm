import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'

export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return new Response('Unauthorised', { status: 401 })

  const { id } = params
  if (!id) return new Response('Not found', { status: 404 })

  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('name')
    .eq('id', id)
    .single()

  if (!team) return new Response('Not found', { status: 404 })

  type PersonTeamRow = {
    is_team_lead: boolean
    joined_at: string | null
    people: { full_name: string; email: string; status: string; phone: string | null } | null
  }

  const { data: rawRows } = await supabaseAdmin
    .from('person_teams')
    .select('is_team_lead, joined_at, people(full_name, email, status, phone)')
    .eq('team_id', id)
    .order('joined_at', { ascending: true })

  const members = (rawRows ?? []) as unknown as PersonTeamRow[]

  function fmtDate(iso: string | null) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-GB')
  }

  const rows = members
    .filter(m => m.people)
    .map(m => [
      m.people!.full_name,
      m.people!.email,
      m.people!.phone ?? '',
      m.people!.status,
      m.is_team_lead ? 'Team Lead' : 'Member',
      fmtDate(m.joined_at),
    ])

  const headers = ['Name', 'Email', 'Phone', 'Status', 'Role', 'Joined']
  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')

  const teamName = (team as { name: string }).name.toLowerCase().replace(/\s+/g, '-')
  const filename = `team-${teamName}-members-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
