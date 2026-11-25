import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { requireAdmin } from '@/lib/http'
import { ImportMemberRowSchema } from '@/lib/people'
import { isAdmin } from '@/lib/rbac'
import { findOfficeEmails } from '@/lib/offices'

const RowSchema = ImportMemberRowSchema

const ImportSchema = z.object({
  rows: z.array(RowSchema).min(1, 'At least one row is required').max(500, 'Maximum 500 rows per import'),
})

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !isAdmin(locals.user)) return requireAdmin(locals.user)!

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = ImportSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { rows } = parsed.data
  const results: { row: number; email: string; status: 'created' | 'skipped'; reason?: string }[] = []
  let created = 0
  let skipped = 0

  // Get existing emails to detect duplicates
  const { data: existing } = await supabaseAdmin
    .from('people')
    .select('email')
    .in('email', rows.map(r => r.email.toLowerCase()))

  const existingEmails = new Set((existing ?? []).map(p => (p.email as string).toLowerCase()))
  const officeEmails = await findOfficeEmails(rows.map(r => r.email))

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const emailLower = row.email.toLowerCase()

    if (existingEmails.has(emailLower)) {
      results.push({ row: i + 1, email: row.email, status: 'skipped', reason: 'Email already exists' })
      skipped++
      continue
    }

    if (officeEmails.has(emailLower)) {
      results.push({ row: i + 1, email: row.email, status: 'skipped', reason: 'Office mailbox, not a personal email' })
      skipped++
      continue
    }

    const insertData = {
      first_name: row.first_name.trim(),
      middle_name: row.middle_name?.trim() || null,
      last_name: row.last_name.trim(),
      email: emailLower,
      phone: row.phone?.trim() || null,
      date_of_birth: row.date_of_birth || null,
      gender: row.gender?.trim() || null,
      address: row.address?.trim() || null,
      status: row.status,
      person_types: row.person_types,
      date_joined: row.date_joined || null,
      source: row.source || 'manual',
      notes: row.notes?.trim() || null,
    }

    const { data: newMember, error } = await supabaseAdmin
      .from('people')
      .insert(insertData)
      .select('id, email')
      .single()

    if (error || !newMember) {
      results.push({ row: i + 1, email: row.email, status: 'skipped', reason: error?.message ?? 'Insert failed' })
      skipped++
      continue
    }

    // Add to existingEmails so we deduplicate within the batch itself
    existingEmails.add(emailLower)

    await writeAuditLog({
      actorId: locals.user.person_id,
      action: 'create',
      targetTable: 'people',
      targetId: newMember.id as string,
      afterValue: insertData as Record<string, unknown>,
    })

    results.push({ row: i + 1, email: row.email, status: 'created' })
    created++
  }

  return new Response(JSON.stringify({ created, skipped, results }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
