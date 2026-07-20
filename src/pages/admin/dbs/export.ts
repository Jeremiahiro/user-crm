import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { classifyDbs } from '@/lib/compliance'

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorised', { status: 401 })

  const { data: settingsRows } = await supabaseAdmin
    .from('org_settings')
    .select('key, value')
    .in('key', ['dbs_validity_years', 'dbs_warn_days'])

  const warnDays = parseInt(settingsRows?.find(s => s.key === 'dbs_warn_days')?.value ?? '60')
  const validityYears = parseInt(settingsRows?.find(s => s.key === 'dbs_validity_years')?.value ?? '3')

  type DbsRecordRow = { expiry_date: string | null; clearance_date: string | null; created_at: string }
  type PersonRow = { id: string; full_name: string; email: string; dbs_records: DbsRecordRow[] }

  const { data: rawMembers } = await supabaseAdmin
    .from('people')
    .select('id, full_name, email, dbs_records!dbs_records_person_id_fkey(expiry_date, clearance_date, created_at)')
    .eq('is_archived', false)
    .order('full_name')

  const members = (rawMembers ?? []) as unknown as PersonRow[]
  const today = new Date()

  function fmtDate(iso: string | null) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-GB')
  }

  const rows = members.map(m => {
    const sorted = [...m.dbs_records].sort((a, b) => {
      const da = a.clearance_date ?? a.created_at
      const db_ = b.clearance_date ?? b.created_at
      return da > db_ ? -1 : 1
    })
    const latest = sorted[0] ?? null
    let expiryDate = latest?.expiry_date ?? null
    if (!expiryDate && latest?.clearance_date) {
      const d = new Date(latest.clearance_date)
      d.setFullYear(d.getFullYear() + validityYears)
      expiryDate = d.toISOString().slice(0, 10)
    }
    const status = classifyDbs(expiryDate, today, warnDays)
    const daysRemaining = expiryDate
      ? Math.ceil((new Date(expiryDate).getTime() - today.getTime()) / 86_400_000)
      : null
    const statusLabel = { valid: 'Valid', expiring_soon: 'Expiring Soon', expired: 'Expired', missing: 'No Record' }[status]
    return [
      m.full_name,
      m.email,
      fmtDate(latest?.clearance_date ?? null),
      fmtDate(expiryDate),
      statusLabel,
      daysRemaining !== null ? String(daysRemaining) : '',
    ]
  })

  const headers = ['Name', 'Email', 'Clearance Date', 'Expiry Date', 'Status', 'Days Remaining']
  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')

  const filename = `dbs-status-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
