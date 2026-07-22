import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorised', { status: 401 })

  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear())

  type RawMember = {
    id: string; full_name: string; email: string
    person_types: string[]
  }

  const { data: rawMembers } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, person_types')
    .eq('is_archived', false)
    .eq('status', 'active')
    .order('full_name')

  let members = (rawMembers ?? []) as RawMember[]
  // Exclude volunteers
  members = members.filter(m => !m.person_types.every(t => t === 'volunteer'))

  const [{ data: duesData }, { data: subData }] = await Promise.all([
    supabaseAdmin.from('dues').select('person_id, month').eq('year', year),
    supabaseAdmin.from('dues_submissions').select('person_id, month, status').eq('year', year),
  ])

  type DueRecord = { person_id: string; month: number }
  type SubRecord = { person_id: string; month: number; status: string }

  const duesMap = new Map<string, Set<number>>()
  for (const d of (duesData ?? []) as DueRecord[]) {
    if (!duesMap.has(d.person_id)) duesMap.set(d.person_id, new Set())
    duesMap.get(d.person_id)!.add(d.month)
  }

  const subMap = new Map<string, Map<number, string>>()
  for (const s of (subData ?? []) as SubRecord[]) {
    if (!subMap.has(s.person_id)) subMap.set(s.person_id, new Map())
    subMap.get(s.person_id)!.set(s.month, s.status)
  }

  const monthHeaders = MONTH_NAMES.map((m, i) => `${m}`)
  const headers = ['Name', 'Email', ...monthHeaders, 'Paid Count', 'Pending Count']

  const rows = members.map(m => {
    const paid = duesMap.get(m.id) ?? new Set<number>()
    const subs = subMap.get(m.id) ?? new Map<number, string>()
    let paidCount = 0
    let pendingCount = 0
    const monthCells = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      if (paid.has(month)) { paidCount++; return 'Paid' }
      const s = subs.get(month)
      if (s === 'pending') { pendingCount++; return 'Pending' }
      if (s === 'rejected') return 'Rejected'
      return ''
    })
    return [m.full_name, m.email, ...monthCells, String(paidCount), String(pendingCount)]
  })

  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')

  const filename = `dues-${year}-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
